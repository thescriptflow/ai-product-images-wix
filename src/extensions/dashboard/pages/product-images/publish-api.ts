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

async function publishV1(productId: string, fileId: string): Promise<void> {
  await products.addProductMedia(productId, [{ mediaId: fileId }] as never);
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
  await publishV1(input.productId, fileId);
  return {
    fileId,
    mode: 'gallery-only',
    message: 'Added to the product gallery. On classic (V1) stores please set it as the main photo in Products.',
  };
}
