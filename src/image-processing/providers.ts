import type { ImageAction, ProcessImageRequest, ProviderId } from './contract';

export interface ProviderResult {
  resultUrl: string;
  message: string;
}

export interface ImageProvider {
  readonly id: ProviderId;
  isConfigured(env: NodeJS.ProcessEnv): boolean;
  process(request: ProcessImageRequest, env: NodeJS.ProcessEnv): Promise<ProviderResult>;
}

const STARTING_PREVIEW =
  'Mock preview only. No request was sent to fal, Replicate, or Photoroom.';

export function previewImageUrl(action: ImageAction, productName: string): string {
  const label = actionLabel(action);
  const title = escapeXml(productName || 'Product');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#e7eef2"/><rect x="48" y="48" width="704" height="704" fill="#ffffff"/><text x="400" y="360" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" fill="#116dff">${escapeXml(label)}</text><text x="400" y="430" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#3b4a54">${title}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function actionLabel(action: ImageAction): string {
  switch (action) {
    case 'remove-background':
      return 'Background removed';
    case 'replace-background':
      return 'Background replaced';
    case 'ai-scene':
      return 'AI lifestyle scene';
    case 'publish':
      return 'Ready to publish';
    default: {
      const neverAction: never = action;
      return neverAction;
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export const mockProvider: ImageProvider = {
  id: 'mock',
  isConfigured: () => true,
  process: async (request) => ({
    resultUrl: previewImageUrl(request.action, request.productName),
    message: STARTING_PREVIEW,
  }),
};

function keyMessage(id: ProviderId, configured: boolean): string {
  const key = keyName(id);
  if (!configured) {
    return `${key} is not set, so this action returned a mock preview.`;
  }
  return `${key} is set. This build still returns a mock preview until the ${id} model request is added.`;
}

function keyName(id: ProviderId): string {
  switch (id) {
    case 'fal':
      return 'FAL_KEY';
    case 'replicate':
      return 'REPLICATE_API_TOKEN';
    case 'photoroom':
      return 'PHOTOROOM_API_KEY';
    case 'mock':
      return 'IMAGE_PROVIDER';
    default: {
      const neverId: never = id;
      return neverId;
    }
  }
}

function vendorProvider(id: Exclude<ProviderId, 'mock'>, configured: (env: NodeJS.ProcessEnv) => boolean): ImageProvider {
  return {
    id,
    isConfigured: configured,
    process: async (request, env) => ({
      resultUrl: previewImageUrl(request.action, request.productName),
      message: keyMessage(id, configured(env)),
    }),
  };
}

export const falProvider = vendorProvider(
  'fal',
  (env) => Boolean(
    (env.CREDITS_API_URL?.trim() && env.CREDITS_API_KEY?.trim()) || env.FAL_KEY?.trim() || env.FAL_API_KEY?.trim(),
  ),
);

export const replicateProvider = vendorProvider(
  'replicate',
  (env) => Boolean(env.REPLICATE_API_TOKEN?.trim()),
);

export const photoroomProvider = vendorProvider(
  'photoroom',
  (env) => Boolean(env.PHOTOROOM_API_KEY?.trim()),
);

const PROVIDERS: Record<ProviderId, ImageProvider> = {
  mock: mockProvider,
  fal: falProvider,
  replicate: replicateProvider,
  photoroom: photoroomProvider,
};

export function providerById(id: ProviderId): ImageProvider {
  return PROVIDERS[id];
}
