import React, { useEffect, useState } from 'react';
import { Box, Button, Card, EmptyState, Loader, Page, Text } from '@wix/design-system';
import { usePatternsNavigate } from '@wix/patterns/router';
import { fetchBilling, openPricingPage, type BillingCatalog } from './billing-client';

function formatDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function planSummary(catalog: BillingCatalog): { title: string; lines: string[] } {
  const lines: string[] = [];
  const balance = catalog.balance;
  const sub = catalog.subscription;
  if (typeof balance === 'number') {
    lines.push(
      sub && sub.credits > 0
        ? `${balance} credits left (${sub.credits} from this month's plan).`
        : `${balance} credits left.`,
    );
  } else {
    lines.push('Credits are unavailable right now.');
  }
  const plan = catalog.currentPlan;
  if (!plan) {
    lines.push('You are on Basic (free): 5 credits once per site. Choose a monthly plan for more credits.');
    return { title: 'Basic (free)', lines };
  }
  const end = formatDate(sub?.periodEnd);
  const renewing = (plan.autoRenewing ?? sub?.autoRenewing) !== false;
  if (end) {
    lines.push(
      renewing
        ? `Your plan credits refill on ${end}. Unused plan credits don't carry over.`
        : `Auto-renewal is off. Your plan stays active until about ${end}; its unused credits expire then.`,
    );
  } else if (!renewing) {
    lines.push('Auto-renewal is off. Your plan stays active until the paid month ends.');
  }
  if (plan.credits === null) lines.push(`Plan ${plan.productId} is not set up in this app yet. Contact support.`);
  return { title: `${plan.name} plan`, lines };
}

export const PlansPage = () => {
  const { navigateToCollectionPage } = usePatternsNavigate();
  const [catalog, setCatalog] = useState<BillingCatalog | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    setError(undefined);
    setCatalog(undefined);
    void fetchBilling()
      .then(setCatalog)
      .catch((loadError: unknown) => {
        console.error('Could not load plans', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Could not load plans.');
      });
  };

  useEffect(() => {
    load();
  }, []);

  const choose = () => {
    try {
      openPricingPage(catalog?.upgradeUrl ?? null);
    } catch (openError) {
      console.error('Could not open the Wix pricing page', openError);
      setError(openError instanceof Error ? openError.message : 'The Wix pricing page is unavailable right now.');
    }
  };

  const summary = catalog ? planSummary(catalog) : undefined;
  const currentKey = catalog?.currentPlan?.key ?? null;

  return (
    <Page>
      <Page.Header
        title="Plans & credits"
        subtitle="Monthly plans billed by Wix. Credits refill every billing month."
        showBackButton
        onBackClicked={() => navigateToCollectionPage({ path: '/' })}
        actionsBar={
          <Button skin="inverted" onClick={load}>
            Refresh
          </Button>
        }
      />
      <Page.Content>
        {error ? (
          <EmptyState title="Plans could not be loaded" subtitle={error}>
            <Button onClick={load}>Try again</Button>
          </EmptyState>
        ) : !catalog || !summary ? (
          <Loader text="Loading plans" />
        ) : (
          <Box direction="vertical" gap="SP4">
            <Card>
              <Card.Header title={summary.title} subtitle="Your current plan" />
              <Card.Divider />
              <Card.Content>
                <Box direction="vertical" gap="SP2">
                  {summary.lines.map((line) => (
                    <Text key={line}>{line}</Text>
                  ))}
                  <Text size="small" secondary>
                    Free credits and credits from earlier one-time packs never expire. To cancel, turn off auto-renewal in
                    your Wix account under Billing &amp; Payments. You keep the plan until the paid month ends.
                  </Text>
                  <Box>
                    <Button disabled={!catalog.upgradeUrl} onClick={choose}>
                      {catalog.currentPlan ? 'Change plan' : 'Choose a plan'}
                    </Button>
                  </Box>
                </Box>
              </Card.Content>
            </Card>
            {catalog.plans.map((plan) => {
              const current = plan.key === currentKey;
              return (
                <Card key={plan.key}>
                  <Card.Header title={plan.name} subtitle={plan.priceLabel} />
                  <Card.Divider />
                  <Card.Content>
                    <Box direction="vertical" gap="SP2">
                      {plan.benefits.map((benefit) => (
                        <Text key={benefit} size="small">{benefit}</Text>
                      ))}
                      <Box>
                        <Button
                          priority={current ? 'secondary' : 'primary'}
                          disabled={current || !catalog.upgradeUrl}
                          onClick={choose}
                        >
                          {current ? 'Current plan' : 'Choose plan'}
                        </Button>
                      </Box>
                    </Box>
                  </Card.Content>
                </Card>
              );
            })}
            <Text size="small" secondary>
              Choose plan opens the Wix pricing page in a new tab. Wix shows the final price and handles checkout. After you
              subscribe, come back and click Refresh.
            </Text>
          </Box>
        )}
      </Page.Content>
    </Page>
  );
};
