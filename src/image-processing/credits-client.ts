/**
 * Server-only client for the credits service.
 *
 * Every path except `/health` sends `x-api-key: CREDITS_API_KEY`.
 * - `GET {CREDITS_API_URL}/credits/:siteId` → `{ siteId, plan, balance, lifetimeGranted }`
 * - `POST /credits/reserve` `{ siteId, jobId, cost, action }` → account plus
 *   `{ jobId, cost, action, alreadyReserved }`. A retry must send the same
 *   siteId, jobId, and cost. `action` is `remove_bg | replace_bg | ai_scene | publish`.
 * - `POST /credits/refund` `{ siteId, jobId }` → account plus `{ amount, alreadyRefunded }`.
 * Errors are JSON `{ code }`:
 * - `402 insufficient_credits` → the existing no-credits message
 * - `404 unknown_job` on refund → nothing to refund
 * - `409 conflict`, `401`, `429`, and `5xx` → friendly failure, and the paid job does not run
 * The UI balance is `balance`.
 */

import type { ImageAction } from './contract';

const REQUEST_TIMEOUT_MS = 8_000;

const NO_CREDITS_MESSAGE = 'No image credits remaining. Upgrade your plan to continue.';
const UNAVAILABLE_MESSAGE = 'Image credits are unavailable right now. Please try again shortly.';

const CREDIT_ACTION: Record<ImageAction, 'remove_bg' | 'replace_bg' | 'ai_scene' | 'publish'> = {
  'remove-background': 'remove_bg',
  'replace-background': 'replace_bg',
  'ai-scene': 'ai_scene',
  publish: 'publish',
};

export class NoCreditsError extends Error {
  constructor() {
    super(NO_CREDITS_MESSAGE);
    this.name = 'NoCreditsError';
  }
}

export class CreditsUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = 'CreditsUnavailableError';
  }
}

interface CreditsConfig {
  baseUrl: string;
  apiKey: string;
}

interface CreditsFailure {
  status: number;
  code?: string;
}

function requireConfig(env: NodeJS.ProcessEnv): CreditsConfig {
  const baseUrl = env.CREDITS_API_URL?.trim().replace(/\/$/, '') ?? '';
  const apiKey = env.CREDITS_API_KEY?.trim() ?? '';
  if (!baseUrl || !apiKey) {
    console.error('CREDITS_API_URL or CREDITS_API_KEY is not set');
    throw new CreditsUnavailableError();
  }
  return { baseUrl, apiKey };
}

function readBalance(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const account = record.account;
  const source = account && typeof account === 'object' ? (account as Record<string, unknown>) : record;
  const raw = 'balance' in record && typeof record.balance === 'number' ? record.balance : source.balance;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

async function creditsFetch(
  env: NodeJS.ProcessEnv,
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
): Promise<Response> {
  const { baseUrl, apiKey } = requireConfig(env);
  try {
    return await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        'x-api-key': apiKey,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error('Credits API could not be reached', error);
    throw new CreditsUnavailableError();
  }
}

async function readFailure(response: Response): Promise<CreditsFailure> {
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
      code = body.code;
    }
  } catch (error) {
    console.error('Credits API error body was not JSON', response.status, error);
  }
  return { status: response.status, code };
}

function throwForFailure(where: string, failure: CreditsFailure): never {
  console.error('Credits API failed', where, failure.status, failure.code ?? '');
  if (failure.status === 402 || failure.code === 'insufficient_credits') throw new NoCreditsError();
  throw new CreditsUnavailableError();
}

export async function getBalance(
  siteId: string,
  env: NodeJS.ProcessEnv,
): Promise<{ remaining: number }> {
  const response = await creditsFetch(env, `/credits/${encodeURIComponent(siteId)}`, { method: 'GET' });
  if (!response.ok) throwForFailure('balance', await readFailure(response));
  const remaining = readBalance(await response.json().catch(() => undefined));
  if (remaining === undefined) {
    console.error('Credits balance response had no balance');
    throw new CreditsUnavailableError();
  }
  return { remaining: Math.max(0, remaining) };
}

export async function reserveCredits(
  siteId: string,
  cost: number,
  jobId: string,
  action: ImageAction,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const response = await creditsFetch(env, '/credits/reserve', {
    method: 'POST',
    body: JSON.stringify({ siteId, jobId, cost, action: CREDIT_ACTION[action] }),
  });
  if (!response.ok) throwForFailure('reserve', await readFailure(response));
  const body: unknown = await response.json().catch(() => undefined);
  const remaining = readBalance(body);
  if (remaining === undefined) {
    console.error('Credits reserve response had no balance');
    try {
      await refundCredits(siteId, jobId, env);
    } catch (error) {
      console.error('Could not undo a reserve that returned no balance', error);
    }
    throw new CreditsUnavailableError();
  }
  return Math.max(0, remaining);
}

export async function refundCredits(
  siteId: string,
  jobId: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const response = await creditsFetch(env, '/credits/refund', {
    method: 'POST',
    body: JSON.stringify({ siteId, jobId }),
  });
  if (response.ok) return;
  const failure = await readFailure(response);
  if (failure.status === 404 && failure.code === 'unknown_job') return;
  throwForFailure('refund', failure);
}
