import React from 'react';
import { withDashboard } from '@wix/patterns';
import { WixPatternsProvider } from '@wix/patterns/provider';
import { PatternsReactRoute, PatternsReactRouter } from '@wix/patterns/router';
import { PlansPage } from './PlansPage';
import { ProductsCollectionPage } from './ProductsCollectionPage';
import { ProductEntityPage } from './ProductEntityPage';

export const ProductsApp = withDashboard(() => (
  <WixPatternsProvider>
    <PatternsReactRouter>
      <PatternsReactRoute
        type="collection"
        path="/"
        element={<ProductsCollectionPage />}
      />
      <PatternsReactRoute
        type="other"
        path="/credits"
        element={<PlansPage />}
      />
      <PatternsReactRoute
        type="editEntity"
        path="/:id"
        element={<ProductEntityPage />}
      />
    </PatternsReactRouter>
  </WixPatternsProvider>
));
