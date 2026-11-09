import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type ImageAction,
  type ProcessImageRequest,
  type ProcessImageResponse,
  type ProviderId,
  type CreditsResponse,
  isProviderId,
} from './contract';
import {
  cancelScene,
  ImageServiceError,
  isFalConfigured,
  isFalQueueUrl,
  pollScene,
  processWithFal,
  readFalKey,
} from './fal';
import { providerById } from './providers';
import { CreditsUnavailableError, NoCreditsError, getBalance, refundCredits, reserveCredits } from './credits-client';

const SCENE_TICKET_TTL_MS = 100_000;

export interface ServerProcessRequest extends ProcessImageRequest {
  jobId: string;
  ticket?: string;
  cancel?: boolean;
}

export interface PendingImageResponse {
  pending: true;
  ticket: string;
  creditsRemaining: number;
  provider: 'fal';
  mocked: false;
  action: 'ai-scene';
  productId: string;
  message: string;
}

export type ProcessOutcome = ProcessImageResponse | PendingImageResponse;

interface SceneTicket {
  siteId: string;
  jobId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl?: string;
  exp: number;
  remaining: number;
}

export function readEnv(): NodeJS.ProcessEnv {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' && process.env ? process.env : {};
  return { ...meta, ...proc } as NodeJS.ProcessEnv;
}

export function readProviderId(env: NodeJS.ProcessEnv = readEnv()): ProviderId {
  const raw = env.IMAGE_PROVIDER?.trim().toLowerCase() ?? '';
  return isProviderId(raw) ? raw : 'mock';
}

function isConfigured(id: ProviderId, env: NodeJS.ProcessEnv): boolean {
  return id === 'fal' ? isFalConfigured(env) : providerById(id).isConfigured(env);
}

export function creditCost(action: ImageAction): number {
  if (action === 'ai-scene') return 2;
  if (action === 'publish') return 0;
  return 1;
}

export async function getCredits(siteId: string, env: NodeJS.ProcessEnv = readEnv()): Promise<CreditsResponse> {
  const provider = readProviderId(env);
  const balance = await getBalance(siteId, env);
  return {
    creditsRemaining: balance.remaining,
    provider,
    providerConfigured: isConfigured(provider, env),
  };
}

