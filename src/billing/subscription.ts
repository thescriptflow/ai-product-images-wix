import { readEnv } from '../image-processing/service';
import { syncSubscriptionCredits, type CreditsAccount } from '../image-processing/credits-client';
import { siteFromInstance, type InstalledApp } from './purchases';
import { subscriptionState, type SubscriptionState } from './plans';

/**
 * Monthly plan credits.
 *
 * Wix sends Paid Plan Purchased / Changed / Reactivated / Converted To Paid /
 * Transferred / Auto Renewal Cancelled events, but no event on a normal monthly
 * renewal. So every event and every dashboard load reads Get App Instance and
 * sends the current billing month to the credits API. The credits API grants
 * each month once (keyed by plan, purchase time, and month number), resets
 * unused plan credits, and ignores repeats.
 */
export interface SubscriptionSyncResult {
  installed: InstalledApp;
  state: SubscriptionState;
  account?: CreditsAccount;
}

export async function syncSiteSubscription(input: {
  siteId?: string | null;
  expectedProductId?: string | null;
  installed?: InstalledApp;
  now?: number;
}): Promise<SubscriptionSyncResult> {
  const installed = input.installed ?? (await siteFromInstance());
  const callerSiteId = input.siteId?.trim() ?? '';
  if (callerSiteId && installed.siteId && callerSiteId !== installed.siteId) {
    throw new Error('The site does not match the app installation.');
  }
  const siteId = callerSiteId || installed.siteId;
  if (!siteId) throw new Error('Could not identify the site for this plan.');

  const env = readEnv();
  const state = subscriptionState(
    { isFree: installed.isFree, billing: installed.billing },
    input.now ?? Date.now(),
    env,
  );
  const expected = input.expectedProductId?.trim() ?? '';
  if (expected && (state.kind === 'none' || (state.kind === 'active' && state.productId !== expected))) {
    // The event can arrive before Get App Instance shows the new plan. Fail so
    // the event is retried; the next dashboard load also catches up.
    const seen = state.kind === 'active' ? state.productId : state.kind;
    throw new Error(`App instance does not show plan ${expected} yet (it shows ${seen}).`);
  }

  if (state.kind === 'skip') {
    console.error(`Subscription credits skipped: ${state.reason}.`);
    return { installed, state };
  }
  if (state.kind === 'none') {
    const account = await syncSubscriptionCredits(siteId, { active: false }, env);
    if (account.ended) console.error(`Monthly plan ended. ${account.expired} unused plan credits expired.`);
    return { installed, state, account };
  }
  const account = await syncSubscriptionCredits(
    siteId,
    {
      active: true,
      plan: state.productId,
      credits: state.plan.credits,
      cycleKey: state.cycleKey,
      periodStart: state.periodStart,
      periodEnd: state.periodEnd,
      autoRenewing: state.autoRenewing,
      invoiceId: state.invoiceId,
    },
    env,
  );
  if (account.granted > 0) {
    console.error(
      `Granted ${account.granted} monthly credits for ${state.productId} (${state.billingCycle}) cycle ${state.cycleKey}; ${account.expired} unused plan credits reset.`,
    );
  }
  return { installed, state, account };
}
