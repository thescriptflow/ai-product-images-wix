import { grantPaidPlan } from './purchases';
import { syncSiteSubscription } from './subscription';

export interface PlanEventInput {
  name: string;
  cycle?: string | null;
  vendorProductId?: string | null;
  invoiceId?: string | null;
  operationTimeStamp?: Date | string | null;
  eventSiteId?: string | null;
  /** Purchased and Changed name the new plan. Wait until the instance shows it. */
  requirePlan?: boolean;
}

export async function handlePlanEvent(input: PlanEventInput): Promise<void> {
  try {
    if (input.cycle === 'ONE_TIME') {
      await grantPaidPlan({
        cycle: input.cycle,
        vendorProductId: input.vendorProductId,
        invoiceId: input.invoiceId,
        operationTimeStamp: input.operationTimeStamp,
        eventSiteId: input.eventSiteId,
      });
      return;
    }
    await syncSiteSubscription({
      siteId: input.eventSiteId,
      expectedProductId: input.requirePlan ? input.vendorProductId : undefined,
    });
  } catch (error) {
    console.error(`${input.name} credit sync failed`, error);
    throw error;
  }
}
