import type { APIRoute } from 'astro';
import { isImageAction, type ProcessImageRequest } from '../../image-processing/contract';
import { getCredits, processImage } from '../../image-processing/service';

export const GET: APIRoute = async () => {
  return Response.json(getCredits());
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body: unknown = await request.json();
    const parsed = parseRequest(body);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    const result = await processImage(parsed.value);
    return Response.json(result);
  } catch (error) {
    console.error('Image processing failed', error);
    const message = error instanceof Error ? error.message : 'Image processing failed';
    const status = message.startsWith('No image credits') ? 402 : 500;
    return Response.json({ error: message }, { status });
  }
};

function parseRequest(
  body: unknown,
): { ok: true; value: ProcessImageRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Expected a JSON object.' };
  }
  const record = body as Record<string, unknown>;
  if (!isImageAction(record.action)) {
    return { ok: false, error: 'Action must be remove-background, replace-background, ai-scene, or publish.' };
  }
  if (typeof record.productId !== 'string' || record.productId.trim() === '') {
    return { ok: false, error: 'productId is required.' };
  }
  if (typeof record.productName !== 'string') {
    return { ok: false, error: 'productName is required.' };
  }
  if (record.imageUrl !== undefined && typeof record.imageUrl !== 'string') {
    return { ok: false, error: 'imageUrl must be a string.' };
  }
  if (record.prompt !== undefined && typeof record.prompt !== 'string') {
    return { ok: false, error: 'prompt must be a string.' };
  }

  return {
    ok: true,
    value: {
      action: record.action,
      productId: record.productId,
      productName: record.productName,
      ...(typeof record.imageUrl === 'string' ? { imageUrl: record.imageUrl } : {}),
      ...(typeof record.prompt === 'string' ? { prompt: record.prompt } : {}),
    },
  };
}
