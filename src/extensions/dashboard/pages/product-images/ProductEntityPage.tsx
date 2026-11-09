import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Card, Dropdown, FormField, Input, InputArea } from '@wix/design-system';
import { EntityPage, useEntityPage, useEntityPageContext } from '@wix/patterns';
import { useController, useForm } from '@wix/patterns/form';
import { fetchBilling } from './billing-client';
import { fetchCredits } from './image-client';
import { fetchProduct, saveProduct, type CatalogProduct, type ProductVisibility } from './products-api';
import { ProductStudio } from './ProductStudio';

type ProductFormFields = {
  name: string;
  visibility: ProductVisibility;
  description: string;
};

const VISIBILITY_OPTIONS: { id: ProductVisibility; value: string }[] = [
  { id: 'VISIBLE', value: 'Visible' },
  { id: 'HIDDEN', value: 'Hidden' },
];

export const ProductEntityPage = () => {
  const { id } = useParams<{ id?: string }>();
  const form = useForm<ProductFormFields>();
  const [creditsLabel, setCreditsLabel] = useState('Credits …');

  useEffect(() => {
    let active = true;
    fetchBilling()
      .then((billing) => {
        if (!active) return;
        setCreditsLabel(typeof billing.balance === 'number' ? `${billing.balance} credits` : 'Credits unavailable');
      })
      .catch((error: unknown) => {
        console.error('Could not load credits', error);
        void fetchCredits()
          .then((credits) => {
            if (active) setCreditsLabel(`${credits.creditsRemaining} credits`);
          })
          .catch(() => {
            if (active) setCreditsLabel('Credits unavailable');
          });
      });
    return () => {
      active = false;
    };
  }, []);

  const state = useEntityPage<CatalogProduct, ProductFormFields>({
    parentPath: '/',
    isNewEntity: () => !id,
    form,
    fetch: async () => ({ entity: id ? await fetchProduct(id) : undefined }),
    onSave: async ({ entity }) => {
      if (!id || !entity) throw new Error('This page only edits an existing product.');
      const values = form.getValues();
      return {
        updatedEntity: await saveProduct({
          ...entity,
          id,
          name: values.name,
          visibility: values.visibility,
          description: values.description,
        }),
      };
    },
    saveSuccessToast: 'Product saved',
    saveErrorToast: () => 'Failed to save the product',
  });

  return (
    <EntityPage state={state}>
      <EntityPage.Header
        title={{
          text: 'Edit product photo',
          badges: [{ text: creditsLabel, skin: 'premium' }],
        }}
        subtitle={{ text: 'Save updates the name, visibility, and description in Wix Stores.' }}
      />
      <EntityPage.Content>
        <EntityPage.MainContent>
          <EntityPage.Card>
            <Card.Header title="Details" />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="SP2">
                <NameField />
                <VisibilityField />
                <DescriptionField />
              </Box>
            </Card.Content>
          </EntityPage.Card>
          {id ? (
            <ProductStudio
              productId={id}
              onCreditsChange={(remaining) => setCreditsLabel(`${remaining} credits`)}
            />
          ) : null}
        </EntityPage.MainContent>
      </EntityPage.Content>
    </EntityPage>
  );
};

const NameField = () => {
  const page = useEntityPageContext<CatalogProduct, ProductFormFields>();
  const { field, fieldState } = useController({
    name: 'name',
    control: page.form.control,
    defaultValue: page.entity?.name ?? '',
    rules: {
      required: { value: true, message: 'A name is required' },
      maxLength: { value: 80, message: 'Use 80 characters or fewer' },
    },
  });
  return (
    <FormField
      label="Name"
      required
      status={fieldState.error ? 'error' : undefined}
      statusMessage={fieldState.error?.message}
    >
      <Input
        inputRef={field.ref}
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
      />
    </FormField>
  );
};

const VisibilityField = () => {
  const page = useEntityPageContext<CatalogProduct, ProductFormFields>();
  const { field } = useController({
    name: 'visibility',
    control: page.form.control,
    defaultValue: page.entity?.visibility ?? 'VISIBLE',
  });
  return (
    <FormField label="Visibility">
      <Dropdown
        options={VISIBILITY_OPTIONS}
        selectedId={field.value}
        onSelect={(option) => {
          if (option.id === 'VISIBLE' || option.id === 'HIDDEN') field.onChange(option.id);
        }}
        onBlur={field.onBlur}
      />
    </FormField>
  );
};

const DescriptionField = () => {
  const page = useEntityPageContext<CatalogProduct, ProductFormFields>();
  const { field, fieldState } = useController({
    name: 'description',
    control: page.form.control,
    defaultValue: page.entity?.description ?? '',
    rules: { maxLength: { value: 8000, message: 'Use 8,000 characters or fewer' } },
  });
  return (
    <FormField
      label="Description"
      status={fieldState.error ? 'error' : undefined}
      statusMessage={fieldState.error?.message}
    >
      <InputArea
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        rows={4}
        placeholder="Shown on the product and available as context for a scene prompt"
      />
    </FormField>
  );
};
