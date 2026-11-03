import { extensions } from '@wix/astro/builders';

export default extensions.dashboardPage({
  id: '9e8e962b-aa16-43f5-9a5b-d70608d1d633',
  title: 'AI Product Images',
  routePath: 'product-images',
  component: './extensions/dashboard/pages/product-images/product-images.tsx',
  fullPage: false,
  metaData: {
    searchable: true,
    description: 'Generate and compare AI product photos, then publish them to Wix Stores.',
  },
});
