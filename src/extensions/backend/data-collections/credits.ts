import type { DataCollection } from '@wix/astro/builders'

export const collectionIdSuffix = 'credits';

export default {
  idSuffix: collectionIdSuffix,
  displayName: 'credits',
  fields: [
    { type: 'TEXT', displayName: 'Title', key: 'title' },
    { type: 'TEXT', displayName: 'Site ID', key: 'siteId' },
    { type: 'TEXT', displayName: 'Plan', key: 'plan' },
    { type: 'TEXT', displayName: 'Period', key: 'period' },
    { type: 'NUMBER', displayName: 'Credits limit', key: 'creditsLimit' },
    { type: 'NUMBER', displayName: 'Credits used', key: 'creditsUsed' },
  ],
  displayField: 'title',
  dataPermissions: {
    itemInsert: 'PRIVILEGED',
    itemRead: 'PRIVILEGED',
    itemRemove: 'PRIVILEGED',
    itemUpdate: 'PRIVILEGED',
  },
  indexes: [],
  initialData: [],
} satisfies DataCollection;
