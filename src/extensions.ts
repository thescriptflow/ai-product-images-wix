import { app } from '@wix/astro/builders';
import productImages from './extensions/dashboard/pages/product-images/product-images.extension.ts';

import dataCollections from './extensions/backend/data-collections/data-collections.extension.ts';

export default app().use(productImages).use(dataCollections);
