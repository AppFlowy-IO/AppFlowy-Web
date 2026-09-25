import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';
import ja from '@/@types/translations/ja-JP.json';
import ko from '@/@types/translations/ko-KR.json';
import th from '@/@types/translations/th-TH.json';
import tr from '@/@types/translations/tr-TR.json';
import uk from '@/@types/translations/uk-UA.json';
import vi from '@/@types/translations/vi-VN.json';
import { PricingCatalog, Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import UpgradePlan from '@/components/billing/UpgradePlan';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';

const defaultTranslations: Record<string, string> = {
  'subscribe.free': 'Client Free name',
  'subscribe.pro': 'Client Pro name',
  'subscribe.freeDescription': 'Client Free description',
  'subscribe.proDescription': 'Client Pro description',
  'subscribe.feature.storage': 'Storage',
  'subscribe.value.unlimited': 'Unlimited',
  // Header copy from the published plan table.
  'settings.comparePlanDialog.freePlan.price': en.settings.comparePlanDialog.freePlan.price,
  'settings.comparePlanDialog.proPlan.price': en.settings.comparePlanDialog.proPlan.price,
  'settings.comparePlanDialog.freePlan.priceInfo': en.settings.comparePlanDialog.freePlan.priceInfo,
  'settings.comparePlanDialog.proPlan.priceInfo': en.settings.comparePlanDialog.proPlan.priceInfo,
};
let mockTranslations = { ...defaultTranslations };

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

const catalog: PricingCatalog = {
  version: 1,
  currency: 'USD',
  annual_discount_percent: 20,
  plans: [
    {
      id: 'free',
      kind: 'workspace_plan',
      name: 'Personal',
      description: 'Server free description',
      prices: [],
      features: [
        {
          key: 'members',
          label: 'Up to 2 members',
          value: { kind: 'quantity', amount: 2, unit: 'members', display: 'Up to 2' },
        },
      ],
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
        {
          key: 'members',
          label: 'Up to 10 workspace members',
          value: { kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10' },
        },
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
  comparison: [
    {
      key: 'workspaces',
      label: 'Workspaces',
      tooltip: null,
      values: {
        free: { kind: 'text', display: 'Charged per workspace' },
        pro: { kind: 'text', display: 'Charged per workspace' },
      },
    },
    {
      key: 'members',
      label: 'Members',
      tooltip: null,
      values: {
        free: { kind: 'quantity', amount: 2, unit: 'members', display: 'Up to 2' },
        pro: { kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10' },
      },
    },
    {
      key: 'realtime_collaboration',
      label: 'Real-time collaboration',
      tooltip: null,
      values: {
        free: { kind: 'included', display: 'yes' },
        pro: { kind: 'included', display: 'yes' },
      },
    },
    {
      key: 'guests',
      label: 'Guest editors',
      tooltip: 'Collaborate on specific pages with non-members',
      values: {
        free: { kind: 'excluded', display: 'no' },
        pro: { kind: 'quantity', amount: 10, unit: 'guests', display: 'Up to 10' },
      },
    },
    {
      key: 'storage',
      label: 'Storage',
      tooltip: null,
      values: {
        free: { kind: 'quantity', amount: 5, unit: 'gb', display: '5 GB' },
        pro: { kind: 'unlimited', display: 'Unlimited' },
      },
    },
  ],
};

function renderModal(
  getPricingCatalog: () => Promise<PricingCatalog>,
  { isOfficialHosted = true, subscriptions = [] as Subscription[], getSubscriptions = async () => subscriptions } = {}
) {
  updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
    status: 'available',
    info: { enable_page_history: true, self_hosted: !isOfficialHosted },
  });
  return render(
    <MemoryRouter>
      <AuthInternalContext.Provider
        value={{
          currentWorkspaceId: 'workspace-id',
          isAuthenticated: true,
          onChangeWorkspace: async () => undefined,
        }}
      >
        <AppOperationsContext.Provider
          value={{ getSubscriptions, getPricingCatalog } as unknown as AppOperationsContextType}
        >
          <UpgradePlan open onClose={() => undefined} onOpen={() => undefined} />
        </AppOperationsContext.Provider>
      </AuthInternalContext.Provider>
    </MemoryRouter>
  );
}

describe('UpgradePlan', () => {
  beforeEach(() => {
    mockTranslations = { ...defaultTranslations };
    resetPricingCatalogCache();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the comparison table with Pro highlighted as the upgrade target', async () => {
    renderModal(async () => catalog);

    const proColumn = await screen.findByTestId('pricing-plan-pro');
    const freeColumn = screen.getByTestId('pricing-plan-free');

    // Server copy wins even when this client has translations for known plan IDs.
    expect(within(freeColumn).getByText('Personal')).toBeTruthy();
    expect(within(freeColumn).getByText('Server free description')).toBeTruthy();
    expect(within(proColumn).getByText('Pro')).toBeTruthy();
    expect(within(proColumn).getByText('Server pro description')).toBeTruthy();

    // Free is the current plan; Pro is the upgrade target and therefore highlighted, like the desktop dialog.
    expect(within(freeColumn).getByTestId('current-plan-badge')).toBeTruthy();
    expect(within(proColumn).queryByTestId('current-plan-badge')).toBeNull();
    expect(proColumn.getAttribute('data-highlighted')).toBe('true');
    expect(freeColumn.getAttribute('data-highlighted')).toBe('false');

    // Annual per-month price with the annual billing note, desktop style; no interval tabs.
    // The amount is its own span so it can be larger than the qualifier.
    expect(within(proColumn).getByTestId('plan-price').textContent).toBe('$10 / member / month');
    expect(within(proColumn).getByText('$10')).toBeTruthy();
    expect(within(proColumn).getByText('billed annually')).toBeTruthy();
    expect(within(proColumn).queryByText(/billed monthly/)).toBeNull();
    expect(within(freeColumn).getByTestId('plan-price').textContent).toBe('$0 / member / month');
    expect(screen.queryByText('subscribe.monthly')).toBeNull();
    expect(screen.queryByTestId('pricing-plan-ai_max')).toBeNull();

    // Comparison rows from the catalog: labels, values, check marks and blank cells.
    const table = screen.getByTestId('plan-comparison');

    expect(within(table).getByText('Members')).toBeTruthy();
    expect(within(table).getByText('Guest editors')).toBeTruthy();
    expect(within(freeColumn).getByText('Up to 2')).toBeTruthy();
    expect(within(proColumn).getAllByText('Up to 10')).toHaveLength(2);
    expect(within(proColumn).getByText('Unlimited')).toBeTruthy();
    expect(within(freeColumn).getByText('5 GB')).toBeTruthy();
    expect(within(freeColumn).getAllByTestId('feature-included')).toHaveLength(1);
    expect(within(freeColumn).getAllByTestId('feature-excluded')).toHaveLength(1);
    expect(within(proColumn).getAllByTestId('feature-included')).toHaveLength(1);

    // Only the upgrade target has a button, and it checks out yearly.
    expect(within(freeColumn).queryByTestId('pricing-downgrade-free')).toBeNull();
    const { BillingService } = jest.requireMock('@/application/services/domains');

    BillingService.getSubscriptionLink.mockResolvedValue('https://checkout.example');
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    fireEvent.click(within(proColumn).getByTestId('pricing-upgrade-pro'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://checkout.example', '_current'));
    expect(BillingService.getSubscriptionLink).toHaveBeenCalledWith(
      'workspace-id',
      SubscriptionPlan.Pro,
      SubscriptionInterval.Year
    );
  });

  it('marks Pro as current and offers a downgrade on Free for a Pro workspace', async () => {
    renderModal(async () => catalog, {
      subscriptions: [
        {
          plan: SubscriptionPlan.Pro,
          currency: 'USD',
          price_cents: 1250,
          recurring_interval: SubscriptionInterval.Month,
        },
      ],
    });

    const proColumn = await screen.findByTestId('pricing-plan-pro');
    const freeColumn = screen.getByTestId('pricing-plan-free');

    await waitFor(() => expect(within(proColumn).getByTestId('current-plan-badge')).toBeTruthy());
    expect(proColumn.getAttribute('data-highlighted')).toBe('false');
    expect(within(proColumn).queryByTestId('pricing-upgrade-pro')).toBeNull();
    expect(within(freeColumn).getByTestId('pricing-downgrade-free')).toBeTruthy();
  });

  it.each([
    ['French', fr],
    ['Japanese', ja],
    ['Korean', ko],
    ['Thai', th],
    ['Turkish', tr],
    ['Ukrainian', uk],
    ['Vietnamese', vi],
  ] as const)('renders annual pricing without unfilled placeholders in %s', async (_language, resource) => {
    const { price, priceInfo } = resource.settings.comparePlanDialog.proPlan;

    mockTranslations['settings.comparePlanDialog.proPlan.price'] = price;
    mockTranslations['settings.comparePlanDialog.proPlan.priceInfo'] = priceInfo;
    renderModal(async () => catalog);

    const proColumn = await screen.findByTestId('pricing-plan-pro');

    expect(within(proColumn).getByTestId('plan-price').textContent).toBe('$10');
    expect(proColumn.textContent).not.toContain('{}');
    expect(proColumn.textContent).not.toContain('$12.5');
  });

  it('shows skeleton cards while the catalog loads', () => {
    renderModal(() => new Promise<PricingCatalog>(() => undefined));

    expect(screen.getByTestId('pricing-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();
  });

  it('offers a retry when the catalog cannot be loaded and recovers on success', async () => {
    const getPricingCatalog = jest
      .fn<Promise<PricingCatalog>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(catalog);

    renderModal(getPricingCatalog);

    const errorState = await screen.findByTestId('pricing-error');

    expect(within(errorState).getByText('subscribe.pricingUnavailable')).toBeTruthy();
    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();

    fireEvent.click(within(errorState).getByText('button.retry'));

    const proColumn = await screen.findByTestId('pricing-plan-pro');

    expect(within(proColumn).getByTestId('plan-price').textContent).toBe('$10 / member / month');
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it('hides paid plans when server-info did not confirm the official cloud', async () => {
    renderModal(async () => catalog, { isOfficialHosted: false });

    await screen.findByTestId('pricing-plan-free');
    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();
  });

  it('shows subscription loading and keeps actions unavailable until the current plan is known', async () => {
    let resolveSubscriptions!: (value: Subscription[]) => void;
    const request = new Promise<Subscription[]>((resolve) => {
      resolveSubscriptions = resolve;
    });

    renderModal(async () => catalog, { getSubscriptions: () => request });
    await screen.findByTestId('plan-comparison');
    expect(screen.getByTestId('subscription-loading')).toBeTruthy();
    expect(screen.queryByTestId('pricing-upgrade-pro')).toBeNull();
    expect(screen.queryByTestId('pricing-downgrade-free')).toBeNull();

    await act(async () => resolveSubscriptions([]));
    expect(await screen.findByTestId('pricing-upgrade-pro')).toBeTruthy();
    expect(screen.queryByTestId('subscription-loading')).toBeNull();
  });

  it('explains a failed subscription lookup and retries it without reloading the catalog', async () => {
    const getPricingCatalog = jest.fn().mockResolvedValue(catalog);
    const getSubscriptions = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);

    renderModal(getPricingCatalog, { getSubscriptions });
    const errorState = await screen.findByTestId('subscription-error');

    expect(errorState.textContent).toContain('subscribe.subscriptionUnavailable');
    expect(screen.getByTestId('plan-comparison')).toBeTruthy();
    expect(screen.queryByTestId('pricing-upgrade-pro')).toBeNull();
    expect(screen.queryByTestId('pricing-downgrade-free')).toBeNull();

    fireEvent.click(within(errorState).getByRole('button', { name: 'button.retry' }));

    expect(await screen.findByTestId('pricing-upgrade-pro')).toBeTruthy();
    expect(screen.queryByTestId('subscription-error')).toBeNull();
    expect(getSubscriptions).toHaveBeenCalledTimes(2);
    expect(getPricingCatalog).toHaveBeenCalledTimes(1);
  });
});
