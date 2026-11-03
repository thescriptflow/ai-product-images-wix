import { catalogVersioning, products, productsV3 } from '@wix/stores';

export type CatalogProductType = 'PHYSICAL' | 'DIGITAL';
export type ProductVisibility = 'VISIBLE' | 'HIDDEN';

export interface CatalogProduct {
  id: string;
  name: string;
  visibility: ProductVisibility;
  description: string;
  productType: CatalogProductType;
  imageUrl?: string;
}

export interface ProductsPageQuery {
  limit: number;
  cursor?: string;
  search?: string;
  filters: { productType?: CatalogProductType[] | null };
}

export interface ProductsPage {
  items: CatalogProduct[];
  cursor: string | undefined;
}

type CatalogVersion = 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED';

let cachedVersion: CatalogVersion | undefined;

const PRODUCT_FIELDS = ['THUMBNAIL', 'URL', 'PLAIN_DESCRIPTION'] as const;

async function getCatalogVersion(): Promise<CatalogVersion> {
  if (cachedVersion) return cachedVersion;
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  if (
    catalogVersion !== 'V1_CATALOG' &&
    catalogVersion !== 'V3_CATALOG' &&
    catalogVersion !== 'STORES_NOT_INSTALLED'
  ) {
    throw new Error('Wix Stores returned an unknown catalog version.');
  }
  cachedVersion = catalogVersion;
  return cachedVersion;
}

export async function fetchProductsPage(query: ProductsPageQuery): Promise<ProductsPage> {
  const version = await getCatalogVersion();
  if (version === 'STORES_NOT_INSTALLED') {
    return { items: [], cursor: undefined };
  }
  if (version === 'V3_CATALOG') {
    return fetchV3Page(query);
  }
  return fetchV1Page(query);
}

export async function fetchProduct(id: string): Promise<CatalogProduct | undefined> {
  const version = await getCatalogVersion();
  if (version === 'STORES_NOT_INSTALLED') return undefined;
  if (version === 'V3_CATALOG') {
    const product = await productsV3.getProduct(id, { fields: [...PRODUCT_FIELDS] });
    return mapV3(product);
  }
  const response = await products.getProduct(id);
  return response.product ? mapV1(response.product) : undefined;
}

export async function saveProduct(
  product: CatalogProduct,
): Promise<CatalogProduct> {
  const version = await getCatalogVersion();
  if (version === 'STORES_NOT_INSTALLED') {
    throw new Error('Wix Stores is not installed on this site.');
  }
  if (version === 'V3_CATALOG') {
    return saveV3(product);
  }
  return saveV1(product);
}

async function fetchV3Page(query: ProductsPageQuery): Promise<ProductsPage> {
  const limit = query.limit;
  const search = buildV3Search(query);
  const response = await productsV3.searchProducts(search, { fields: [...PRODUCT_FIELDS] });
  const items = (response.products ?? [])
    .map(mapV3)
    .filter((item): item is CatalogProduct => item !== undefined);
  const next = response.pagingMetadata?.cursors?.next;
  const hasNext = response.pagingMetadata?.hasNext === true && typeof next === 'string' && next.length > 0;
  return { items, cursor: hasNext ? next : undefined };
}

function buildV3Search(query: ProductsPageQuery): productsV3.V3ProductSearch {
  if (query.cursor) {
    return { cursorPaging: { limit: query.limit, cursor: query.cursor } };
  }
  const term = query.search?.trim();
  const filter = v3TypeFilter(query.filters.productType);
  return {
    cursorPaging: { limit: query.limit },
    ...(term ? { search: { expression: term, fields: ['name'], fuzzy: true } } : {}),
    ...(filter ? { filter } : {}),
  };
}

function v3TypeFilter(
  types: CatalogProductType[] | null | undefined,
): { productType: { $eq: CatalogProductType } } | undefined {
  if (!types || types.length !== 1) return undefined;
  const only = types[0];
  if (!only) return undefined;
  return { productType: { $eq: only } };
}

async function fetchV1Page(query: ProductsPageQuery): Promise<ProductsPage> {
  const skip = query.cursor ? Number(query.cursor) : 0;
  const offset = Number.isFinite(skip) && skip > 0 ? skip : 0;
  let builder = products.queryProducts().skip(offset).limit(query.limit);
  const term = query.search?.trim();
  if (term) {
    builder = builder.startsWith('name', term);
  }
  const type = singleV1Type(query.filters.productType);
  if (type) {
    builder = builder.eq('productType', type);
  }
  const result = await builder.find();
  const items = result.items
    .map(mapV1)
    .filter((item): item is CatalogProduct => item !== undefined);
  const nextOffset = offset + result.items.length;
  return {
    items,
    cursor: result.hasNext() ? String(nextOffset) : undefined,
  };
}

function singleV1Type(
  types: CatalogProductType[] | null | undefined,
): 'physical' | 'digital' | undefined {
  if (!types || types.length !== 1) return undefined;
  const only = types[0];
  if (only === 'PHYSICAL') return 'physical';
  if (only === 'DIGITAL') return 'digital';
  return undefined;
}

async function saveV3(product: CatalogProduct): Promise<CatalogProduct> {
  const current = await productsV3.getProduct(product.id);
  if (current.revision == null) {
    throw new Error(`Product ${product.id} has no revision, so it cannot be updated.`);
  }
  const updated = await productsV3.updateProduct(product.id, {
    revision: current.revision,
    name: product.name,
    visible: product.visibility === 'VISIBLE',
    plainDescription: toHtmlDescription(product.description),
  });
  const mapped = mapV3(updated);
  if (!mapped) throw new Error('Wix Stores did not return the updated product.');
  return mapped;
}

async function saveV1(product: CatalogProduct): Promise<CatalogProduct> {
  const response = await products.updateProduct(product.id, {
    name: product.name,
    visible: product.visibility === 'VISIBLE',
    description: product.description,
  });
  if (!response.product) throw new Error('Wix Stores did not return the updated product.');
  const mapped = mapV1(response.product);
  if (!mapped) throw new Error('Wix Stores did not return the updated product.');
  return mapped;
}

function mapV3(product: productsV3.V3Product): CatalogProduct | undefined {
  if (!product._id) return undefined;
  const imageUrl = v3Image(product);
  return {
    id: product._id,
    name: product.name ?? 'Untitled product',
    visibility: product.visible === false ? 'HIDDEN' : 'VISIBLE',
    description: stripHtml(product.plainDescription ?? ''),
    productType: product.productType === 'DIGITAL' ? 'DIGITAL' : 'PHYSICAL',
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function mapV1(product: products.Product): CatalogProduct | undefined {
  if (!product._id) return undefined;
  const imageUrl = product.media?.mainMedia?.image?.url ?? product.media?.mainMedia?.thumbnail?.url;
  return {
    id: product._id,
    name: product.name ?? 'Untitled product',
    visibility: product.visible === false ? 'HIDDEN' : 'VISIBLE',
    description: product.description ?? '',
    productType: product.productType === 'digital' ? 'DIGITAL' : 'PHYSICAL',
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function v3Image(product: productsV3.V3Product): string | undefined {
  const main = product.media?.main;
  if (!main) return undefined;
  return main.thumbnail?.url ?? main.image ?? main.url;
}

function toHtmlDescription(value: string): string {
  if (value.includes('<')) return value;
  const escaped = value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<p>${escaped}</p>`;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}
