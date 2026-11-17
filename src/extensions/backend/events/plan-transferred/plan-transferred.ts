import { appInstances } from '@wix/app-management';
import { handlePlanEvent } from '../../../../billing/plan-events';

export default appInstances.onAppInstancePlanTransferred(async (event) => {
  await handlePlanEvent({
    name: 'Plan transferred',
    cycle: event.data.cycle,
    vendorProductId: event.data.vendorProductId,
    eventSiteId: event.metadata.accountInfo?.siteId,
  });
});
