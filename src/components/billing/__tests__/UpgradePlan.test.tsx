import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PricingCatalog, SubscriptionInterval } from '@/application/types';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import UpgradePlan from '@/components/billing/UpgradePlan';

const mockTranslations: Record<string, string> = {
  'subscribe.feature.storage': 'Storage',
  'subscribe.value.unlimited': 'Unlimited',
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'subscribe.save') return `Save ${String(options?.discount)}%`;

      return mockTranslations[key] ?? (options?.defaultValue as string | undefined) ?? key;
    },
  }),
}));

jest.mock('@/application/services/domains', () => ({
  BillingService: { getSubscriptionLink: jest.fn(), getPricingCatalog: jest.fn() },
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/billing/CancelSubscribe', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ open, title, children }: { open: boolean; title?: ReactNode; children?: ReactNode }) =>
    open ? (
      <div>
        <div>{title}</div>
        {children}
      </div>
    ) : null,
}));

jest.mock('@/components/_shared/tabs/ViewTabs', () => {
  const ReactModule = jest.requireActual('react');

  return {
    ViewTabs: ({
      children,
      onChange,
    }: {
      children: ReactNode;
      onChange: (event: unknown, value: unknown) => void;
    }) => (
      <div>
        {ReactModule.Children.map(children, (child: ReactNode) =>
          ReactModule.isValidElement(child) ? ReactModule.cloneElement(child, { onChange }) : child
        )}
      </div>
    ),
    ViewTab: ({
      label,
      value,
      onChange,
    }: {
      label: ReactNode;
      value: string;
      onChange?: (event: unknown, value: unknown) => void;
    }) => (
      <button type='button' onClick={(event) => onChange?.(event, value)}>
        {label}
      </button>
    ),
  };
});

const catalog: PricingCatalog = {
  version: 1,
  currency: 'USD',
  annual_discount_percent: 20,
  plans: [
    {
      id: 'free',
      kind: 'workspace_plan',
      name: 'Free',
      description: 'Server free description',
      prices: [],
      features: [{ key: 'members', label: 'Up to 2 members', value: { kind: 'quantity', amount: 2, unit: 'members', display: 'Up to 2' } }],
    },
    {
      id: 'pro',
      kind: 'workspace_plan',
      name: 'Pro',
      description: 'Server pro description',
      prices: [
        { interval: SubscriptionInterval.Month, price_cents: 1250 },
        { interval: SubscriptionInterval.Year, price_cents: 12000 },
      ],
      features: [
        { key: 'storage', label: 'Unlimited storage', value: { kind: 'unlimited', display: 'Unlimited' } },
        { key: 'members', label: 'Up to 10 workspace members', value: { kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10' } },
        { key: 'guests', label: 'No guests', value: { kind: 'excluded', display: 'no' } },
      ],
    },
    {
      id: 'ai_max',
      kind: 'workspace_add_on',
      name: 'AI Max',
      description: 'Server AI Max description',
      prices: [{ interval: SubscriptionInterval.Year, price_cents: 9600 }],
      features: [],
    },
  ],
  comparison: [],
};

function renderModal(getPricingCatalog: () => Promise<PricingCatalog>, { isOfficialHosted = true } = {}) {
  return render(
    <MemoryRouter>
      <AuthInternalContext.Provider
        value={{
          currentWorkspaceId: 'workspace-id',
          isAuthenticated: true,
          isOfficialHosted,
          onChangeWorkspace: async () => undefined,
        }}
      >
        <AppOperationsContext.Provider
          value={{ getSubscriptions: async () => [], getPricingCatalog } as unknown as AppOperationsContextType}
        >
          <UpgradePlan open onClose={() => undefined} onOpen={() => undefined} />
        </AppOperationsContext.Provider>
      </AuthInternalContext.Provider>
    </MemoryRouter>
  );
}

describe('UpgradePlan', () => {
  beforeEach(() => {
    resetPricingCatalogCache();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders prices, the discount label and bullets from the pricing catalog', async () => {
    renderModal(async () => catalog);

    const proCard = await screen.findByTestId('pricing-plan-pro');

    // Yearly is the default interval: the yearly total is shown per month.
    expect(within(proCard).getByText('$10')).toBeTruthy();
    expect(within(proCard).getByText('subscribe.proDuration.yearly')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-free')).getByText('subscribe.freeDuration')).toBeTruthy();
    expect(screen.getByText(/Save 20%/)).toBeTruthy();
    expect(screen.getByText('$USD')).toBeTruthy();
    // Add-ons never get a card in the compare view.
    expect(screen.queryByTestId('pricing-plan-ai_max')).toBeNull();

    // Known keys compose localized parts; unknown keys use the server sentence; excluded ones are skipped.
    expect(within(proCard).getByText('Storage: Unlimited')).toBeTruthy();
    expect(within(proCard).getByText('Up to 10 workspace members')).toBeTruthy();
    expect(within(proCard).queryByText('No guests')).toBeNull();

    fireEvent.click(screen.getByText('subscribe.monthly'));

    expect(within(proCard).getByText('$12.5')).toBeTruthy();
    expect(within(proCard).getByText('subscribe.proDuration.monthly')).toBeTruthy();
  });

  it('shows skeleton cards while the catalog loads', () => {
    renderModal(() => new Promise<PricingCatalog>(() => undefined));

    expect(screen.getByTestId('pricing-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();
  });

  it('offers a retry when the catalog cannot be loaded and recovers on success', async () => {
    const getPricingCatalog = jest
      .fn<Promise<PricingCatalog>, []>()
      .mockRejectedValueOnce(new Error('billing unavailable'))
      .mockResolvedValueOnce(catalog);

    renderModal(getPricingCatalog);

    const errorState = await screen.findByTestId('pricing-error');

    expect(within(errorState).getByText('subscribe.pricingUnavailable')).toBeTruthy();
    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();

    fireEvent.click(within(errorState).getByText('button.retry'));

    const proCard = await screen.findByTestId('pricing-plan-pro');

    expect(within(proCard).getByText('$10')).toBeTruthy();
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it('hides paid plans when server-info did not confirm the official cloud', async () => {
    renderModal(async () => catalog, { isOfficialHosted: false });

    await screen.findByTestId('pricing-plan-free');

    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();
  });
});
