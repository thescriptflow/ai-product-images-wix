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

export async function processProductImage(
  request: ProcessImageRequest,
): Promise<ProcessImageResponse> {
  const response = await httpClient.fetchWithAuth(endpointUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<ProcessImageResponse>;
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
