import { httpClient } from '@wix/essentials';
import type { CreditsResponse, ImageAction, ProcessImageRequest, ProcessImageResponse } from '../../../../image-processing/contract';

function endpointUrl(): string {
  return new URL('/api/image-processing', import.meta.url).href;
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error;
    }
  } catch (error) {
    console.error('Could not read image API error', error);
  }
  return `Image request failed (${response.status})`;
}

export async function fetchCredits(): Promise<CreditsResponse> {
  const response = await httpClient.fetchWithAuth(endpointUrl());
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<CreditsResponse>;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 120_000;
const UNREACHABLE = 'The image service could not be reached. Please try again.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPending(value: unknown): value is { pending: true; ticket: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.pending === true && typeof record.ticket === 'string' && record.ticket.length > 0;
}

function isFinished(value: unknown): value is ProcessImageResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.pending !== true && typeof record.resultUrl === 'string' && record.resultUrl.length > 0;
}

async function postOnce(body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await httpClient.fetchWithAuth(endpointUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Image request failed', error);
    throw new Error(UNREACHABLE);
  }
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function processProductImage(
  request: ProcessImageRequest,
): Promise<ProcessImageResponse> {
  const jobId = crypto.randomUUID();
  let ticket: string | undefined;
  let initialNetworkRetries = 0;
  const started = Date.now();
  for (;;) {
    const pastDeadline = Date.now() - started > POLL_DEADLINE_MS;
    if (pastDeadline) {
      if (ticket) {
        try {
          const body = await postOnce({ ...request, jobId, ticket, cancel: true });
          if (isFinished(body)) return body;
        } catch (error) {
          throw error;
        }
      }
      throw new Error('The image service took too long. Please try again.');
    }
    try {
      const body = await postOnce({ ...request, jobId, ...(ticket ? { ticket } : {}) });
      if (isFinished(body)) return body;
      if (!isPending(body)) throw new Error('The image service returned an unexpected response.');
      ticket = body.ticket;
    } catch (error) {
      const network = error instanceof Error && error.message === UNREACHABLE;
      if (network && !pastDeadline && (ticket || initialNetworkRetries < 1)) {
        if (!ticket) initialNetworkRetries += 1;
        await sleep(ticket ? POLL_INTERVAL_MS : 500);
        continue;
      }
      throw error;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function defaultPrompt(action: ImageAction): string {
  switch (action) {
    case 'remove-background':
      return '';
    case 'replace-background':
      return 'Soft gray studio background';
    case 'ai-scene':
      return 'Lifestyle scene with natural light';
    case 'publish':
      return '';
    default: {
      const neverAction: never = action;
      return neverAction;
    }
  }
}
