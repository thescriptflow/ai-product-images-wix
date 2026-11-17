import { appInstances, billing } from '@wix/app-management';
import { auth } from '@wix/essentials';
import { CreditGrantConflictError, grantCredits } from '../image-processing/credits-client';
import { readEnv } from '../image-processing/service';
import { planByProductId, toMillis, type CreditPlan } from './plans';

/**
 * Legacy one-time credit packs. The app now sells monthly plans (see
 * subscription.ts). This file still grants any one-time pack a site bought
 * before the switch, once, so those credits are kept.
 */

function isOneTime(cycle: string | null | undefined): boolean {
  return cycle === 'ONE_TIME';
}

export async function siteFromInstance() {
  const elevated = auth.elevate(appInstances.getAppInstance);
  const response = await elevated();
  return {
    siteId: response.site?.siteId?.trim() ?? '',
    instanceId: response.instance?.instanceId?.trim() ?? '',
    isFree: response.instance?.isFree,
    billing: response.instance?.billing,
  };
}

async function purchaseHistory() {
  const elevated = auth.elevate(billing.getPurchaseHistory);
  return elevated();
}

/**
 * Get Purchase History does not include an invoice id. Dashboard loads still grant
 * each confirmed one-time pack from that list when the app instance still looks
 * free. `purchaseId` is the invoice id when a history row has one. Otherwise it
 * is the product id plus the purchase time, the only stable id that list returns.
 * A later paid-plan event uses that same id, so the purchase is not granted twice.
 */
function purchaseInvoiceId(purchase: { invoiceId?: string | null }): string | undefined {
  const invoiceId = purchase.invoiceId?.trim();
  return invoiceId || undefined;
}

function canonicalInstant(value: Date | string | null | undefined): string | undefined {
  const ms = toMillis(value);
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

function purchaseKey(purchase: {
  productId?: string | null;
  dateCreated?: Date | string | null;
  invoiceId?: string | null;
}): string | undefined {
  const invoiceId = purchaseInvoiceId(purchase);
  if (invoiceId) return invoiceId;
  const productId = purchase.productId?.trim();
  const created = canonicalInstant(purchase.dateCreated);
  if (!productId || !created) return undefined;
  return `${productId}:${created}`;
}

function describePurchase(purchase: {
  productId?: string | null;
  billingCycle?: string | null;
  dateCreated?: Date | string | null;
}): string {
  const productId = purchase.productId?.trim() || 'unknown';
  const cycle = purchase.billingCycle?.trim() || 'unknown';
  const created = canonicalInstant(purchase.dateCreated) ?? 'unknown';
  return `product ${productId} cycle ${cycle} purchased ${created}`;
}

function skipPurchase(
  purchase: { productId?: string | null; billingCycle?: string | null; dateCreated?: Date | string | null },
  reason: string,
): void {
  console.error(`Credit purchase skipped: ${describePurchase(purchase)}: ${reason}`);
}

async function grantPurchase(siteId: string, pack: CreditPlan, purchaseId: string, detail: string): Promise<void> {
  try {
    console.error(`Granting ${pack.credits} credits for ${detail}. purchaseId=${purchaseId}`);
    await grantCredits(siteId, pack.credits, purchaseId, readEnv());
  } catch (error) {
    if (error instanceof CreditGrantConflictError) {
      console.error(`Credit grant conflict for purchaseId ${purchaseId}`);
      return;
    }
    throw error;
  }
}

type HistoryPurchase = {
  productId?: string | null;
  billingCycle?: string | null;
  dateCreated?: Date | string | null;
  invoiceId?: string | null;
};

function matchingPurchase(purchases: HistoryPurchase[], productId: string, when: Date | string | null | undefined): HistoryPurchase | undefined {
  const rows = purchases.filter((purchase) => purchase.productId === productId && isOneTime(purchase.billingCycle));
  const target = toMillis(when);
  if (target === undefined) return rows[rows.length - 1];
  let best: HistoryPurchase | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const purchase of rows) {
    const created = toMillis(purchase.dateCreated);
    if (created === undefined) continue;
    const distance = Math.abs(created - target);
    if (distance < bestDistance) {
      best = purchase;
      bestDistance = distance;
    }
  }
  return best ?? rows[rows.length - 1];
}

