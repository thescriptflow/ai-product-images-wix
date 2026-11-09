import { appInstances } from '@wix/app-management';
import { grantPaidPlan } from '../../../../billing/purchases';

export default appInstances.onAppInstancePaidPlanPurchased(async (event) => {
  try {
    await grantPaidPlan({
      cycle: event.data.cycle,
      vendorProductId: event.data.vendorProductId,
      invoiceId: event.data.invoiceId,
      eventSiteId: event.metadata.accountInfo?.siteId,
    });
  } catch (error) {
    console.error('Paid plan purchased grant failed', error);
    throw error;
  }
});
