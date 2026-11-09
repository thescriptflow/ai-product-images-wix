import { isProviderId, type CreditsResponse, type ImageAction, type ProcessImageRequest, type ProcessImageResponse, type ProviderId } from './contract';
import { isFalConfigured, processWithFal } from './fal';
import { providerById } from './providers';
import { getBalance, refundCredits, reserveCredits } from './credits-store';

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
  const balance = await getBalance(siteId);
  return {
    creditsRemaining: balance.remaining,
    provider,
    providerConfigured: isConfigured(provider, env),
  };
}

export async function processImage(
  request: ProcessImageRequest,
  siteId: string,
  env: NodeJS.ProcessEnv = readEnv(),
): Promise<ProcessImageResponse> {
  const cost = creditCost(request.action);
  const remaining = await reserveCredits(siteId, cost);
  try {
    const providerId = readProviderId(env);
    const live = providerId === 'fal';
    const result = live
      ? await processWithFal(request, env)
      : await providerById(providerId).process(request, env);
    return {
      provider: providerId,
      mocked: !live,
      action: request.action,
      productId: request.productId,
      ...(request.imageUrl ? { originalUrl: request.imageUrl } : {}),
      resultUrl: result.resultUrl,
      creditsRemaining: remaining,
      message: result.message,
    };
  } catch (error) {
    await refundCredits(siteId, cost);
    throw error;
  }
}
