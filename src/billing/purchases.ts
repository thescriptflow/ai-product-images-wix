import { appInstances, billing } from '@wix/app-management';
import { auth } from '@wix/essentials';
import { CreditGrantConflictError, grantCredits } from '../image-processing/credits-client';
import { readEnv } from '../image-processing/service';
import { packByProductId, type CreditPack } from './packs';

export const APP_ID = 'daa76557-f2cc-4d12-8993-97f3a766f87a';

const MATCH_WINDOW_MS = 120_000;

function isOneTime(cycle: string | null | undefined): boolean {
  return cycle === 'ONE_TIME';
}

function toMillis(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

async function siteFromInstance() {
  const elevated = auth.elevate(appInstances.getAppInstance);
  const response = await elevated();
  return {
    siteId: response.site?.siteId?.trim() ?? '',
    instanceId: response.instance?.instanceId?.trim() ?? '',
    billing: response.instance?.billing,
  };
}

async function purchaseHistory() {
  const elevated = auth.elevate(billing.getPurchaseHistory);
  return elevated();
}

function confirmedOneTime(purchases: { productId?: string; billingCycle?: string | null }[] | undefined, productId: string): boolean {
  return (purchases ?? []).some((purchase) => purchase.productId === productId && isOneTime(purchase.billingCycle));
}

/**
 * Get Purchase History has no invoice id. The current app instance invoice is the
 * only purchase id available outside the webhook, so this grants that latest
 * one-time invoice when it matches a configured pack.
 */
function packForCurrentInvoice(
  purchases: { productId?: string; billingCycle?: string | null; dateCreated?: Date | null }[],
  billingInfo: { timeStamp?: string | null; packageName?: string | null } | undefined,
  env: NodeJS.ProcessEnv,
): CreditPack | undefined {
  const known = purchases.flatMap((purchase) => {
    if (!isOneTime(purchase.billingCycle) || !purchase.productId) return [];
    const pack = packByProductId(purchase.productId, env);
    return pack ? [{ purchase, pack }] : [];
  });
  if (known.length === 0) return undefined;
  const stamp = toMillis(billingInfo?.timeStamp);
  if (stamp !== undefined) {
    let best: { pack: CreditPack; delta: number } | undefined;
    for (const item of known) {
      const ms = toMillis(item.purchase.dateCreated);
      if (ms === undefined) continue;
      const delta = Math.abs(ms - stamp);
      if (delta <= MATCH_WINDOW_MS && (!best || delta < best.delta)) best = { pack: item.pack, delta };
    }
    if (best) return best.pack;
  }
  const packageName = billingInfo?.packageName?.trim();
  if (packageName) {
    const named = known.filter((item) => item.pack.name === packageName);
    const latest = named.reduce<(typeof named)[number] | undefined>((best, item) => {
      if (!best) return item;
      return (toMillis(item.purchase.dateCreated) ?? 0) >= (toMillis(best.purchase.dateCreated) ?? 0) ? item : best;
    }, undefined);
    if (latest) return latest.pack;
  }
  if (known.length === 1) return known[0]?.pack;
  return undefined;
}

async function grantPurchase(siteId: string, pack: CreditPack, invoiceId: string): Promise<void> {
  try {
    await grantCredits(siteId, pack.credits, invoiceId, readEnv());
  } catch (error) {
    if (error instanceof CreditGrantConflictError) {
      console.error('Credit grant conflict for invoice', invoiceId);
      return;
    }
    throw error;
  }
}

export async function grantPaidPlan(input: {
  cycle: string | null | undefined;
  vendorProductId: string | null | undefined;
  invoiceId: string | null | undefined;
  eventSiteId: string | null | undefined;
}): Promise<void> {
  if (!isOneTime(input.cycle)) return;
  const productId = input.vendorProductId?.trim() ?? '';
  const env = readEnv();
  const pack = productId ? packByProductId(productId, env) : undefined;
  if (!pack) return;
  const invoiceId = input.invoiceId?.trim() ?? '';
  if (!invoiceId) throw new Error('Paid plan event had no invoice id.');

  const installed = await siteFromInstance();
  const eventSiteId = input.eventSiteId?.trim() ?? '';
  if (eventSiteId && installed.siteId && eventSiteId !== installed.siteId) {
    throw new Error('Paid plan event site does not match the app installation.');
  }
  const siteId = eventSiteId || installed.siteId;
  if (!siteId) throw new Error('Could not identify the site for this purchase.');

  const history = await purchaseHistory();
  if (!confirmedOneTime(history.purchases, productId)) {
    throw new Error('This purchase is not in the Wix purchase history yet.');
  }
  await grantPurchase(siteId, pack, invoiceId);
}

export async function reconcileLatestPurchase(siteId: string): Promise<void> {
  const env = readEnv();
  const [history, installed] = await Promise.all([purchaseHistory(), siteFromInstance()]);
  if (installed.siteId && installed.siteId !== siteId) {
    console.error('Refusing to grant credits because the installation site does not match the caller.');
    return;
  }
  const billingInfo = installed.billing;
  const invoiceId = billingInfo?.invoiceId?.trim() ?? '';
  if (!invoiceId || !isOneTime(billingInfo?.billingCycle)) return;
  const pack = packForCurrentInvoice(history.purchases ?? [], billingInfo, env);
  if (!pack) {
    console.error('Could not match the current one-time invoice to a credit pack.');
    return;
  }
  await grantPurchase(siteId, pack, invoiceId);
}

export function useTestCheckout(env: NodeJS.ProcessEnv): boolean {
  return env.BILLING_TEST_CHECKOUT?.trim().toLowerCase() !== 'false';
}

export async function checkoutUrl(siteId: string, productId: string, env: NodeJS.ProcessEnv): Promise<string> {
  const installed = await siteFromInstance();
  if (!installed.instanceId) throw new Error('Could not identify the app installation.');
  if (installed.siteId && installed.siteId !== siteId) {
    throw new Error('This site does not match the app installation.');
  }
  const successUrl = `https://www.wix.com/my-account/app/${APP_ID}/${installed.instanceId}`;
  const elevated = auth.elevate(billing.getUrl);
  const response = await elevated(productId, {
    billingCycle: 'ONE_TIME',
    successUrl,
    ...(useTestCheckout(env) ? { testCheckout: true } : {}),
  });
  const url = response.checkoutUrl?.trim() ?? '';
  if (!url.startsWith('https://')) throw new Error('Wix did not return a checkout link.');
  return url;
}
