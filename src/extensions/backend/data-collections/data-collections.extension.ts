import { extensions } from '@wix/astro/builders'

import creditsCollection from './credits';

export default extensions.dataCollections({
  id: '7ae4c95e-abe0-4937-828e-b82f0f784c6f',
  name: 'Data Collections',
  collections: [creditsCollection],
});
