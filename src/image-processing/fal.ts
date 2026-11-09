import { buildScenePrompt } from './scene-prompt';
import type { ProcessImageRequest } from './contract';
import type { ProviderResult } from './providers';

const REMOVE_BACKGROUND_URL = 'https://fal.run/fal-ai/bria/background/remove';
const KONTEXT_URL = 'https://fal.run/fal-ai/flux-pro/kontext';

interface FalImageOutput {
  image?: { url?: string };
  images?: { url?: string }[];
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/["'\s]/g, '').replace(/[^\x21-\x7E]/g, '');
}

function readKey(env: NodeJS.ProcessEnv): string | undefined {
  const key = clean(env.FAL_KEY) || clean(env.FAL_API_KEY);
  return key || undefined;
}

export function isFalConfigured(env: NodeJS.ProcessEnv): boolean {
  return readKey(env) !== undefined;
}

async function callFal(
  url: string,
  key: string,
  input: Record<string, unknown>,
): Promise<FalImageOutput> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`fal request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return (await response.json()) as FalImageOutput;
}

async function toDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download the cutout (${response.status}).`);
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

function firstUrl(output: FalImageOutput): string | undefined {
  return output.image?.url ?? output.images?.[0]?.url;
}


export async function processWithFal(
  request: ProcessImageRequest,
  env: NodeJS.ProcessEnv,
): Promise<ProviderResult> {
  const key = readKey(env);
  if (!key) {
    throw new Error('FAL_KEY is not set. Add it to .env.local and restart wix dev.');
  }
  const live =
    request.action === 'remove-background' ||
    request.action === 'replace-background' ||
    request.action === 'ai-scene';
  if (!live) {
    throw new Error('This action is not connected to fal yet.');
  }
  const imageUrl = request.imageUrl;
  if (!imageUrl || !/^https:\/\//i.test(imageUrl)) {
    throw new Error('This product photo does not have a public https URL.');
  }

  if (request.action === 'ai-scene') {
    const output = await callFal(KONTEXT_URL, key, {
      prompt: buildScenePrompt(request.prompt, request.productName),
      image_url: imageUrl,
      output_format: 'jpeg',
    });
    const sceneUrl = firstUrl(output);
    if (!sceneUrl) {
      throw new Error('fal did not return an image URL.');
    }
    return { resultUrl: sceneUrl, message: 'AI scene created with fal (FLUX Kontext).' };
  }

  const output = await callFal(REMOVE_BACKGROUND_URL, key, { image_url: imageUrl });
  const resultUrl = firstUrl(output);
  if (!resultUrl) {
    throw new Error('fal did not return an image URL.');
  }
  if (request.action === 'replace-background') {
    return {
      resultUrl: await toDataUrl(resultUrl),
      message: 'Cutout ready. The new background is applied in your browser.',
    };
  }
  return { resultUrl, message: 'Background removed with fal (Bria RMBG 2.0).' };
}
