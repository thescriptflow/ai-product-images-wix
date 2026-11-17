import { appInstances } from '@wix/app-management';
import { handlePlanEvent } from '../../../../billing/plan-events';

export default appInstances.onAppInstancePlanReactivated(async (event) => {
  await handlePlanEvent({
    name: 'Plan reactivated',
    cycle: event.data.cycle,
    vendorProductId: event.data.vendorProductId,
    eventSiteId: event.metadata.accountInfo?.siteId,
  });
});
