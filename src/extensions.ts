import { app } from '@wix/astro/builders';
import productImages from './extensions/dashboard/pages/product-images/product-images.extension.ts';

export default app().use(productImages);