function signTicket(ticket: SceneTicket, secret: string): string {
  const body = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readTicket(token: string, secret: string): SceneTicket {
  const parts = token.split('.');
  const body = parts[0];
  const signature = parts[1];
  if (!body || !signature || parts.length !== 2) {
    throw new ImageServiceError('This image request is no longer valid. Please try again.');
  }
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new ImageServiceError('This image request is no longer valid. Please try again.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new ImageServiceError('This image request is no longer valid. Please try again.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ImageServiceError('This image request is no longer valid. Please try again.');
  }
  const record = parsed as Partial<SceneTicket>;
  if (
    typeof record.siteId !== 'string' ||
    typeof record.jobId !== 'string' ||
    typeof record.statusUrl !== 'string' ||
    typeof record.responseUrl !== 'string' ||
    typeof record.exp !== 'number' ||
    typeof record.remaining !== 'number' ||
    !isFalQueueUrl(record.statusUrl) ||
    !isFalQueueUrl(record.responseUrl) ||
    (record.cancelUrl !== undefined && !isFalQueueUrl(record.cancelUrl))
  ) {
    throw new ImageServiceError('This image request is no longer valid. Please try again.');
  }
  return record as SceneTicket;
}

async function refundQuietly(siteId: string, jobId: string, env: NodeJS.ProcessEnv, cause: unknown): Promise<void> {
  try {
    await refundCredits(siteId, jobId, env);
  } catch (refundError) {
    console.error('Credit refund failed', refundError);
    console.error('Original image error', cause);
  }
}

function outcomeFromImage(
  request: ProcessImageRequest,
  providerId: ProviderId,
  mocked: boolean,
  resultUrl: string,
  message: string,
  creditsRemaining: number | null,
): ProcessImageResponse {
  return {
    provider: providerId,
    mocked,
    action: request.action,
    productId: request.productId,
    ...(request.imageUrl ? { originalUrl: request.imageUrl } : {}),
    resultUrl,
    creditsRemaining,
    message,
  };
}

async function continueScene(
  request: ServerProcessRequest,
  siteId: string,
  env: NodeJS.ProcessEnv,
): Promise<ProcessOutcome> {
  const key = readFalKey(env);
  if (!key) throw new Error('FAL_KEY is not set.');
  if (!request.ticket) throw new ImageServiceError('This image request is no longer valid. Please try again.');
  const ticket = readTicket(request.ticket, key);
  if (ticket.siteId !== siteId || ticket.jobId !== request.jobId) {
    throw new ImageServiceError('This image request is no longer valid. Please try again.');
  }
  if (Date.now() > ticket.exp) {
    await cancelScene(ticket.cancelUrl, key);
    const timeout = new ImageServiceError('The image service took too long. Please try again.');
    await refundQuietly(siteId, ticket.jobId, env, timeout);
    throw timeout;
  }
  try {
    const polled = await pollScene(ticket.statusUrl, ticket.responseUrl, key);
    if (polled.kind === 'pending') return pendingScene(request, ticket.remaining);
    return outcomeFromImage(request, 'fal', false, polled.resultUrl, polled.message, ticket.remaining);
  } catch (error) {
    if (error instanceof ImageServiceError && error.transient) return pendingScene(request, ticket.remaining);
    await cancelScene(ticket.cancelUrl, key);
    await refundQuietly(siteId, ticket.jobId, env, error);
    throw error;
  }
}

async function cancelSceneJob(
  request: ServerProcessRequest,
  siteId: string,
  env: NodeJS.ProcessEnv,
): Promise<ProcessOutcome> {
  const key = readFalKey(env);
  if (!key || !request.ticket) {
    throw new ImageServiceError('This image request is no longer valid. Please try again.');
  }
  const ticket = readTicket(request.ticket, key);
  if (ticket.siteId !== siteId || ticket.jobId !== request.jobId) {
    throw new ImageServiceError('This image request is no longer valid. Please try again.');
  }
  try {
    const polled = await pollScene(ticket.statusUrl, ticket.responseUrl, key);
    if (polled.kind === 'image') {
      return outcomeFromImage(request, 'fal', false, polled.resultUrl, polled.message, ticket.remaining);
    }
  } catch (error) {
    if (!(error instanceof ImageServiceError) || error.transient) {
      console.error('Could not confirm the scene before cancelling', error);
    }
  }
  await cancelScene(ticket.cancelUrl, key);
  const timeout = new ImageServiceError('The image service took too long. Please try again.');
  await refundQuietly(siteId, ticket.jobId, env, timeout);
  throw timeout;
}

function pendingScene(request: ServerProcessRequest, creditsRemaining: number): PendingImageResponse {
  return {
    pending: true,
    ticket: request.ticket ?? '',
    creditsRemaining,
    provider: 'fal',
    mocked: false,
    action: 'ai-scene',
    productId: request.productId,
    message: 'Creating the scene…',
  };
}

export async function processImage(
  request: ServerProcessRequest,
  siteId: string,
  env: NodeJS.ProcessEnv = readEnv(),
): Promise<ProcessOutcome> {
  const providerId = readProviderId(env);
  const live = providerId === 'fal';
  const cost = creditCost(request.action);

  if (live && request.action === 'ai-scene' && request.ticket) {
    if (request.cancel) return cancelSceneJob(request, siteId, env);
    return continueScene(request, siteId, env);
  }

  if (!live || cost <= 0) {
    const result = live
      ? await processWithFal(request, env)
      : { kind: 'image' as const, ...(await providerById(providerId).process(request, env)) };
    if (result.kind !== 'image') {
      throw new ImageServiceError('The image service could not complete this action. Please try again.');
    }
    let creditsRemaining: number | null = null;
    try {
      creditsRemaining = (await getBalance(siteId, env)).remaining;
    } catch (error) {
      console.error('Could not read credits after an uncharged action', error);
    }
    return outcomeFromImage(request, providerId, !live, result.resultUrl, result.message, creditsRemaining);
  }

  let reserved = false;
  try {
    const remaining = await reserveCredits(siteId, cost, request.jobId, env);
    reserved = true;
    const result = await processWithFal(request, env);
    if (result.kind === 'pending') {
      const key = readFalKey(env);
      if (!key) throw new Error('FAL_KEY is not set.');
      const ticket = signTicket(
        {
          siteId,
          jobId: request.jobId,
          statusUrl: result.statusUrl,
          responseUrl: result.responseUrl,
          ...(result.cancelUrl ? { cancelUrl: result.cancelUrl } : {}),
          exp: Date.now() + SCENE_TICKET_TTL_MS,
          remaining,
        },
        key,
      );
      const pending: PendingImageResponse = {
        pending: true,
        ticket,
        creditsRemaining: remaining,
        provider: 'fal',
        mocked: false,
        action: 'ai-scene',
        productId: request.productId,
        message: 'Creating the scene…',
      };
      return pending;
    }
    return outcomeFromImage(request, providerId, false, result.resultUrl, result.message, remaining);
  } catch (error) {
    if (reserved) await refundQuietly(siteId, request.jobId, env, error);
    throw error;
  }
}

export function processingErrorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof NoCreditsError) return { status: 402, message: error.message };
  if (error instanceof CreditsUnavailableError || error instanceof ImageServiceError) {
    return { status: 503, message: error.message };
  }
  const message = error instanceof Error ? error.message : 'Image processing failed';
  return { status: 500, message };
}
