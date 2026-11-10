export const CREDIT_PACKS = [
  {
    key: '20',
    credits: 20,
    name: '20 Credits',
    priceLabel: '$9.99',
    envName: 'CREDIT_PACK_20_PRODUCT_ID',
    benefits: [
      '20 image credits',
      'Credits never expire',
      'Remove background, replace background, and AI scenes',
      'One-time purchase',
    ],
  },
  {
    key: '60',
    credits: 60,
    name: '60 Credits',
    priceLabel: '$24.99',
    envName: 'CREDIT_PACK_60_PRODUCT_ID',
    benefits: [
      '60 image credits',
      'Credits never expire',
      'Remove background, replace background, and AI scenes',
      'One-time purchase',
    ],
  },
  {
    key: '150',
    credits: 150,
    name: '150 Credits',
    priceLabel: '$49.99',
    envName: 'CREDIT_PACK_150_PRODUCT_ID',
    benefits: [
      '150 image credits',
      'Credits never expire',
      'Remove background, replace background, and AI scenes',
      'One-time purchase',
    ],
  },
] as const;

export type CreditPackKey = (typeof CREDIT_PACKS)[number]['key'];
export type CreditPack = (typeof CREDIT_PACKS)[number];

export interface CreditPackOffer {
  key: CreditPackKey;
  credits: number;
  name: string;
  priceLabel: string;
  benefits: readonly string[];
  checkoutEnabled: boolean;
  disabledReason?: string;
}

const DISABLED = 'Checkout is not available for this pack yet. Add its product ID in the app environment.';

export function isCreditPackKey(value: unknown): value is CreditPackKey {
  return value === '20' || value === '60' || value === '150';
}

function productIdFromJson(pack: CreditPack, raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('CREDIT_PACKS is not valid JSON', error);
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { key?: unknown; productId?: unknown };
    if (record.key !== pack.key || typeof record.productId !== 'string') continue;
    const productId = record.productId.trim();
    if (productId) return productId;
  }
  return undefined;
}

export function productIdForPack(pack: CreditPack, env: NodeJS.ProcessEnv): string | undefined {
  const fromJson = productIdFromJson(pack, env.CREDIT_PACKS);
  const productId = (fromJson ?? env[pack.envName] ?? '').trim();
  if (!productId || productId.length > 100 || /\s/.test(productId)) return undefined;
  return productId;
}

export function packByProductId(productId: string, env: NodeJS.ProcessEnv): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => productIdForPack(pack, env) === productId);
}

export function packOffers(env: NodeJS.ProcessEnv): CreditPackOffer[] {
  return CREDIT_PACKS.map((pack) => {
    const productId = productIdForPack(pack, env);
    return {
      key: pack.key,
      credits: pack.credits,
      name: pack.name,
      priceLabel: pack.priceLabel,
      benefits: pack.benefits,
      checkoutEnabled: Boolean(productId),
      ...(productId ? {} : { disabledReason: DISABLED }),
    };
  });
}
