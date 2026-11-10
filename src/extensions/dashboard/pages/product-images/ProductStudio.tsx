import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Card, Input, Text } from '@wix/design-system';
import { dashboard } from '@wix/dashboard';
import { EntityPage, useEntityPageContext } from '@wix/patterns';
import type { ImageAction, ProcessImageResponse } from '../../../../image-processing/contract';
import { fetchCredits, processProductImage } from './image-client';
import { publishProductImage } from './publish-api';
import { fetchProductPhotos, type ProductPhoto } from './media-api';
import type { CatalogProduct, ProductVisibility } from './products-api';

type ProductFormFields = {
  name: string;
  visibility: ProductVisibility;
  description: string;
};

const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Light gray', value: '#F2F2F2' },
  { label: 'Cream', value: '#F5EFE6' },
  { label: 'Black', value: '#111111' },
];

const SCENE_PRESETS: { label: string; value: string }[] = [
  { label: 'Wooden table, outdoors', value: 'on a wooden table outdoors, soft natural light' },
  { label: 'Kitchen counter', value: 'on a bright modern kitchen counter, morning light' },
  { label: 'Minimal studio', value: 'in a minimal studio with a soft gradient backdrop and a gentle shadow' },
  { label: 'Living room', value: 'in a cozy living room with warm light' },
  { label: 'Marble surface', value: 'on a white marble surface with soft window light' },
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the cutout image.'));
    image.src = src;
  });
}

