import React, { useEffect, useRef, useState } from 'react';
import { Badge, Image, Text } from '@wix/design-system';
import { dashboard } from '@wix/dashboard';
import {
  CollectionEmptyState,
  CollectionErrorState,
  CollectionNoResultsState,
  CollectionSearch,
  CollectionToolbarFilters,
  MultiBulkActionToolbar,
  MultiSelectCheckboxFilter,
  Table,
  stringsArrayFilter,
  useStaticListFilterCollection,
  useTableCollection,
  useWixPatternsContainer,
} from '@wix/patterns';
import { CollectionPage } from '@wix/patterns/page';
import { usePatternsNavigate } from '@wix/patterns/router';
import { Sparkles } from '@wix/wix-ui-icons-common/lazy';
import { defaultPrompt, fetchCredits, processProductImage } from './image-client';
import {
  fetchProductsPage,
  type CatalogProduct,
  type CatalogProductType,
} from './products-api';

const TYPE_LABELS: Record<CatalogProductType, string> = {
  PHYSICAL: 'Physical',
  DIGITAL: 'Digital',
};

const productTypeFilter = stringsArrayFilter<CatalogProductType>({
  name: 'productType',
  itemKey: (value) => value,
  itemName: (value) => TYPE_LABELS[value],
});

export const ProductsCollectionPage = () => {
  const { navigateToEntityPage } = usePatternsNavigate<CatalogProduct>();
  const { errorHandler } = useWixPatternsContainer();
  const [creditsLabel, setCreditsLabel] = useState('Credits …');
  const batchRef = useRef(false);

  useEffect(() => {
    let active = true;
    fetchCredits()
      .then((credits) => {
        if (active) setCreditsLabel(`${credits.creditsRemaining} credits`);
      })
      .catch((error: unknown) => {
        console.error('Could not load credits', error);
        if (active) setCreditsLabel('Credits unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  const state = useTableCollection<CatalogProduct, { productType: typeof productTypeFilter }>({
    queryName: 'catalog-products',
    paginationMode: 'cursor',
    itemKey: (item) => item.id,
    itemName: (item) => item.name,
    filters: { productType: productTypeFilter },
    fetchData: (query) =>
      fetchProductsPage({
        limit: query.limit,
        cursor: query.cursor ?? undefined,
        search: query.search,
        filters: { productType: query.filters.productType },
      }),
    fetchErrorMessage: ({ err }) =>
      err instanceof Error ? err.message : 'Failed to load products',
  });

  const typeOptions = useStaticListFilterCollection(productTypeFilter, ['PHYSICAL', 'DIGITAL']);

  const applyScene = async (selected: CatalogProduct[]) => {
    const withPhotos = selected.filter((product) => product.imageUrl);
    if (withPhotos.length === 0) {
      dashboard.showToast({
        message: 'Select a product that already has a photo.',
        type: 'warning',
      });
      return;
    }
    if (batchRef.current) return;
    batchRef.current = true;
    let lastCredits = creditsLabel;
    try {
      for (const product of withPhotos) {
        const result = await processProductImage({
          action: 'ai-scene',
          productId: product.id,
          productName: product.name,
          ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
          prompt: defaultPrompt('ai-scene'),
        });
        if (typeof result.creditsRemaining === 'number') lastCredits = `${result.creditsRemaining} credits`;
      }
      setCreditsLabel(lastCredits);
      dashboard.showToast({
        message: `Previewed an AI scene for ${withPhotos.length} product${withPhotos.length === 1 ? '' : 's'}. Open a product to compare before and after.`,
        type: 'success',
      });
    } catch (error) {
      console.error('Batch AI scene failed', error);
      dashboard.showToast({
        message: error instanceof Error ? error.message : 'Batch AI scene failed',
        type: 'error',
      });
      try {
        const credits = await fetchCredits();
        setCreditsLabel(`${credits.creditsRemaining} credits`);
      } catch (refreshError) {
        console.error('Could not refresh credits', refreshError);
      }
    } finally {
      batchRef.current = false;
    }
  };

  return (
    <CollectionPage>
      <CollectionPage.Header
        title={{
          text: 'AI Product Images',
          hideTotal: true,
          badges: [{ text: creditsLabel, skin: 'premium' }],
        }}
        subtitle={{
          text: 'Open a product to remove or replace the background, preview a lifestyle scene, and compare it with the current photo.',
        }}
      />
      <CollectionPage.Content>
        <Table
          state={state}
          horizontalScroll
          search={<CollectionSearch placeholder="Search by product name" />}
          filters={
            <CollectionToolbarFilters>
              <MultiSelectCheckboxFilter
                filter={productTypeFilter}
                collection={typeOptions}
                toolbarItemProps={{ label: 'Product type' }}
                accordionItemProps={{ label: 'Product type' }}
              />
            </CollectionToolbarFilters>
          }
          bulkActionToolbar={({ selectedValues }) => (
            <MultiBulkActionToolbar
              primaryActionItems={[
                {
                  label: 'AI scene',
                  prefixIcon: <Sparkles />,
                  onClick: () => {
                    void applyScene(selectedValues);
                  },
                },
              ]}
            />
          )}
          emptyState={
            <CollectionEmptyState
              title="No products yet"
              subtitle="Products from Wix Stores show up here. Hidden products stay out of this list until the app can read them."
            />
          }
          noResultsState={
            <CollectionNoResultsState
              title="No products match"
              subtitle="Name search matches the start of the name on a classic catalog, and the product name on the current catalog. Clear the product type filter to widen the list."
            />
          }
          errorState={(err, { retry }) => {
            const resolved = errorHandler.getResolvedError?.(err);
            return (
              <CollectionErrorState
                title="Couldn't load products"
                subtitle={resolved?.message}
                requestId={resolved?.requestId}
                action={{ text: 'Retry', onClick: retry }}
              />
            );
          }}
          onRowClick={(item) =>
            navigateToEntityPage({ path: `/${item.id}`, entity: item })
          }
          columns={[
            {
              id: 'image',
              title: '',
              width: '72px',
              mobile: { column: 'image' },
              render: (item) =>
                item.imageUrl ? (
                  <Image src={item.imageUrl} width="48px" height="48px" alt="" fit="cover" />
                ) : (
                  <Text size="tiny">No photo</Text>
                ),
            },
            {
              id: 'name',
              title: 'Name',
              render: (item) => item.name,
              mobile: { column: 'first', order: 1 },
            },
            {
              id: 'visibility',
              title: 'Visibility',
              render: (item) => (
                <Badge size="small" skin={item.visibility === 'VISIBLE' ? 'success' : 'neutral'}>
                  {item.visibility === 'VISIBLE' ? 'Visible' : 'Hidden'}
                </Badge>
              ),
              mobile: { column: 'second' },
            },
          ]}
        />
      </CollectionPage.Content>
    </CollectionPage>
  );
};
