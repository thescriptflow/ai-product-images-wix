import { buildScenePrompt } from './scene-prompt';
import type { ProcessImageRequest } from './contract';
import { FAL_MODELS, resolveSceneModel } from './fal-models';

const SYNC_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const SUBMIT_TIMEOUT_MS = 15_000;
const STATUS_TIMEOUT_MS = 10_000;

const UNREACHABLE = 'The image service could not be reached. Please try again.';
const TOO_LONG = 'The image service took too long. Please try again.';
const FAILED = 'The image service could not complete this action. Please try again.';
const NO_IMAGE = 'The image service did not return a photo. Please try again.';

export class ImageServiceError extends Error {
  /** A later poll can still succeed. Callers that already hold a queue ticket should not refund yet. */
  readonly transient: boolean;

  constructor(message: string, transient = false) {
    super(message);
    this.name = 'ImageServiceError';
    this.transient = transient;
  }
}

interface FalImageOutput {
  image?: { url?: string };
  images?: { url?: string }[];
}

export interface FalPending {
  kind: 'pending';
  statusUrl: string;
  responseUrl: string;
  cancelUrl?: string;
}

export interface FalImage {
  kind: 'image';
  resultUrl: string;
  message: string;
}

export type FalResult = FalPending | FalImage;

interface QueueSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
}

