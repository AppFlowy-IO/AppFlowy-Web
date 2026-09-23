import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BillingService } from '@/application/services/domains';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import { PlanPanel } from '@/components/app/settings/PlanPanel';
import { renderDate } from '@/utils/time';

import { BillingTestProviders, PERIOD_END, freeUsage, proUsage, translate, workspaceStatus } from './billing-test-utils';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: '7', metadata: {} }) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  BillingService: {
    getWorkspaceSubscriptionStatus: jest.fn(),
    getWorkspaceUsage: jest.fn(),
    getSubscriptionLink: jest.fn(),
    getPricingCatalog: jest.fn(),
  },
}));

const api = jest.mocked(BillingService);

function renderPanel(getPricingCatalog?: () => Promise<never>) {
  return render(
    <BillingTestProviders getPricingCatalog={getPricingCatalog}>
      <PlanPanel workspaceId='workspace-1' />
    </BillingTestProviders>
  );
}

describe('PlanPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPricingCatalogCache();
    window.open = jest.fn();
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([]);
    api.getWorkspaceUsage.mockResolvedValue(freeUsage);
  });

  it('renders usage, upgrade toggles, the current plan and catalog prices for a Free workspace', async () => {
    api.getSubscriptionLink.mockResolvedValue('https://checkout/ai-max');
    renderPanel();

    expect(await screen.findByText('1 of 5 GB')).toBeTruthy();
    expect(screen.getByText('3 of 10')).toBeTruthy();
    expect(screen.getByTestId('plan-toggle-pro')).toBeTruthy();
    expect(screen.getByTestId('plan-toggle-ai-max')).toBeTruthy();
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Free');
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Perfect for individuals');

    const aiMaxBox = await screen.findByTestId('plan-addon-ai-max');

    await waitFor(() => expect(aiMaxBox.textContent).toContain('$8'));
    expect(aiMaxBox.getAttribute('data-active')).toBe('false');
    expect(screen.queryByTestId('plan-addon-vault')).toBeNull();

    fireEvent.click(screen.getByTestId('plan-change-plan'));
    expect(screen.getByTestId('location-search').textContent).toBe('?action=change_plan');

    fireEvent.click(screen.getAllByText('Add')[0]);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://checkout/ai-max', '_current'));
    expect(api.getSubscriptionLink).toHaveBeenCalledWith('workspace-1', SubscriptionPlan.AIMax, SubscriptionInterval.Year);
  });

  it('shows unlimited badges, the Added state and a cancellation notice for a paid workspace', async () => {
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([
      workspaceStatus(SubscriptionPlan.Pro, { cancel_at: PERIOD_END }),
      workspaceStatus(SubscriptionPlan.AIMax),
    ]);
    api.getWorkspaceUsage.mockResolvedValue(proUsage);
    renderPanel();

    expect(await screen.findByText('Unlimited storage')).toBeTruthy();
    expect(screen.getByText('Unlimited responses')).toBeTruthy();
    expect(screen.queryByTestId('plan-toggle-pro')).toBeNull();
    expect(screen.queryByTestId('plan-toggle-ai-max')).toBeNull();
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Pro');
    expect(screen.getByTestId('current-plan-box').textContent).toContain(
      `Downgraded to Free on ${renderDate(PERIOD_END, 'MM/DD/YYYY', true)}.`
    );

    const aiMaxBox = await screen.findByTestId('plan-addon-ai-max');

    await waitFor(() => expect(aiMaxBox.getAttribute('data-active')).toBe('true'));
    expect(aiMaxBox.textContent).toContain('Added');
  });

  it('keeps the usage summary when the pricing catalog fails and offers a retry', async () => {
    const getPricingCatalog = jest.fn().mockRejectedValueOnce(new Error('offline'));

    renderPanel(getPricingCatalog);

    expect(await screen.findByText('1 of 5 GB')).toBeTruthy();
    expect((await screen.findAllByTestId('pricing-error')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('plan-addon-ai-max')).toBeNull();

    getPricingCatalog.mockResolvedValue(
      (await import('./billing-test-utils')).catalog
    );
    fireEvent.click(screen.getAllByText('Retry')[0]);
    expect(await screen.findByTestId('plan-addon-ai-max')).toBeTruthy();
  });
});