async function compositeOnColor(cutoutUrl: string, color: string): Promise<string> {
  const image = await loadImage(cutoutUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create a drawing surface.');
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <Box direction="vertical" gap="SP2">
    <Text weight="bold">{title}</Text>
    {hint ? <Text size="small" secondary>{hint}</Text> : null}
    {children}
  </Box>
);

export const ProductStudio = ({
  productId,
  onCreditsChange,
}: {
  productId: string;
  onCreditsChange: (remaining: number) => void;
}) => {
  const page = useEntityPageContext<CatalogProduct, ProductFormFields>();
  const product = page.entity;
  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | undefined>();
  const [aiPrompt, setAiPrompt] = useState('in a bright modern studio with soft natural light');
  const [bgColor, setBgColor] = useState('#FFFFFF');
  const [pending, setPending] = useState<ImageAction | undefined>();
  const [result, setResult] = useState<ProcessImageResponse | undefined>();
  const busyRef = useRef(false);

  const loadPhotos = useCallback(async () => {
    setPhotos(await fetchProductPhotos(productId));
  }, [productId]);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  const source = selectedUrl ?? photos[0]?.url ?? product?.imageUrl;

  const showError = (error: unknown, fallback: string) => {
    console.error(fallback, error);
    dashboard.showToast({
      message: error instanceof Error ? error.message : fallback,
      type: 'error',
    });
  };

  const refreshCredits = () => {
    void fetchCredits()
      .then((credits) => onCreditsChange(credits.creditsRemaining))
      .catch((error: unknown) => console.error('Could not refresh credits', error));
  };

  const begin = (action: ImageAction): boolean => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setPending(action);
    return true;
  };

  const finish = () => {
    busyRef.current = false;
    setPending(undefined);
  };

  const call = async (action: ImageAction, prompt?: string) => {
    if (!product || !source) throw new Error('This product has no photo to edit.');
    return processProductImage({
      action,
      productId,
      productName: product.name,
      imageUrl: source,
      ...(prompt ? { prompt } : {}),
    });
  };

  const removeBackground = async () => {
    if (!begin('remove-background')) return;
    try {
      const response = await call('remove-background');
      setResult(response);
      if (typeof response.creditsRemaining === 'number') onCreditsChange(response.creditsRemaining);
      dashboard.showToast({ message: response.message, type: 'success' });
    } catch (error) {
      showError(error, 'Remove background failed');
      refreshCredits();
    } finally {
      finish();
    }
  };

  const replaceBackground = async () => {
    if (!HEX_COLOR.test(bgColor)) {
      dashboard.showToast({ message: 'Enter a colour like #FFFFFF.', type: 'error' });
      return;
    }
    if (!begin('replace-background')) return;
    try {
      const response = await call('replace-background', bgColor);
      const finalImage = await compositeOnColor(response.resultUrl, bgColor);
      setResult({ ...response, resultUrl: finalImage, message: `Background replaced with ${bgColor}.` });
      if (typeof response.creditsRemaining === 'number') onCreditsChange(response.creditsRemaining);
      dashboard.showToast({ message: `Background replaced with ${bgColor}.`, type: 'success' });
    } catch (error) {
      showError(error, 'Replace background failed');
      refreshCredits();
    } finally {
      finish();
    }
  };

  const aiScene = async () => {
    if (!begin('ai-scene')) return;
    try {
      const response = await call('ai-scene', aiPrompt.trim());
      setResult(response);
      if (typeof response.creditsRemaining === 'number') onCreditsChange(response.creditsRemaining);
      dashboard.showToast({ message: response.message, type: 'success' });
    } catch (error) {
      showError(error, 'AI scene failed');
      refreshCredits();
    } finally {
      finish();
    }
  };

  const publish = async () => {
    if (!product || !result) return;
    if (!begin('publish')) return;
    try {
      const outcome = await publishProductImage({
        productId,
        productName: product.name,
        imageUrl: result.resultUrl,
      });
      dashboard.showToast({ message: outcome.message, type: 'success' });
      await loadPhotos();
    } catch (error) {
      showError(error, 'Publish failed');
    } finally {
      finish();
    }
  };

  const busy = Boolean(pending);
  const noPhoto = !source;
  const before = result?.originalUrl ?? source;

  return (
    <EntityPage.Card>
      <Card.Header title="Photo studio" />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="SP5">
          <Section
            title="1. Choose the photo to edit"
            hint="The photo you click is the one every action below works on. Main photo is selected by default."
          >
            {photos.length > 0 ? (
              <Box gap="SP2">
                {photos.map((photo) => {
                  const selected = photo.url === source;
                  return (
                    <div
                      key={photo.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedUrl(photo.url)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setSelectedUrl(photo.url);
                      }}
                      style={{
                        cursor: 'pointer',
                        border: selected ? '3px solid #116dff' : '3px solid transparent',
                        borderRadius: 8,
                        padding: 2,
                        textAlign: 'center',
                      }}
                    >
                      <img
                        src={photo.url}
                        alt={photo.isMain ? 'Main photo' : 'Product photo'}
                        style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                      />
                      <Text size="tiny">{photo.isMain ? 'Main' : 'Photo'}</Text>
                    </div>
                  );
                })}
              </Box>
            ) : (
              <Text size="small">
                {noPhoto
                  ? 'This product has no photo yet, so the studio actions stay off.'
                  : 'Using the main photo of this product.'}
              </Text>
            )}
          </Section>

          <Section title="2. Edit this photo" hint="Remove and Replace background use 1 credit each, AI scene uses 2. When the balance runs out, buy more credits.">
            <Box direction="vertical" gap="SP4">
              <Section title="Remove background" hint="Gives a cut-out of the product with a transparent background.">
                <Button
                  priority="secondary"
                  disabled={busy || noPhoto}
                  onClick={() => {
                    void removeBackground();
                  }}
                >
                  {pending === 'remove-background' ? 'Working…' : 'Remove background'}
                </Button>
              </Section>

              <Section title="Replace background" hint="Puts the product on a plain colour of your choice.">
                <Box gap="SP2" verticalAlign="middle">
                  <input
                    type="color"
                    value={HEX_COLOR.test(bgColor) ? bgColor : '#FFFFFF'}
                    onChange={(event) => setBgColor(event.target.value.toUpperCase())}
                  />
                  <Input value={bgColor} onChange={(event) => setBgColor(event.target.value)} />
                </Box>
                <Box gap="SP2">
                  {COLOR_PRESETS.map((preset) => (
                    <Button key={preset.value} size="tiny" priority="secondary" onClick={() => setBgColor(preset.value)}>
                      {preset.label}
                    </Button>
                  ))}
                </Box>
                <Button
                  priority="secondary"
                  disabled={busy || noPhoto}
                  onClick={() => {
                    void replaceBackground();
                  }}
                >
                  {pending === 'replace-background' ? 'Working…' : 'Replace background'}
                </Button>
              </Section>

              <Section
                title="AI scene"
                hint="Keeps your product the same and creates a new scene around it. Describe the scene or pick one."
              >
                <Input
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  placeholder="for example: on a wooden table outdoors"
                />
                <Box gap="SP2" style={{ flexWrap: 'wrap' }}>
                  {SCENE_PRESETS.map((preset) => (
                    <Button key={preset.label} size="tiny" priority="secondary" onClick={() => setAiPrompt(preset.value)}>
                      {preset.label}
                    </Button>
                  ))}
                </Box>
                <Button
                  priority="secondary"
                  disabled={busy || noPhoto || !aiPrompt.trim()}
                  onClick={() => {
                    void aiScene();
                  }}
                >
                  {pending === 'ai-scene' ? 'Working…' : 'Create AI scene'}
                </Button>
              </Section>
            </Box>
          </Section>

          <Section title="3. Result">
            {before ? (
              <Box gap="SP4" style={{ flexWrap: 'wrap' }}>
                <Box direction="vertical" gap="SP1">
                  <Text size="small">Before (selected photo)</Text>
                  <img src={before} alt="Selected product photo" style={{ width: 280, height: 280, objectFit: 'contain' }} />
                </Box>
                {result ? (
                  <Box direction="vertical" gap="SP1">
                    <Text size="small">After</Text>
                    <img src={result.resultUrl} alt="Edited preview" style={{ width: 280, height: 280, objectFit: 'contain' }} />
                    <Text size="tiny">{result.message}</Text>
                    <Button
                      priority="primary"
                      disabled={busy || result.mocked}
                      onClick={() => {
                        void publish();
                      }}
                    >
                      {pending === 'publish' ? 'Publishing…' : 'Publish to product (becomes main photo)'}
                    </Button>
                    <Text size="tiny" secondary>
                      Your original photos stay in the product gallery.
                    </Text>
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </Section>

          <Section
            title="Generate a new image (coming soon)"
            hint="Creating an image from text will be a separate tool, so it never replaces your product photo."
          >
            <Button priority="secondary" disabled>
              Generate image
            </Button>
          </Section>
        </Box>
      </Card.Content>
    </EntityPage.Card>
  );
};
