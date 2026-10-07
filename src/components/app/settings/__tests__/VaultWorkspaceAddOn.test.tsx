import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BillingService } from '@/application/services/domains';
import { PersonalPlan, PersonalSubscriptionStatus, PricingCatalog, SubscriptionInterval, SubscriptionStatus } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import { VaultWorkspaceAddOn } from '@/components/app/settings/billing/VaultWorkspaceAddOn';

import { BillingTestProviders, catalog, deferred, PERIOD_END, setBillingHostingMode, translate } from './billing-test-utils';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  BillingService: {
    getPersonalSubscriptionStatus: jest.fn(),
    getPersonalSubscriptionLink: jest.fn(),
  },
}));

const api = jest.mocked(BillingService);
const activeSubscription: PersonalSubscriptionStatus = {
  plan: PersonalPlan.VaultWorkspace,
  subscription_status: SubscriptionStatus.Active,
  recurring_interval: SubscriptionInterval.Year,
  subscription_quantity: 1,
  cancel_at: null,
  current_period_end: PERIOD_END,
};

function renderAddOn(getPricingCatalog?: () => Promise<PricingCatalog>) {
  return render(
    <BillingTestProviders getPricingCatalog={getPricingCatalog}>
      <VaultWorkspaceAddOn />
    </BillingTestProviders>
  );
}

describe('VaultWorkspaceAddOn', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setBillingHostingMode();
    resetPricingCatalogCache();
    window.open = jest.fn();
    api.getPersonalSubscriptionStatus.mockResolvedValue([]);
  });

  it.each(['self-hosted', 'unknown'] as const)('does not render or request account billing when hosting is %s', (mode) => {
    setBillingHostingMode(mode);
    const getPricingCatalog = jest.fn().mockResolvedValue(catalog);

    renderAddOn(getPricingCatalog);

    expect(screen.queryByTestId('plan-addon-vault')).toBeNull();
    expect(getPricingCatalog).not.toHaveBeenCalled();
    expect(api.getPersonalSubscriptionStatus).not.toHaveBeenCalled();
    expect(api.getPersonalSubscriptionLink).not.toHaveBeenCalled();
  });

  it('uses the catalog annual price and opens account checkout once while pending', async () => {
    const checkout = deferred<string>();
    const updatedCatalog = {
      ...catalog,
      plans: catalog.plans.map((plan) => plan.id === PersonalPlan.VaultWorkspace
        ? { ...plan, prices: [{ interval: SubscriptionInterval.Year, price_cents: 10800 }] }
        : plan),
    };

    api.getPersonalSubscriptionLink.mockReturnValueOnce(checkout.promise);
    renderAddOn(async () => updatedCatalog);
    expect(await screen.findByText('$9')).toBeTruthy();
    expect(screen.getByText('Per user per month billed annually')).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;

    fireEvent.click(add);
    fireEvent.click(add);
    expect(add.disabled).toBe(true);
    expect(api.getPersonalSubscriptionLink).toHaveBeenCalledTimes(1);
    expect(api.getPersonalSubscriptionLink).toHaveBeenCalledWith(PersonalPlan.VaultWorkspace, SubscriptionInterval.Year);
    await act(async () => checkout.resolve('https://checkout/vault'));
    expect(window.open).toHaveBeenCalledWith('https://checkout/vault', '_current');
  });

  it.each([null, PERIOD_END])('keeps an active account add-on Added, including until scheduled cancellation (%s)', async (cancelAt) => {
    api.getPersonalSubscriptionStatus.mockResolvedValue([{ ...activeSubscription, cancel_at: cancelAt }]);
    renderAddOn();
    const added = await screen.findByRole('button', { name: 'Added' }) as HTMLButtonElement;

    expect(added.disabled).toBe(true);
    fireEvent.click(added);
    expect(api.getPersonalSubscriptionLink).not.toHaveBeenCalled();
  });

  it('allows adding a canceled account subscription again', async () => {
    api.getPersonalSubscriptionStatus.mockResolvedValue([{ ...activeSubscription, subscription_status: SubscriptionStatus.Canceled }]);
    renderAddOn();
    expect((await screen.findByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('waits for account status and retries a failed request before offering checkout', async () => {
    const account = deferred<PersonalSubscriptionStatus[]>();

    api.getPersonalSubscriptionStatus.mockReturnValueOnce(account.promise).mockResolvedValueOnce([activeSubscription]);
    renderAddOn();
    expect(screen.getByRole('status', { name: 'Account Add-ons' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    await act(async () => account.reject(new Error('status unavailable')));
    expect(screen.getByText('Account add-ons are temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Added' })).toBeTruthy();
    expect(api.getPersonalSubscriptionStatus).toHaveBeenCalledTimes(2);
  });

  it('does not offer annual checkout without an annual price and retries catalog loading', async () => {
    const getPricingCatalog = jest.fn().mockResolvedValueOnce({
      ...catalog,
      plans: catalog.plans.map((plan) => ({
        ...plan,
        prices: plan.prices.filter((price) => price.interval !== SubscriptionInterval.Year),
      })),
    }).mockResolvedValueOnce(catalog);

    renderAddOn(getPricingCatalog);
    expect(await screen.findByText('Pricing unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('$6')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('allows retrying checkout after an error', async () => {
    api.getPersonalSubscriptionLink.mockRejectedValueOnce(new Error('Checkout unavailable'))
      .mockResolvedValueOnce('https://checkout/retry');
    renderAddOn();
    const add = await screen.findByRole('button', { name: 'Add' }) as HTMLButtonElement;

    fireEvent.click(add);
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Checkout unavailable'));
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://checkout/retry', '_current'));
  });

  it('discards another account\'s pending status and checkout when remounted', async () => {
    const oldAccount = deferred<PersonalSubscriptionStatus[]>();
    const oldCheckout = deferred<string>();
    const content = (userId: string) => (
      <BillingTestProviders><VaultWorkspaceAddOn key={userId} /></BillingTestProviders>
    );

    api.getPersonalSubscriptionStatus.mockReturnValueOnce(oldAccount.promise)
      .mockResolvedValueOnce([]).mockResolvedValueOnce([activeSubscription]);
    api.getPersonalSubscriptionLink.mockReturnValueOnce(oldCheckout.promise);
    const view = render(content('old-user'));

    view.rerender(content('next-user'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    view.rerender(content('active-user'));
    expect(await screen.findByRole('button', { name: 'Added' })).toBeTruthy();
    await act(async () => {
      oldAccount.resolve([]);
      oldCheckout.resolve('https://checkout/previous-account');
    });
    expect(screen.getByRole('button', { name: 'Added' })).toBeTruthy();
    expect(window.open).not.toHaveBeenCalled();
  });
});
