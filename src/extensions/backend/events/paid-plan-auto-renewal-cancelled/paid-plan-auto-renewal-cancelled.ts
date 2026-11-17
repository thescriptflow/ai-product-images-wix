import { appInstances } from '@wix/app-management';
import { handlePlanEvent } from '../../../../billing/plan-events';

export default appInstances.onAppInstancePaidPlanAutoRenewalCancelled(async (event) => {
  await handlePlanEvent({
    name: 'Paid plan auto-renewal cancelled',
    cycle: event.data.cycle,
    vendorProductId: event.data.vendorProductId,
    eventSiteId: event.metadata.accountInfo?.siteId,
  });
});
