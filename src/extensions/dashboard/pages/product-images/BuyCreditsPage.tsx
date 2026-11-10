import React, { useEffect, useState } from 'react';
import { Box, Button, Card, EmptyState, Loader, Page, Text } from '@wix/design-system';
import { usePatternsNavigate } from '@wix/patterns/router';
import { fetchBilling, openCreditCheckout, type BillingCatalog, type CreditPackOffer } from './billing-client';

export const BuyCreditsPage = () => {
  const { navigateToCollectionPage } = usePatternsNavigate();
  const [catalog, setCatalog] = useState<BillingCatalog | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [buying, setBuying] = useState<CreditPackOffer['key'] | undefined>();

  const load = () => {
    setError(undefined);
    setCatalog(undefined);
    void fetchBilling()
      .then(setCatalog)
      .catch((loadError: unknown) => {
        console.error('Could not load credit packs', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Could not load credit packs.');
      });
  };

  useEffect(() => {
    load();
  }, []);

  const buy = async (pack: CreditPackOffer) => {
    setBuying(pack.key);
    try {
      await openCreditCheckout(pack.key);
    } catch (buyError) {
      console.error('Could not open checkout', buyError);
      setError(buyError instanceof Error ? buyError.message : 'Wix checkout is unavailable right now. Please try again shortly.');
    } finally {
      setBuying(undefined);
    }
  };

  const balance = catalog?.balance;
  const balanceText = typeof balance === 'number' ? `You have ${balance} credits. Credits never expire.` : 'Credits are unavailable right now.';

  return (
    <Page>
      <Page.Header
        title="Buy credits"
        subtitle="One-time packs. All three photo actions stay available. The only limit is your balance."
        showBackButton
        onBackClicked={() => navigateToCollectionPage({ path: '/' })}
      />
      <Page.Content>
        {error ? (
          <EmptyState title="Credits could not be loaded" subtitle={error}>
            <Button onClick={load}>Try again</Button>
          </EmptyState>
        ) : !catalog ? (
          <Loader text="Loading credit packs" />
        ) : (
          <Box direction="vertical" gap="SP4">
            <Text>{balanceText}</Text>
            <Text size="small" secondary>
              The price you pay is the price set for the plan in the Wix app dashboard. These labels are the packs this app sells.
            </Text>
            {catalog.packs.map((pack) => (
              <Card key={pack.key}>
                <Card.Header title={pack.name} subtitle={pack.priceLabel} />
                <Card.Divider />
                <Card.Content>
                  <Box direction="vertical" gap="SP2">
                    {pack.benefits.map((benefit) => (
                      <Text key={benefit} size="small">{benefit}</Text>
                    ))}
                    <Button
                      disabled={!pack.checkoutEnabled || buying !== undefined}
                      onClick={() => {
                        void buy(pack);
                      }}
                    >
                      {buying === pack.key ? 'Opening checkout…' : 'Buy credits'}
                    </Button>
                    {pack.disabledReason ? <Text size="small" skin="error">{pack.disabledReason}</Text> : null}
                  </Box>
                </Card.Content>
              </Card>
            ))}
          </Box>
        )}
      </Page.Content>
    </Page>
  );
};
