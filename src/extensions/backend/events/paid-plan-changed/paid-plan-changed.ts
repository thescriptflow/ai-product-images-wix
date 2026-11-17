import { appInstances } from '@wix/app-management';
import { handlePlanEvent } from '../../../../billing/plan-events';

export default appInstances.onAppInstancePaidPlanChanged(async (event) => {
  await handlePlanEvent({
    name: 'Paid plan changed',
    cycle: event.data.cycle,
    vendorProductId: event.data.vendorProductId,
    invoiceId: event.data.invoiceId,
    operationTimeStamp: event.data.operationTimeStamp,
    eventSiteId: event.metadata.accountInfo?.siteId,
  });
});
