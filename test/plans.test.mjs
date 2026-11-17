import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMonthsUtc,
  monthlyCycle,
  planByProductId,
  planOffers,
  subscriptionState,
  upgradeUrl,
} from '../src/billing/plans.ts';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test('plans default to the Dev Center product ids', () => {
  const offers = planOffers({});
  assert.deepEqual(offers.map((offer) => [offer.productId, offer.credits, offer.priceLabel]), [
    ['20-credits', 20, '$9.99/month'],
    ['60-credits', 60, '$24.99/month'],
    ['150-credits', 150, '$49.99/month'],
  ]);
  assert.equal(planByProductId('60-credits', {})?.credits, 60);
  assert.equal(planByProductId('basic', {}), undefined);
});

test('env product ids override the defaults, new names first', () => {
  const env = { PLAN_20_PRODUCT_ID: 'monthly-20', CREDIT_PACK_20_PRODUCT_ID: 'old-20', CREDIT_PACK_60_PRODUCT_ID: 'old-60' };
  assert.equal(planByProductId('monthly-20', env)?.credits, 20);
  assert.equal(planByProductId('old-60', env)?.credits, 60);
  assert.equal(planByProductId('20-credits', env), undefined);
  assert.equal(planByProductId('150-credits', { PLAN_150_PRODUCT_ID: 'bad id' })?.credits, 150);
});

test('month math clamps to the end of shorter months', () => {
  const jan31 = Date.UTC(2026, 0, 31, 10, 0, 0);
  assert.equal(iso(addMonthsUtc(jan31, 1)), '2026-02-28T10:00:00.000Z');
  assert.equal(iso(addMonthsUtc(jan31, 2)), '2026-03-31T10:00:00.000Z');
  assert.equal(iso(addMonthsUtc(Date.UTC(2026, 10, 15), 2)), '2027-01-15T00:00:00.000Z');
});

test('monthly cycles count whole billing months from the purchase time', () => {
  const start = Date.UTC(2026, 0, 15, 12, 0, 0);
  assert.deepEqual(monthlyCycle(start, start), { index: 0, periodStart: start, periodEnd: Date.UTC(2026, 1, 15, 12) });
  assert.equal(monthlyCycle(start, Date.UTC(2026, 1, 15, 11, 59)).index, 0);
  assert.equal(monthlyCycle(start, Date.UTC(2026, 1, 15, 12, 0)).index, 1);
  const later = monthlyCycle(start, Date.UTC(2026, 10, 17));
  assert.equal(later.index, 10);
  assert.equal(iso(later.periodStart), '2026-11-15T12:00:00.000Z');
  assert.equal(iso(later.periodEnd), '2026-12-15T12:00:00.000Z');
  assert.equal(monthlyCycle(start, start - DAY).index, 0);
});

test('a monthly plan becomes an active cycle with a stable key', () => {
  const now = Date.UTC(2026, 2, 20);
  const billing = {
    packageName: '60-credits',
    billingCycle: 'MONTHLY',
    timeStamp: '2026-01-15T12:00:00.000Z',
    autoRenewing: true,
    invoiceId: '123',
  };
  const state = subscriptionState({ isFree: false, billing }, now, {});
  assert.equal(state.kind, 'active');
  assert.equal(state.plan.credits, 60);
  assert.equal(state.cycleKey, `60-credits.${Date.UTC(2026, 0, 15, 12)}.2`);
  assert.equal(state.periodStart, '2026-03-15T12:00:00.000Z');
  assert.equal(state.periodEnd, '2026-04-15T12:00:00.000Z');
  assert.equal(state.autoRenewing, true);
  assert.equal(state.invoiceId, '123');
  const again = subscriptionState({ isFree: false, billing: { ...billing, timeStamp: new Date(billing.timeStamp) } }, now + DAY, {});
  assert.equal(again.cycleKey, state.cycleKey);
});

test('yearly plans still refill every month', () => {
  const state = subscriptionState(
    { isFree: false, billing: { packageName: '20-credits', billingCycle: 'YEARLY', timeStamp: '2026-01-01T00:00:00.000Z' } },
    Date.UTC(2026, 5, 2),
    {},
  );
  assert.equal(state.kind, 'active');
  assert.equal(state.cycleKey.endsWith('.5'), true);
});

test('free sites, trials, one-time packs and unknown plans do not grant', () => {
  const now = Date.UTC(2026, 2, 20);
  assert.deepEqual(subscriptionState({ isFree: true, billing: null }, now, {}), { kind: 'none' });
  assert.deepEqual(subscriptionState({ isFree: false, billing: { packageName: '' } }, now, {}), { kind: 'none' });
  assert.equal(subscriptionState({
    isFree: false,
    billing: { packageName: '20-credits', billingCycle: 'MONTHLY', timeStamp: '2026-01-01T00:00:00Z', freeTrialInfo: { status: 'IN_PROGRESS' } },
  }, now, {}).kind, 'skip');
  assert.equal(subscriptionState({
    isFree: false,
    billing: { packageName: '20-credits', billingCycle: 'ONE_TIME', timeStamp: '2026-01-01T00:00:00Z' },
  }, now, {}).kind, 'skip');
  assert.equal(subscriptionState({
    isFree: false,
    billing: { packageName: 'mystery', billingCycle: 'MONTHLY', timeStamp: '2026-01-01T00:00:00Z' },
  }, now, {}).kind, 'skip');
  assert.equal(subscriptionState({
    isFree: false,
    billing: { packageName: '20-credits', billingCycle: 'MONTHLY' },
  }, now, {}).kind, 'skip');
});

test('the upgrade link is the documented Wix pricing page URL', () => {
  assert.equal(
    upgradeUrl('abc-123'),
    'https://www.wix.com/apps/upgrade/daa76557-f2cc-4d12-8993-97f3a766f87a?appInstanceId=abc-123',
  );
});
