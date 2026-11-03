import React, { useState } from 'react';
import { Box, Button, Card, FormField, Image, Input, Text } from '@wix/design-system';
import { dashboard } from '@wix/dashboard';
import { EntityPage, useEntityPageContext } from '@wix/patterns';
import type { ImageAction, ProcessImageResponse } from '../../../../image-processing/contract';
import { processProductImage } from './image-client';
import type { CatalogProduct, ProductVisibility } from './products-api';

type ProductFormFields = {
  name: string;
  visibility: ProductVisibility;
  description: string;
};

const ACTIONS: { action: ImageAction; label: string }[] = [
  { action: 'remove-background', label: 'Remove background' },
  { action: 'replace-background', label: 'Replace background' },
  { action: 'ai-scene', label: 'AI scene' },
  { action: 'publish', label: 'Publish' },
];

export const ProductStudio = ({
  productId,
  onCreditsChange,
}: {
  productId: string;
  onCreditsChange: (remaining: number) => void;
}) => {
  const page = useEntityPageContext<CatalogProduct, ProductFormFields>();
  const product = page.entity;
  const [prompt, setPrompt] = useState('Lifestyle scene with natural light');
  const [pending, setPending] = useState<ImageAction | undefined>();
  const [result, setResult] = useState<ProcessImageResponse | undefined>();

  const run = async (action: ImageAction) => {
    if (!product) return;
    setPending(action);
    try {
      const response = await processProductImage({
        action,
        productId,
        productName: product.name,
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
      });
      setResult(response);
      onCreditsChange(response.creditsRemaining);
      dashboard.showToast({ message: response.message, type: 'success' });
    } catch (error) {
      console.error('Image action failed', error);
      dashboard.showToast({
        message: error instanceof Error ? error.message : 'Image action failed',
        type: 'error',
      });
    } finally {
      setPending(undefined);
    }
  };

  const original = result?.originalUrl ?? product?.imageUrl;

  return (
    <EntityPage.Card>
      <Card.Header title="Photo studio" />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="SP3">
          <Text size="small">
            Remove background, replace background, and AI scene return a preview. Publish does not
            change the store photo until a live provider is connected.
          </Text>
          <FormField label="Scene or background prompt">
            <Input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Soft gray studio background"
            />
          </FormField>
          <Box direction="vertical" gap="SP2">
            {ACTIONS.map((item) => (
              <Button
                key={item.action}
                priority={item.action === 'publish' ? 'primary' : 'secondary'}
                disabled={Boolean(pending) || !product?.imageUrl}
                onClick={() => {
                  void run(item.action);
                }}
              >
                {pending === item.action ? 'Working…' : item.label}
              </Button>
            ))}
          </Box>
          {!product?.imageUrl ? (
            <Text size="small">This product has no photo yet, so the studio actions stay off.</Text>
          ) : null}
          {original ? (
            <Box direction="vertical" gap="SP1">
              <Text size="small">Before</Text>
              <Image src={original} width="280px" height="280px" alt="Current product photo" fit="contain" />
            </Box>
          ) : null}
          {result ? (
            <Box direction="vertical" gap="SP1">
              <Text size="small">After</Text>
              <Image src={result.resultUrl} width="280px" height="280px" alt="Processed preview" fit="contain" />
              <Text size="tiny">{result.message}</Text>
            </Box>
          ) : null}
        </Box>
      </Card.Content>
    </EntityPage.Card>
  );
};
