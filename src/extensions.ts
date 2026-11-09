import { app } from '@wix/astro/builders';
import productImages from './extensions/dashboard/pages/product-images/product-images.extension.ts';
import paidPlanPurchased from './extensions/backend/events/paid-plan-purchased/paid-plan-purchased.extension.ts';
import paidPlanChanged from './extensions/backend/events/paid-plan-changed/paid-plan-changed.extension.ts';

export default app().use(productImages).use(paidPlanPurchased).use(paidPlanChanged);
