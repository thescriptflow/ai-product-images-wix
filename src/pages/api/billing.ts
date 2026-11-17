import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { reconcileLatestPurchase, siteFromInstance, type InstalledApp } from '../../billing/purchases';
import { planByProductId, planOffers, upgradeUrl } from '../../billing/plans';
import { syncSiteSubscription } from '../../billing/subscription';
import { getBalance, type CreditsAccount } from '../../image-processing/credits-client';
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

  let installed: InstalledApp | undefined;
  try {
    installed = await siteFromInstance();
  } catch (error) {
    console.error('Could not read the app instance', error);
  }

  let account: CreditsAccount | undefined;
  if (installed) {
    // Fallback for monthly renewals: Wix sends no renewal event.
    try {
      account = (await syncSiteSubscription({ siteId: check.siteId, installed })).account;
    } catch (error) {
      console.error('Could not sync monthly plan credits', error);
    }
    try {
      await reconcileLatestPurchase(check.siteId, installed);
    } catch (error) {
      console.error('Could not reconcile legacy credit packs', error);
    }
  }

  try {
    account = await getBalance(check.siteId, env);
  } catch (error) {
    console.error('Could not read credits', error);
  }

  const billing = installed?.billing;
  const paidProduct = installed?.isFree === false ? billing?.packageName?.trim() || null : null;
  const currentPlan = planByProductId(paidProduct, env);
  const instanceId = installed?.instanceId ?? '';
  return Response.json({
    balance: account?.remaining ?? null,
    subscription: account?.subscription ?? null,
    currentPlan: paidProduct
      ? {
          productId: paidProduct,
          key: currentPlan?.key ?? null,
          name: currentPlan?.name ?? paidProduct,
          credits: currentPlan?.credits ?? null,
          autoRenewing: typeof billing?.autoRenewing === 'boolean' ? billing.autoRenewing : null,
        }
      : null,
    plans: planOffers(env),
    upgradeUrl: instanceId ? upgradeUrl(instanceId) : null,
  });
};
