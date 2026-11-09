import { productsV3 } from '@wix/stores';

const MEDIA_FIELDS = ['MEDIA_ITEMS_INFO'] as const;

export interface ProductPhoto {
  id: string;
  url: string;
  isMain: boolean;
}

export async function fetchProductPhotos(productId: string): Promise<ProductPhoto[]> {
  try {
    const product = await productsV3.getProduct(productId, { fields: [...MEDIA_FIELDS] });
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
  } catch (error) {
    console.error('Could not load product photos', error);
    return [];
  }
}
