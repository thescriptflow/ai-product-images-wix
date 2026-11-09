import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { isImageAction, type ProcessImageRequest } from '../../image-processing/contract';
import { getCredits, processImage } from '../../image-processing/service';

type CheckResult = { ok: true; siteId: string } | { ok: false; reason: string };

async function checkCaller(): Promise<CheckResult> {
  try {
    const info = (await auth.getTokenInfo()) as {
      active?: boolean;
      subjectType?: string;
      instanceId?: string;
    };
    if (!info.active) {
      return { ok: false, reason: 'The access token is not active.' };
    }
    if (info.subjectType !== 'USER') {
      return { ok: false, reason: `Only the site dashboard can use this (subjectType=${info.subjectType ?? 'unknown'}).` };
    }
    if (!info.instanceId) {
      return { ok: false, reason: 'Could not identify the site.' };
    }
    return { ok: true, siteId: info.instanceId };
  } catch (error) {
    console.error('Token check failed', error);
    return { ok: false, reason: 'Missing or invalid access token.' };
  }
}

function unauthorized(reason: string): Response {
  return Response.json({ error: `Unauthorized. ${reason}` }, { status: 401 });
}

export const GET: APIRoute = async () => {
  const check = await checkCaller();
  if (!check.ok) return unauthorized(check.reason);
  try {
    return Response.json(await getCredits(check.siteId));
  } catch (error) {
    console.error('Could not read credits', error);
    const message = error instanceof Error ? error.message : 'Could not read credits';
    return Response.json({ error: message }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const check = await checkCaller();
  if (!check.ok) return unauthorized(check.reason);
  try {
    const body: unknown = await request.json();
    const parsed = parseRequest(body);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    const result = await processImage(parsed.value, check.siteId);
    return Response.json(result);
  } catch (error) {
    console.error('Image processing failed', error);
    const message = error instanceof Error ? error.message : 'Image processing failed';
    const status = message.startsWith('No image credits') ? 402 : 500;
    return Response.json({ error: message }, { status });
  }
};

function isWixMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'wixstatic.com' || url.hostname.endsWith('.wixstatic.com'));
  } catch {
    return false;
  }
}

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
  if (record.imageUrl !== undefined) {
    if (typeof record.imageUrl !== 'string') {
      return { ok: false, error: 'imageUrl must be a string.' };
    }
    if (!isWixMediaUrl(record.imageUrl)) {
      return { ok: false, error: 'imageUrl must be a Wix media URL.' };
    }
  }
  if (record.prompt !== undefined && typeof record.prompt !== 'string') {
    return { ok: false, error: 'prompt must be a string.' };
  }
  if (typeof record.prompt === 'string' && record.prompt.length > 500) {
    return { ok: false, error: 'prompt is too long (500 characters max).' };
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