function grantDetail(purchase: HistoryPurchase): string {
  return purchaseInvoiceId(purchase)
    ? `${describePurchase(purchase)} (invoice id from purchase history)`
    : `${describePurchase(purchase)} (Get Purchase History has no invoice id; purchaseId is the product id and purchase time)`;
}

export async function grantPaidPlan(input: {
  cycle: string | null | undefined;
  vendorProductId: string | null | undefined;
  invoiceId: string | null | undefined;
  operationTimeStamp?: Date | string | null;
  eventSiteId: string | null | undefined;
}): Promise<void> {
  const productId = input.vendorProductId?.trim() ?? '';
  if (!isOneTime(input.cycle)) {
    console.error(
      `Credit purchase skipped: product ${productId || 'unknown'} cycle ${input.cycle || 'unknown'}: not a one-time pack.`,
    );
    return;
  }
  const env = readEnv();
  const pack = planByProductId(productId, env);
  if (!pack) {
    console.error(
      `Credit purchase skipped: product ${productId || 'unknown'} cycle ${input.cycle || 'unknown'}: no credit pack is configured for this product.`,
    );
    return;
  }

  const installed = await siteFromInstance();
  const eventSiteId = input.eventSiteId?.trim() ?? '';
  if (eventSiteId && installed.siteId && eventSiteId !== installed.siteId) {
    throw new Error('Paid plan event site does not match the app installation.');
  }
  const siteId = eventSiteId || installed.siteId;
  if (!siteId) throw new Error('Could not identify the site for this purchase.');

  const history = await purchaseHistory();
  const purchase = matchingPurchase(history.purchases ?? [], productId, input.operationTimeStamp);
  if (!purchase) {
    throw new Error('This purchase is not in the Wix purchase history yet.');
  }
  const purchaseId = purchaseKey(purchase);
  if (!purchaseId) {
    skipPurchase(purchase, 'purchase history has no invoice id and no purchase time.');
    return;
  }
  const eventInvoiceId = input.invoiceId?.trim() ?? '';
  if (!eventInvoiceId) {
    console.error(`Paid plan event for ${describePurchase(purchase)} has no invoice id. Granting with purchaseId ${purchaseId}.`);
  } else if (eventInvoiceId !== purchaseId) {
    console.error(
      `Paid plan invoice ${eventInvoiceId} is not on the purchase history row. Granting with purchaseId ${purchaseId} so the dashboard grant stays idempotent.`,
    );
  }
  await grantPurchase(siteId, pack, purchaseId, grantDetail(purchase));
}

export type InstalledApp = Awaited<ReturnType<typeof siteFromInstance>>;

export async function reconcileLatestPurchase(siteId: string, known?: InstalledApp): Promise<void> {
  const env = readEnv();
  const [history, installed] = await Promise.all([purchaseHistory(), known ?? siteFromInstance()]);
  if (installed.siteId && installed.siteId !== siteId) {
    console.error('Refusing to grant credits because the installation site does not match the caller.');
    return;
  }
  const oneTime = (history.purchases ?? []).filter((purchase) => isOneTime(purchase.billingCycle));
  if (oneTime.length === 0) return;
  console.error(`Reconciling legacy one-time credit packs from Wix history (${oneTime.length}).`);
  const granted = new Set<string>();
  for (const purchase of oneTime) {
    const pack = planByProductId(purchase.productId, env);
    if (!pack) {
      skipPurchase(purchase, 'no credit pack is configured for this product.');
      continue;
    }
    const purchaseId = purchaseKey(purchase);
    if (!purchaseId) {
      skipPurchase(purchase, 'purchase history has no invoice id and no purchase time.');
      continue;
    }
    if (granted.has(purchaseId)) continue;
    granted.add(purchaseId);
    await grantPurchase(siteId, pack, purchaseId, grantDetail(purchase));
  }
}
