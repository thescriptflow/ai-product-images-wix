import { isProviderId, type CreditsResponse, type ProcessImageRequest, type ProcessImageResponse, type ProviderId } from './contract';
import { providerById } from './providers';

const STARTING_CREDITS = 40;

let creditsRemaining = STARTING_CREDITS;

export function readProviderId(env: NodeJS.ProcessEnv = process.env): ProviderId {
  const raw = env.IMAGE_PROVIDER?.trim().toLowerCase() ?? '';
  return isProviderId(raw) ? raw : 'mock';
}

export function getCredits(env: NodeJS.ProcessEnv = process.env): CreditsResponse {
  const provider = readProviderId(env);
  return {
    creditsRemaining,
    provider,
    providerConfigured: providerById(provider).isConfigured(env),
  };
}

export async function processImage(
  request: ProcessImageRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProcessImageResponse> {
  if (creditsRemaining <= 0) {
    throw new Error('No image credits remaining. Billing is on the roadmap; restart the dev server to reset the local balance.');
  }

  const providerId = readProviderId(env);
  const provider = providerById(providerId);
  const result = await provider.process(request, env);
  creditsRemaining -= 1;

  const publishNote =
    request.action === 'publish'
      ? ' Publish is preview-only here: a live run would import the image with Media Manager and set it as the product photo.'
      : '';

  return {
    provider: provider.id,
    mocked: true,
    action: request.action,
    productId: request.productId,
    ...(request.imageUrl ? { originalUrl: request.imageUrl } : {}),
    resultUrl: result.resultUrl,
    creditsRemaining,
    message: `${result.message}${publishNote}`,
  };
}
