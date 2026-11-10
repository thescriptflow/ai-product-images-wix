import { httpClient } from '@wix/essentials';

export interface CreditPackOffer {
  key: '20' | '60' | '150';
  credits: number;
  name: string;
  priceLabel: string;
  benefits: string[];
  checkoutEnabled: boolean;
  disabledReason?: string;
}

export interface BillingCatalog {
  balance: number | null;
  packs: CreditPackOffer[];
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

export async function openCreditCheckout(pack: CreditPackOffer['key']): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const response = await httpClient.fetchWithAuth(endpointUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack }),
    });
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as { checkoutUrl?: string };
    const checkoutUrl = body.checkoutUrl ?? '';
    if (!checkoutUrl.startsWith('https://')) throw new Error('Wix did not return a checkout link.');
    if (tab) {
      tab.opener = null;
      tab.location.href = checkoutUrl;
      return;
    }
    window.location.assign(checkoutUrl);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
