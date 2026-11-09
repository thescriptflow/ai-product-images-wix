/**
 * Server-only client for the credits service.
 *
 * Contract (adjust the three paths or `readRemaining` if the service PR lands
 * a different shape):
 * - Header `x-api-key`: `CREDITS_API_KEY`
 * - `GET {CREDITS_API_URL}/balance?siteId=` → `{ remaining: number }`
 * - `POST {CREDITS_API_URL}/reserve` `{ siteId, cost, jobId }` → `{ remaining }`
 *   Idempotent by `jobId`. `402` means the site is out of credits.
 * - `POST {CREDITS_API_URL}/refund` `{ siteId, jobId }` once per job. The
 *   service looks up the amount from the stored reserve.
 * `creditsRemaining` is accepted as an alias of `remaining`.
 */

const BALANCE_PATH = '/balance';
const RESERVE_PATH = '/reserve';
const REFUND_PATH = '/refund';
const REQUEST_TIMEOUT_MS = 8_000;

const NO_CREDITS_MESSAGE = 'No image credits remaining. Upgrade your plan to continue.';
const UNAVAILABLE_MESSAGE = 'Image credits are unavailable right now. Please try again shortly.';

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

function requireConfig(env: NodeJS.ProcessEnv): CreditsConfig {
  const baseUrl = env.CREDITS_API_URL?.trim().replace(/\/$/, '') ?? '';
  const apiKey = env.CREDITS_API_KEY?.trim() ?? '';
  if (!baseUrl || !apiKey) {
    console.error('CREDITS_API_URL or CREDITS_API_KEY is not set');
    throw new CreditsUnavailableError();
  }
  return { baseUrl, apiKey };
}

function readRemaining(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const raw = record.remaining ?? record.creditsRemaining;
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

export async function getBalance(
  siteId: string,
  env: NodeJS.ProcessEnv,
): Promise<{ remaining: number }> {
  const response = await creditsFetch(
    env,
    `${BALANCE_PATH}?siteId=${encodeURIComponent(siteId)}`,
    { method: 'GET' },
  );
  if (!response.ok) {
    console.error('Credits balance failed', response.status);
    throw new CreditsUnavailableError();
  }
  const remaining = readRemaining(await response.json().catch(() => undefined));
  if (remaining === undefined) {
    console.error('Credits balance response had no remaining count');
    throw new CreditsUnavailableError();
  }
  return { remaining: Math.max(0, remaining) };
}

export async function reserveCredits(
  siteId: string,
  cost: number,
  jobId: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const response = await creditsFetch(env, RESERVE_PATH, {
    method: 'POST',
    body: JSON.stringify({ siteId, cost, jobId }),
  });
  if (response.status === 402) throw new NoCreditsError();
  if (!response.ok) {
    console.error('Credits reserve failed', response.status);
    throw new CreditsUnavailableError();
  }
  const remaining = readRemaining(await response.json().catch(() => undefined));
  if (remaining === undefined) {
    console.error('Credits reserve response had no remaining count');
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
  const response = await creditsFetch(env, REFUND_PATH, {
    method: 'POST',
    body: JSON.stringify({ siteId, jobId }),
  });
  if (response.ok || response.status === 409) return;
  const text = await response.text().catch(() => '');
  console.error('Credits refund failed', response.status, text.slice(0, 300));
  throw new Error('Credit refund failed');
}
