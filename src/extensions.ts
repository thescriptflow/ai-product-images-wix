import { app } from '@wix/astro/builders';
import productImages from './extensions/dashboard/pages/product-images/product-images.extension.ts';
import paidPlanPurchased from './extensions/backend/events/paid-plan-purchased/paid-plan-purchased.extension.ts';
import paidPlanChanged from './extensions/backend/events/paid-plan-changed/paid-plan-changed.extension.ts';
import paidPlanAutoRenewalCancelled from './extensions/backend/events/paid-plan-auto-renewal-cancelled/paid-plan-auto-renewal-cancelled.extension.ts';
import planReactivated from './extensions/backend/events/plan-reactivated/plan-reactivated.extension.ts';
import planConvertedToPaid from './extensions/backend/events/plan-converted-to-paid/plan-converted-to-paid.extension.ts';
import planTransferred from './extensions/backend/events/plan-transferred/plan-transferred.extension.ts';

export default app()
  .use(productImages)
  .use(paidPlanPurchased)
  .use(paidPlanChanged)
  .use(paidPlanAutoRenewalCancelled)
  .use(planReactivated)
  .use(planConvertedToPaid)
  .use(planTransferred);
