import { catalogVersioning, products, productsV3 } from '@wix/stores';

const MEDIA_FIELDS = ['MEDIA_ITEMS_INFO'] as const;

export interface ProductPhoto {
  id: string;
  url: string;
  isMain: boolean;
}

type CatalogVersion = 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED';

let cachedVersion: CatalogVersion | undefined;

async function catalogVersion(): Promise<CatalogVersion> {
  if (cachedVersion) return cachedVersion;
  const { catalogVersion: version } = await catalogVersioning.getCatalogVersion();
  if (version !== 'V1_CATALOG' && version !== 'V3_CATALOG' && version !== 'STORES_NOT_INSTALLED') {
    throw new Error('Wix Stores returned an unknown catalog version.');
  }
  cachedVersion = version;
  return version;
}

function wixStaticUrl(id: string, raw: string | undefined): string {
  if (raw && /^https:\/\/(?:[^/]+\.)?wixstatic\.com\//i.test(raw)) {
    const full = /^(https:\/\/static\.wixstatic\.com\/media\/[^/?#]+)/.exec(raw);
    return full?.[1] ?? raw;
  }
  return `https://static.wixstatic.com/media/${id}`;
}

function photosFromV1(product: products.Product | undefined): ProductPhoto[] {
  const items = product?.media?.items ?? [];
  const mainId = product?.media?.mainMedia?._id;
  const photos: ProductPhoto[] = [];
  items.forEach((item, index) => {
    const id = item._id;
    if (!id) return;
    if (item.mediaType && item.mediaType !== 'image') return;
    photos.push({
      id,
      url: wixStaticUrl(id, item.image?.url ?? item.thumbnail?.url),
      isMain: mainId ? id === mainId : index === 0,
    });
  });
  const first = photos[0];
  if (first && !photos.some((photo) => photo.isMain)) {
    photos[0] = { ...first, isMain: true };
  }
  photos.sort((left, right) => Number(right.isMain) - Number(left.isMain));
  return photos;
}

function photosFromV3(product: productsV3.V3Product): ProductPhoto[] {
  const items = product.media?.itemsInfo?.items ?? [];
  const photos: ProductPhoto[] = [];
  items.forEach((item, index) => {
    const record = item as unknown as { image?: string };
    const match = record.image ? /^wix:image:\/\/v1\/([^/#]+)/.exec(record.image) : null;
    const id = match?.[1];
    if (id) {
      photos.push({ id, url: `https://static.wixstatic.com/media/${id}`, isMain: index === 0 });
    }
  });
  return photos;
}

export async function fetchProductPhotos(productId: string): Promise<ProductPhoto[]> {
  try {
    const version = await catalogVersion();
    if (version === 'STORES_NOT_INSTALLED') return [];
    if (version === 'V1_CATALOG') {
      const response = await products.getProduct(productId);
      return photosFromV1(response.product);
    }
    const product = await productsV3.getProduct(productId, { fields: [...MEDIA_FIELDS] });
    return photosFromV3(product);
  } catch (error) {
    console.error('Could not load product photos', error);
    return [];
  }
}
