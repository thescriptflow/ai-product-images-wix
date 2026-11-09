import { catalogVersioning, products, productsV3 } from '@wix/stores';
import { files } from '@wix/media';

export interface PublishInput {
  productId: string;
  productName: string;
  imageUrl: string;
}

export interface PublishResult {
  fileId: string;
  mode: 'main-photo' | 'gallery-only';
  message: string;
}

const MAX_V3_MEDIA_ITEMS = 15;
const MEDIA_FIELDS = ['MEDIA_ITEMS_INFO'] as const;

function extensionOf(url: string): string {
  const match = /\.(png|jpe?g|webp)(?:[?#]|$)/i.exec(url);
  const raw = (match?.[1] ?? 'png').toLowerCase();
  return raw === 'jpeg' ? 'jpg' : raw;
}

function mimeFor(ext: string): string {
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-');
  return cleaned || 'product';
}

function fileIdFromWixImage(image: string | undefined): string | undefined {
  if (!image) return undefined;
  const match = /^wix:image:\/\/v1\/([^/#]+)/.exec(image);
  return match?.[1];
}

async function importUrlToMediaManager(url: string, productName: string): Promise<string> {
  const ext = extensionOf(url);
  const imported: unknown = await files.importFile(url, {
    displayName: `${safeName(productName)}-edited.${ext}`,
    mimeType: mimeFor(ext),
  } as never);
  const holder = imported as { file?: { _id?: string; id?: string }; _id?: string; id?: string };
  const descriptor = holder.file ?? holder;
  const id = descriptor._id ?? descriptor.id;
  if (!id) throw new Error('Wix did not return an ID for the imported photo.');
  return id;
}

async function uploadDataUrlToMediaManager(dataUrl: string, productName: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const mime = blob.type || 'image/jpeg';
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const fileName = `${safeName(productName)}-edited.${ext}`;
  const generated: unknown = await files.generateFileUploadUrl(mime, { fileName } as never);
  const uploadUrl = (generated as { uploadUrl?: string }).uploadUrl;
  if (!uploadUrl) throw new Error('Wix did not return an upload URL.');
  const response = await fetch(`${uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`Upload to Media Manager failed (${response.status}).`);
  }
  const json = (await response.json()) as { file?: { id?: string; _id?: string } };
  const id = json.file?.id ?? json.file?._id;
  if (!id) throw new Error('Wix did not return an ID for the uploaded photo.');
  return id;
}

async function waitUntilReady(fileId: string): Promise<void> {
  const attempts = 30;
  for (let i = 0; i < attempts; i += 1) {
    const descriptor: unknown = await files.getFileDescriptor(fileId);
    const holder = descriptor as { file?: { operationStatus?: string }; operationStatus?: string };
    const status = (holder.file ?? holder).operationStatus;
    if (!status || status === 'READY') return;
    if (status === 'FAILED') {
      throw new Error('Wix could not process the uploaded photo. Nothing was changed on your product.');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Wix is still processing the photo. Nothing was changed on your product, please try Publish again in a minute.');
}

async function publishV3(productId: string, fileId: string, altText: string): Promise<void> {
  const current = await productsV3.getProduct(productId, { fields: [...MEDIA_FIELDS] });
  if (current.revision == null) {
    throw new Error('This product has no revision, so it cannot be updated.');
  }
  const existing = current.media?.itemsInfo?.items ?? [];
  if (existing.length >= MAX_V3_MEDIA_ITEMS) {
    throw new Error('This product already has 15 media items. Remove one first, then publish again.');
  }
  const kept = existing.map((item) => {
    const record = item as unknown as { image?: string; altText?: string };
    const id = fileIdFromWixImage(record.image);
    if (!id) {
      throw new Error(
        'This product has a media item I cannot safely keep (for example a video). Nothing was changed.',
      );
    }
    return { id, ...(record.altText ? { altText: record.altText } : {}) };
  });
  const items = [{ id: fileId, altText }, ...kept];
  const update = { revision: current.revision, media: { itemsInfo: { items } } };
  await productsV3.updateProduct(productId, update as unknown as productsV3.UpdateProduct);
}

const MAX_MEDIA_BATCH = 50;

function v1MediaIds(product: products.Product | undefined): string[] {
  return (product?.media?.items ?? []).flatMap((item) => (item._id ? [item._id] : []));
}

function v1MainId(product: products.Product | undefined): string | undefined {
  return product?.media?.mainMedia?._id ?? product?.media?.items?.[0]?._id;
}

interface ChoiceLink {
  option: string;
  choice: string;
  mediaIds: string[];
}

function v1ChoiceLinks(product: products.Product | undefined): ChoiceLink[] {
  const links: ChoiceLink[] = [];
  for (const option of product?.productOptions ?? []) {
    if (!option.name) continue;
    for (const choice of option.choices ?? []) {
      const ids = (choice.media?.items ?? []).flatMap((item) => (item._id ? [item._id] : []));
      if (choice.value && ids.length > 0) links.push({ option: option.name, choice: choice.value, mediaIds: ids });
    }
  }
  return links;
}

function batchesOf(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += MAX_MEDIA_BATCH) {
    batches.push(ids.slice(index, index + MAX_MEDIA_BATCH));
  }
  return batches;
}

/**
 * Catalog V1 Update Product marks `media` read-only. The main image is the
 * primary media item, so the new file is added, the previous items are removed
 * (leaving the new file as the only, and therefore main, image), then the
 * previous items are added back after it.
 */
async function publishV1(productId: string, fileId: string): Promise<'main-photo' | 'gallery-only'> {
  const before = await products.getProduct(productId);
  const beforeIds = new Set(v1MediaIds(before.product));
  const links = v1ChoiceLinks(before.product);
  await products.addProductMedia(productId, [{ mediaId: fileId }]);

  let current = await products.getProduct(productId);
  let currentIds = v1MediaIds(current.product);
  let added = currentIds.filter((id) => !beforeIds.has(id));
  if (added.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    current = await products.getProduct(productId);
    currentIds = v1MediaIds(current.product);
    added = currentIds.filter((id) => !beforeIds.has(id));
  }
  const newId = added.find((id) => id === fileId || id.includes(fileId)) ?? added[0];
  if (!newId) return 'gallery-only';
  const previous = currentIds.filter((id) => id !== newId);
  if (previous.length === 0 || v1MainId(current.product) === newId) return 'main-photo';

  try {
    for (const batch of batchesOf(previous)) {
      await products.removeProductMedia(productId, batch);
    }
  } catch (error) {
    console.error('Could not reorder classic catalog media', error);
    return 'gallery-only';
  }

  try {
    for (const batch of batchesOf(previous)) {
      const media = batch.map((mediaId) => ({ mediaId }));
      try {
        await products.addProductMedia(productId, media);
      } catch (error) {
        console.error('Retrying classic catalog media restore', error);
        await products.addProductMedia(productId, media);
      }
    }
  } catch (error) {
    console.error('Could not put the previous photos back', error);
    throw new Error(
      'The new photo is on the product, but some previous photos could not be put back. They are still in Media Manager.',
    );
  }

  const optionNames = new Set(links.map((link) => link.option));
  if (optionNames.size === 1) {
    try {
      await products.addProductMediaToChoices(
        productId,
        links.map((link) => ({ option: link.option, choice: link.choice, mediaIds: link.mediaIds })),
      );
    } catch (error) {
      console.error('Could not restore choice photos on the classic catalog', error);
    }
  }

  const finalProduct = await products.getProduct(productId);
  return v1MainId(finalProduct.product) === newId ? 'main-photo' : 'gallery-only';
}

export async function publishProductImage(input: PublishInput): Promise<PublishResult> {
  const isData = /^data:image\//i.test(input.imageUrl);
  if (!isData && !/^https:\/\//i.test(input.imageUrl)) {
    throw new Error('Run a live action first (for example Remove background), then publish.');
  }
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  if (catalogVersion === 'STORES_NOT_INSTALLED') {
    throw new Error('Wix Stores is not installed on this site.');
  }
  const fileId = isData
    ? await uploadDataUrlToMediaManager(input.imageUrl, input.productName)
    : await importUrlToMediaManager(input.imageUrl, input.productName);
  await waitUntilReady(fileId);
  if (catalogVersion === 'V3_CATALOG') {
    await publishV3(input.productId, fileId, input.productName);
    return {
      fileId,
      mode: 'main-photo',
      message: 'Published. The new photo is now the main image and the original is still in the gallery. Reload the page to see it.',
    };
  }
  const mode = await publishV1(input.productId, fileId);
  if (mode === 'main-photo') {
    return {
      fileId,
      mode,
      message: 'Published. The new photo is now the main image and the original photos are still in the gallery. Reload the page to see it.',
    };
  }
  return {
    fileId,
    mode,
    message: 'Added to the product gallery. Your original photos were kept, but this classic catalog did not make the new photo the main one. Set it as the main photo in Products.',
  };
}
