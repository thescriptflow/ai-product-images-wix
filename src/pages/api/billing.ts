import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { checkoutUrl, reconcileLatestPurchase } from '../../billing/purchases';
import { isCreditPackKey, packOffers, productIdForPack, CREDIT_PACKS } from '../../billing/packs';
import { getBalance } from '../../image-processing/credits-client';
import { readEnv } from '../../image-processing/service';

async function dashboardSite(): Promise<{ ok: true; siteId: string } | { ok: false; reason: string }> {
  try {
    const info = await auth.getTokenInfo();
    if (!info.active) return { ok: false, reason: 'The access token is not active.' };
    if (info.subjectType !== 'USER') {
      return { ok: false, reason: 'Only the site dashboard can use this.' };
    }
    const siteId = info.siteId.trim();
    if (!siteId) return { ok: false, reason: 'Could not identify the site.' };
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
  const check = await dashboardSite();
  if (!check.ok) return unauthorized(check.reason);
  const env = readEnv();
  try {
    await reconcileLatestPurchase(check.siteId);
  } catch (error) {
    console.error('Could not reconcile the latest credit purchase', error);
  }
  let balance: number | null = null;
  try {
    balance = (await getBalance(check.siteId, env)).remaining;
  } catch (error) {
    console.error('Could not read credits', error);
  }
  return Response.json({ balance, packs: packOffers(env) });
};

export const POST: APIRoute = async ({ request }) => {
  const check = await dashboardSite();
  if (!check.ok) return unauthorized(check.reason);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Expected a JSON object.' }, { status: 400 });
  }
  const packKey = body && typeof body === 'object' && 'pack' in body ? body.pack : undefined;
  if (!isCreditPackKey(packKey)) {
    return Response.json({ error: 'Choose one of the credit packs.' }, { status: 400 });
  }
  const pack = CREDIT_PACKS.find((item) => item.key === packKey);
  if (!pack) return Response.json({ error: 'Choose one of the credit packs.' }, { status: 400 });
  const env = readEnv();
  const productId = productIdForPack(pack, env);
  if (!productId) {
    return Response.json(
      { error: 'Checkout is not available for this pack yet. Add its product ID in the app environment.' },
      { status: 409 },
    );
  }
  try {
    const url = await checkoutUrl(check.siteId, productId, env);
    return Response.json({ checkoutUrl: url });
  } catch (error) {
    console.error('Could not open Wix checkout', error);
    return Response.json(
      { error: 'Wix checkout is unavailable right now. Please try again shortly.' },
      { status: 503 },
    );
  }
};
