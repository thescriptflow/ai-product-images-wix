/**
 * Monthly Wix plans and billing-cycle math. This file has no imports so it can
 * be tested with plain Node.
 *
 * Refill rule: each billing month the site gets its plan's credits. Unused
 * plan credits do not carry over; the next month resets them to the allowance.
 * Free credits and credits from the earlier one-time packs never expire.
 */

export const APP_ID = 'daa76557-f2cc-4d12-8993-97f3a766f87a';

export const CREDIT_PLANS = [
  {
    key: '20',
    credits: 20,
    name: '20 Credits',
    priceLabel: '$9.99/month',
    defaultProductId: '20-credits',
    envNames: ['PLAN_20_PRODUCT_ID', 'CREDIT_PACK_20_PRODUCT_ID'],
    benefits: ['20 credits every month', 'About 20 background edits or 10 AI scenes', 'Billed monthly by Wix. Cancel any time'],
  },
  {
    key: '60',
    credits: 60,
    name: '60 Credits',
    priceLabel: '$24.99/month',
    defaultProductId: '60-credits',
    envNames: ['PLAN_60_PRODUCT_ID', 'CREDIT_PACK_60_PRODUCT_ID'],
    benefits: ['60 credits every month', 'About 60 background edits or 30 AI scenes', 'Billed monthly by Wix. Cancel any time'],
  },
  {
    key: '150',
    credits: 150,
    name: '150 Credits',
    priceLabel: '$49.99/month',
    defaultProductId: '150-credits',
    envNames: ['PLAN_150_PRODUCT_ID', 'CREDIT_PACK_150_PRODUCT_ID'],
    benefits: ['150 credits every month', 'About 150 background edits or 75 AI scenes', 'Billed monthly by Wix. Cancel any time'],
  },
] as const;

export type CreditPlan = (typeof CREDIT_PLANS)[number];
export type CreditPlanKey = CreditPlan['key'];
type Env = Record<string, string | undefined>;

export interface CreditPlanOffer {
  key: CreditPlanKey;
  credits: number;
  name: string;
  priceLabel: string;
  benefits: readonly string[];
  productId: string;
}

function cleanProductId(value: string | undefined): string | undefined {
  const id = value?.trim() ?? '';
  if (!id || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
  return id;
}

/** PLAN_x_PRODUCT_ID, then the older CREDIT_PACK_x_PRODUCT_ID, then the Dev Center id. */
export function productIdForPlan(plan: CreditPlan, env: Env): string {
  for (const name of plan.envNames) {
    const id = cleanProductId(env[name]);
    if (id) return id;
  }
  return plan.defaultProductId;
}

export function planByProductId(productId: string | null | undefined, env: Env): CreditPlan | undefined {
  const id = productId?.trim();
  if (!id) return undefined;
  return CREDIT_PLANS.find((plan) => productIdForPlan(plan, env) === id);
}

export function planOffers(env: Env): CreditPlanOffer[] {
  return CREDIT_PLANS.map((plan) => ({
    key: plan.key,
    credits: plan.credits,
    name: plan.name,
    priceLabel: plan.priceLabel,
    benefits: plan.benefits,
    productId: productIdForPlan(plan, env),
  }));
}

export function upgradeUrl(instanceId: string): string {
  return `https://www.wix.com/apps/upgrade/${APP_ID}?appInstanceId=${encodeURIComponent(instanceId)}`;
}

export function toMillis(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** Adds calendar months in UTC. Day 31 becomes the last day of a shorter month. */
export function addMonthsUtc(ms: number, months: number): number {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year,
    month,
    Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

export interface MonthlyCycle {
  index: number;
  periodStart: number;
  periodEnd: number;
}

/**
 * Wix's Get App Instance gives the purchase time (`timeStamp`) but no cycle end
 * for monthly plans, and no event fires on renewal. Billing months are counted
 * from the purchase time.
 */
export function monthlyCycle(startMs: number, nowMs: number): MonthlyCycle {
  if (nowMs <= startMs) return { index: 0, periodStart: startMs, periodEnd: addMonthsUtc(startMs, 1) };
  const from = new Date(startMs);
  const to = new Date(nowMs);
  let index = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (index < 0) index = 0;
  while (index > 0 && addMonthsUtc(startMs, index) > nowMs) index -= 1;
  while (addMonthsUtc(startMs, index + 1) <= nowMs) index += 1;
  return { index, periodStart: addMonthsUtc(startMs, index), periodEnd: addMonthsUtc(startMs, index + 1) };
}

export interface InstanceBilling {
  packageName?: string | null;
  billingCycle?: string | null;
  timeStamp?: Date | string | null;
  expirationDate?: Date | string | null;
  autoRenewing?: boolean | null;
  invoiceId?: string | null;
  freeTrialInfo?: { status?: string | null } | null;
}

export type SubscriptionState =
  | {
      kind: 'active';
      plan: CreditPlan;
      productId: string;
      cycleKey: string;
      periodStart: string;
      periodEnd: string;
      autoRenewing: boolean | null;
      invoiceId: string | null;
      billingCycle: string;
    }
  | { kind: 'none' }
  | { kind: 'skip'; reason: string };

const RECURRING = new Set(['MONTHLY', 'YEARLY', 'TWO_YEARS', 'THREE_YEARS', 'FOUR_YEARS', 'FIVE_YEARS']);

/**
 * Turns the app instance billing info into the cycle to grant.
 * - Free instance or no plan: `none` (the credits API ends the plan once its paid month is over).
 * - Monthly or yearly plan: `active`, refilled every calendar month from the purchase time.
 * - Free trial in progress, a one-time purchase, or an unknown product: `skip`, nothing changes.
 */
export function subscriptionState(
  input: { isFree?: boolean | null; billing?: InstanceBilling | null },
  nowMs: number,
  env: Env,
): SubscriptionState {
  const billing = input.billing;
  const productId = billing?.packageName?.trim() ?? '';
  if (input.isFree === true || !billing || !productId) return { kind: 'none' };
  const cycle = billing.billingCycle?.trim().toUpperCase() ?? '';
  if (!RECURRING.has(cycle)) return { kind: 'skip', reason: `billing cycle ${cycle || 'unknown'} is not a subscription` };
  if (billing.freeTrialInfo?.status === 'IN_PROGRESS') return { kind: 'skip', reason: 'free trial in progress' };
  const plan = planByProductId(productId, env);
  if (!plan) return { kind: 'skip', reason: `no credit plan is configured for product ${productId}` };
  const started = toMillis(billing.timeStamp);
  if (started === undefined) return { kind: 'skip', reason: 'the plan has no purchase time' };
  const current = monthlyCycle(started, nowMs);
  return {
    kind: 'active',
    plan,
    productId,
    cycleKey: `${productId}.${started}.${current.index}`,
    periodStart: new Date(current.periodStart).toISOString(),
    periodEnd: new Date(current.periodEnd).toISOString(),
    autoRenewing: typeof billing.autoRenewing === 'boolean' ? billing.autoRenewing : null,
    invoiceId: billing.invoiceId?.trim() || null,
    billingCycle: cycle,
  };
}
