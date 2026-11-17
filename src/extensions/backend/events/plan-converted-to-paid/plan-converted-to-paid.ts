import { appInstances } from '@wix/app-management';
import { handlePlanEvent } from '../../../../billing/plan-events';

export default appInstances.onAppInstancePlanConvertedToPaid(async (event) => {
  await handlePlanEvent({
    name: 'Plan converted to paid',
    cycle: event.data.cycle,
    vendorProductId: event.data.vendorProductId,
    eventSiteId: event.metadata.accountInfo?.siteId,
  });
});