interface QueueStatus {
  status?: string;
  error?: string;
  response_url?: string;
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/["'\s]/g, '').replace(/[^\x21-\x7E]/g, '');
}

function readKey(env: NodeJS.ProcessEnv): string | undefined {
  const key = clean(env.FAL_KEY) || clean(env.FAL_API_KEY);
  return key || undefined;
}

/**
 * How this backend reaches fal.
 * - `proxy`: through the credits API (`{CREDITS_API_URL}/fal/run|queue/...` with `x-api-key`),
 *   which adds the fal key server-side. Wix hosting drops the `Authorization` header on
 *   outbound requests, so this is used whenever CREDITS_API_URL and CREDITS_API_KEY are set.
 * - `direct`: straight to fal with FAL_KEY, only when the credits API is not configured.
 */
export type FalAccess =
  | { kind: 'proxy'; baseUrl: string; apiKey: string }
  | { kind: 'direct'; key: string };

export function readFalAccess(env: NodeJS.ProcessEnv): FalAccess | undefined {
  const baseUrl = env.CREDITS_API_URL?.trim().replace(/\/+$/, '') ?? '';
  const apiKey = env.CREDITS_API_KEY?.trim() ?? '';
  if (baseUrl && apiKey) return { kind: 'proxy', baseUrl, apiKey };
  const key = readKey(env);
  return key ? { kind: 'direct', key } : undefined;
}

/** Server-only secret used to sign scene tickets. */
export function falTicketSecret(access: FalAccess): string {
  return access.kind === 'proxy' ? access.apiKey : access.key;
}

export function isFalConfigured(env: NodeJS.ProcessEnv): boolean {
  return readFalAccess(env) !== undefined;
}

export function isFalQueueUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'queue.fal.run' && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function modelUrl(host: string, modelId: string): string {
  const path = modelId.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${host}/${path}`;
}

/** Maps a fal.run or queue.fal.run URL to the request this backend actually sends. */
function falRequest(access: FalAccess, falUrl: string): { url: string; headers: Record<string, string> } {
  if (access.kind === 'direct') return { url: falUrl, headers: { Authorization: `Key ${access.key}` } };
  const parsed = new URL(falUrl);
  const route = parsed.hostname === 'queue.fal.run' ? 'queue' : 'run';
  return {
    url: `${access.baseUrl}/fal/${route}${parsed.pathname}${parsed.search}`,
    headers: { 'x-api-key': access.apiKey },
  };
}

async function falFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    console.error('fal request did not complete', name);
    if (name === 'TimeoutError' || name === 'AbortError') throw new ImageServiceError(TOO_LONG, true);
    throw new ImageServiceError(UNREACHABLE, true);
  }
}

function callFal(
  access: FalAccess,
  falUrl: string,
  init: { method: 'GET' | 'POST' | 'PUT'; body?: string },
  timeoutMs: number,
): Promise<Response> {
  const target = falRequest(access, falUrl);
  return falFetch(
    target.url,
    {
      method: init.method,
      headers: { ...target.headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body ? { body: init.body } : {}),
    },
    timeoutMs,
  );
}

function errorReason(text: string): string {
  let reason = text;
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const detail = record.detail;
      if (typeof detail === 'string') reason = detail;
      else if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object' && typeof (detail[0] as { msg?: unknown }).msg === 'string') {
        reason = (detail[0] as { msg: string }).msg;
      } else if (typeof record.error === 'string') reason = record.error;
      else if (typeof record.message === 'string') reason = record.message;
    }
  } catch {
    // Not JSON; use the raw text.
  }
  return reason.replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function readFalError(response: Response): Promise<ImageServiceError> {
  const text = await response.text().catch(() => '');
  console.error('fal request failed', response.status, text.slice(0, 300));
  const reason = errorReason(text);
  return new ImageServiceError(`${FAILED} (fal ${response.status}${reason ? `: ${reason}` : ''})`);
}

function firstUrl(output: FalImageOutput): string | undefined {
  return output.image?.url ?? output.images?.[0]?.url;
}

async function callFalSync(
  modelId: string,
  access: FalAccess,
  input: Record<string, unknown>,
): Promise<FalImageOutput> {
  const response = await callFal(
    access,
    modelUrl('https://fal.run', modelId),
    { method: 'POST', body: JSON.stringify(input) },
    SYNC_TIMEOUT_MS,
  );
  if (!response.ok) throw await readFalError(response);
  return (await response.json()) as FalImageOutput;
}

async function toDataUrl(url: string): Promise<string> {
  const response = await falFetch(url, { method: 'GET' }, DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) {
    console.error('Could not download the cutout', response.status);
    throw new ImageServiceError(NO_IMAGE);
  }
  const type = response.headers.get('content-type') ?? 'image/png';
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function requireImageUrl(request: ProcessImageRequest): string {
  const imageUrl = request.imageUrl;
  if (!imageUrl || !/^https:\/\//i.test(imageUrl)) {
    throw new Error('This product photo does not have a public https URL.');
  }
  return imageUrl;
}

export async function submitScene(
  request: ProcessImageRequest,
  env: NodeJS.ProcessEnv,
  access: FalAccess,
): Promise<FalPending> {
  const modelId = resolveSceneModel(env);
  const response = await callFal(
    access,
    modelUrl('https://queue.fal.run', modelId),
    {
      method: 'POST',
      body: JSON.stringify({
        prompt: buildScenePrompt(request.prompt, request.productName),
        image_url: requireImageUrl(request),
        output_format: 'jpeg',
      }),
    },
    SUBMIT_TIMEOUT_MS,
  );
  if (!response.ok) throw await readFalError(response);
  const submitted = (await response.json()) as QueueSubmit;
  if (!submitted.status_url || !submitted.response_url || !isFalQueueUrl(submitted.status_url) || !isFalQueueUrl(submitted.response_url)) {
    console.error('fal queue submit did not return status URLs', Boolean(submitted.request_id));
    throw new ImageServiceError(FAILED);
  }
  const cancelUrl = submitted.cancel_url && isFalQueueUrl(submitted.cancel_url) ? submitted.cancel_url : undefined;
  return {
    kind: 'pending',
    statusUrl: submitted.status_url,
    responseUrl: submitted.response_url,
    ...(cancelUrl ? { cancelUrl } : {}),
  };
}

export async function pollScene(
  statusUrl: string,
  responseUrl: string,
  access: FalAccess,
): Promise<FalImage | { kind: 'pending' }> {
  if (!isFalQueueUrl(statusUrl) || !isFalQueueUrl(responseUrl)) {
    throw new ImageServiceError(FAILED);
  }
  const statusResponse = await callFal(access, statusUrl, { method: 'GET' }, STATUS_TIMEOUT_MS);
  if (statusResponse.status === 404) {
    console.error('fal queue request was not found');
    throw new ImageServiceError(FAILED);
  }
  if (statusResponse.status >= 500) {
    console.error('fal queue status failed', statusResponse.status);
    throw new ImageServiceError(UNREACHABLE, true);
  }
  if (!statusResponse.ok) throw await readFalError(statusResponse);
  const status = (await statusResponse.json()) as QueueStatus;
  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
    return { kind: 'pending' };
  }
  if (status.status !== 'COMPLETED') {
    console.error('fal queue returned an unexpected status', status.status);
    throw new ImageServiceError(FAILED);
  }
  if (status.error) {
    console.error('fal queue request failed', status.error.slice(0, 300));
    throw new ImageServiceError(FAILED);
  }
  const resultUrl = status.response_url && isFalQueueUrl(status.response_url) ? status.response_url : responseUrl;
  const resultResponse = await callFal(access, resultUrl, { method: 'GET' }, STATUS_TIMEOUT_MS);
  if (resultResponse.status >= 500) {
    console.error('fal queue result failed', resultResponse.status);
    throw new ImageServiceError(UNREACHABLE, true);
  }
  if (!resultResponse.ok) throw await readFalError(resultResponse);
  const sceneUrl = firstUrl((await resultResponse.json()) as FalImageOutput);
  if (!sceneUrl) throw new ImageServiceError(NO_IMAGE);
  return { kind: 'image', resultUrl: sceneUrl, message: 'AI scene created with fal (FLUX Kontext).' };
}

export async function cancelScene(cancelUrl: string | undefined, access: FalAccess): Promise<void> {
  if (!cancelUrl || !isFalQueueUrl(cancelUrl)) return;
  try {
    await callFal(access, cancelUrl, { method: 'PUT' }, STATUS_TIMEOUT_MS);
  } catch (error) {
    console.error('Could not cancel the fal queue request', error);
  }
}

export async function processWithFal(
  request: ProcessImageRequest,
  env: NodeJS.ProcessEnv,
): Promise<FalResult> {
  const access = readFalAccess(env);
  if (!access) throw new Error('CREDITS_API_URL and CREDITS_API_KEY are not set.');
  const live =
    request.action === 'remove-background' ||
    request.action === 'replace-background' ||
    request.action === 'ai-scene';
  if (!live) throw new Error('This action is not connected to fal yet.');
  const imageUrl = requireImageUrl(request);

  if (request.action === 'ai-scene') return submitScene(request, env, access);

  const output = await callFalSync(FAL_MODELS.removeBackground, access, { image_url: imageUrl });
  const resultUrl = firstUrl(output);
  if (!resultUrl) throw new ImageServiceError(NO_IMAGE);
  if (request.action === 'replace-background') {
    return {
      kind: 'image',
      resultUrl: await toDataUrl(resultUrl),
      message: 'Cutout ready. The new background is applied in your browser.',
    };
  }
  return { kind: 'image', resultUrl, message: 'Background removed with fal (Bria RMBG 2.0).' };
}

