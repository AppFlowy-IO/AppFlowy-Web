import { act, fireEvent, render, screen } from '@testing-library/react';

import { PricingCatalog, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import { ChangePeriodDialog } from '@/components/app/settings/billing/ChangePeriodDialog';

import { BillingTestProviders, catalog, translate } from './billing-test-utils';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
jest.mock('@/application/services/domains', () => ({ BillingService: { getPricingCatalog: jest.fn() } }));

function renderDialog(
  getPricingCatalog: () => Promise<PricingCatalog>,
  plan = SubscriptionPlan.Pro,
  currentInterval: SubscriptionInterval | null = SubscriptionInterval.Month
) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();

  render(
    <BillingTestProviders getPricingCatalog={getPricingCatalog}>
      <ChangePeriodDialog
        open
        plan={plan}
        currentInterval={currentInterval ?? undefined}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </BillingTestProviders>
  );

  return { onConfirm, onClose };
}

function tryConfirmWithoutPrice() {
  fireEvent.click(screen.getByTestId('period-option-year'));
  const confirm = screen.getByTestId<HTMLButtonElement>('change-period-confirm');

  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  // NormalModal also invokes onOk for Enter outside a button, independently of the disabled button.
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
}

describe('ChangePeriodDialog price availability', () => {
  beforeEach(() => {
    resetPricingCatalogCache();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('allows either checkout interval without marking an interval as current', async () => {
    const { onConfirm } = renderDialog(async () => catalog, SubscriptionPlan.Pro, null);

    expect(await screen.findByText('$120')).toBeTruthy();
    expect(screen.queryByText('Current period')).toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('period-option-month').disabled).toBe(false);
    expect(screen.getByTestId<HTMLButtonElement>('period-option-year').disabled).toBe(false);
    expect(screen.getByTestId('period-option-year').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('change-period-confirm'));

    expect(onConfirm).toHaveBeenCalledWith(SubscriptionInterval.Year);
  });

  it('requires a displayed price before confirming by click or Enter', async () => {
    let resolveCatalog!: (value: PricingCatalog) => void;
    const request = new Promise<PricingCatalog>((resolve) => {
      resolveCatalog = resolve;
    });
    const { onConfirm, onClose } = renderDialog(() => request);

    expect(screen.getByRole('status')).toBeTruthy();
    tryConfirmWithoutPrice();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => resolveCatalog(catalog));
    expect(await screen.findByText('$120')).toBeTruthy();
    fireEvent.click(screen.getByTestId('period-option-year'));
    fireEvent.click(screen.getByTestId('change-period-confirm'));

    expect(onConfirm).toHaveBeenCalledWith(SubscriptionInterval.Year);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('explains catalog failures and allows a retry before confirmation', async () => {
    const getPricingCatalog = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(catalog);
    const { onConfirm, onClose } = renderDialog(getPricingCatalog);

    expect((await screen.findByRole('alert')).textContent).toContain('Pricing unavailable');
    tryConfirmWithoutPrice();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('$120')).toBeTruthy();
    fireEvent.click(screen.getByTestId('period-option-year'));
    fireEvent.click(screen.getByTestId('change-period-confirm'));

    expect(onConfirm).toHaveBeenCalledWith(SubscriptionInterval.Year);
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: 'a plan missing from the catalog', plan: SubscriptionPlan.Team, prices: catalog },
    {
      name: 'an interval missing from the plan',
      plan: SubscriptionPlan.Pro,
      prices: {
        ...catalog,
        plans: catalog.plans.map((plan) => ({
          ...plan,
          prices: plan.prices.filter((price) => price.interval === SubscriptionInterval.Month),
        })),
      },
    },
  ])('blocks confirmation for $name', async ({ plan, prices }) => {
    const { onConfirm, onClose } = renderDialog(async () => prices, plan);

    expect((await screen.findByRole('alert')).textContent).toContain('Pricing unavailable');
    expect(screen.getByTestId<HTMLButtonElement>('period-option-year').disabled).toBe(true);
    tryConfirmWithoutPrice();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
