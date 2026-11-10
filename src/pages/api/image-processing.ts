import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { isImageAction } from '../../image-processing/contract';
import { getCredits, processImage, processingErrorStatus, type ServerProcessRequest } from '../../image-processing/service';

type CheckResult = { ok: true; siteId: string } | { ok: false; reason: string };

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function checkCaller(): Promise<CheckResult> {
  try {
    const info = await auth.getTokenInfo();
    if (!info.active) {
      return { ok: false, reason: 'The access token is not active.' };
    }
    if (info.subjectType !== 'USER') {
      return { ok: false, reason: `Only the site dashboard can use this (subjectType=${info.subjectType ?? 'unknown'}).` };
    }
    // siteId is the Wix site on the access token. It is not the app install id,
    // and it is never taken from the request body.
    const siteId = info.siteId.trim();
    if (!siteId) {
      return { ok: false, reason: 'Could not identify the site.' };
    }
    return { ok: true, siteId };
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
    const { status, message } = processingErrorStatus(error);
    return Response.json({ error: message }, { status });
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
    const { status, message } = processingErrorStatus(error);
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
): { ok: true; value: ServerProcessRequest } | { ok: false; error: string } {
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
  if (typeof record.jobId !== 'string' || !JOB_ID.test(record.jobId)) {
    return { ok: false, error: 'jobId must be a UUID.' };
  }
  if (record.ticket !== undefined && (typeof record.ticket !== 'string' || record.ticket.length === 0 || record.ticket.length > 4000)) {
    return { ok: false, error: 'ticket is invalid.' };
  }
  if (record.cancel !== undefined && typeof record.cancel !== 'boolean') {
    return { ok: false, error: 'cancel must be a boolean.' };
  }

  const value: ServerProcessRequest = {
    action: record.action,
    productId: record.productId,
    productName: record.productName,
    jobId: record.jobId,
    ...(typeof record.imageUrl === 'string' ? { imageUrl: record.imageUrl } : {}),
    ...(typeof record.prompt === 'string' ? { prompt: record.prompt } : {}),
    ...(typeof record.ticket === 'string' ? { ticket: record.ticket } : {}),
    ...(record.cancel === true ? { cancel: true } : {}),
  };
  return { ok: true, value };
}
