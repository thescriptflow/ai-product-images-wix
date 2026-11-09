import { collections, items } from '@wix/data';
import { auth } from '@wix/essentials';
import { collectionIdSuffix } from '../extensions/backend/data-collections/credits';

export const FREE_CREDITS = 10;

interface CreditRow {
  _id?: string;
  title?: string;
  siteId: string;
  plan: string;
  period: string;
  creditsLimit: number;
  creditsUsed: number;
}

export interface Balance {
  plan: string;
  limit: number;
  used: number;
  remaining: number;
}

let cachedCollectionId: string | undefined;

function envCollectionId(): string | undefined {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' && process.env ? process.env : {};
  const value = (meta.CREDITS_COLLECTION_ID ?? proc.CREDITS_COLLECTION_ID)?.trim();
  return value || undefined;
}

async function collectionId(): Promise<string> {
  if (cachedCollectionId) return cachedCollectionId;
  const fromEnv = envCollectionId();
  if (fromEnv) {
    cachedCollectionId = fromEnv;
    return fromEnv;
  }
  try {
    const list = auth.elevate(collections.listDataCollections) as unknown as () => Promise<unknown>;
    const listed = (await list()) as { collections?: { _id?: string; id?: string }[] };
    const ids = (listed.collections ?? [])
      .map((entry) => entry._id ?? entry.id)
      .filter((id): id is string => typeof id === 'string');
    const match = ids.find((id) => id === collectionIdSuffix || id.endsWith(`/${collectionIdSuffix}`));
    if (match) {
      cachedCollectionId = match;
      return match;
    }
    console.error('credits collection not found. Collections on this site:', ids.slice(0, 40).join(', '));
  } catch (error) {
    console.error('Could not list collections', error);
  }
  return collectionIdSuffix;
}

async function loadRow(siteId: string): Promise<CreditRow> {
  const id = await collectionId();
  const found = await auth.elevate(items.query)(id).eq('siteId', siteId).limit(1).find();
  const existing = found.items[0] as unknown as CreditRow | undefined;
  if (existing) return existing;
  const fresh: CreditRow = {
    title: siteId,
    siteId,
    plan: 'free',
    period: 'lifetime',
    creditsLimit: FREE_CREDITS,
    creditsUsed: 0,
  };
  const saved = await auth.elevate(items.insert)(id, fresh);
  return saved as unknown as CreditRow;
}

function toBalance(row: CreditRow): Balance {
  return {
    plan: row.plan,
    limit: row.creditsLimit,
    used: row.creditsUsed,
    remaining: Math.max(0, row.creditsLimit - row.creditsUsed),
  };
}

async function saveUsed(row: CreditRow, creditsUsed: number): Promise<void> {
  await auth.elevate(items.update)(await collectionId(), { ...row, creditsUsed } as never);
}

export async function getBalance(siteId: string): Promise<Balance> {
  return toBalance(await loadRow(siteId));
}

export async function reserveCredits(siteId: string, cost: number): Promise<number> {
  const row = await loadRow(siteId);
  const balance = toBalance(row);
  if (cost <= 0) return balance.remaining;
  if (balance.remaining < cost) {
    throw new Error('No image credits remaining. Upgrade your plan to continue.');
  }
  await saveUsed(row, row.creditsUsed + cost);
  return balance.remaining - cost;
}

export async function refundCredits(siteId: string, cost: number): Promise<void> {
  if (cost <= 0) return;
  const row = await loadRow(siteId);
  await saveUsed(row, Math.max(0, row.creditsUsed - cost));
}
