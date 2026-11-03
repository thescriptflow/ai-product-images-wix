export const IMAGE_ACTIONS = [
  'remove-background',
  'replace-background',
  'ai-scene',
  'publish',
] as const;

export type ImageAction = (typeof IMAGE_ACTIONS)[number];

export const PROVIDER_IDS = ['mock', 'fal', 'replicate', 'photoroom'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProcessImageRequest {
  action: ImageAction;
  productId: string;
  productName: string;
  imageUrl?: string;
  prompt?: string;
}

export interface ProcessImageResponse {
  provider: ProviderId;
  mocked: boolean;
  action: ImageAction;
  productId: string;
  originalUrl?: string;
  resultUrl: string;
  creditsRemaining: number;
  message: string;
}

export interface CreditsResponse {
  creditsRemaining: number;
  provider: ProviderId;
  providerConfigured: boolean;
}

export function isImageAction(value: unknown): value is ImageAction {
  return typeof value === 'string' && IMAGE_ACTIONS.some((action) => action === value);
}

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.some((id) => id === value);
}
