import { httpClient } from '@wix/essentials';

export interface CreditPlanOffer {
  key: '20' | '60' | '150';
  credits: number;
  name: string;
  priceLabel: string;
  benefits: string[];
  productId: string;
}

export interface SubscriptionCredits {
  plan: string;
  credits: number;
  periodStart: string | null;
  periodEnd: string | null;
  autoRenewing: boolean | null;
}

export interface CurrentPlan {
  productId: string;
  key: CreditPlanOffer['key'] | null;
  name: string;
  credits: number | null;
  autoRenewing: boolean | null;
}

export interface BillingCatalog {
  balance: number | null;
  subscription: SubscriptionCredits | null;
  currentPlan: CurrentPlan | null;
  plans: CreditPlanOffer[];
  upgradeUrl: string | null;
}

function endpointUrl(): string {
  return new URL('/api/billing', import.meta.url).href;
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error;
    }
  } catch (error) {
    console.error('Could not read billing API error', error);
  }
  return `Billing request failed (${response.status})`;
}

export async function fetchBilling(): Promise<BillingCatalog> {
  const response = await httpClient.fetchWithAuth(endpointUrl());
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<BillingCatalog>;
}

/** Opens the Wix pricing page for this app in a new tab, as Wix requires. */
export function openPricingPage(url: string | null): void {
  if (!url || !url.startsWith('https://www.wix.com/apps/upgrade/')) {
    throw new Error('The Wix pricing page is unavailable right now. Please try again shortly.');
  }
  const tab = window.open(url, '_blank', 'noopener,noreferrer');
  if (!tab) window.location.assign(url);
}
