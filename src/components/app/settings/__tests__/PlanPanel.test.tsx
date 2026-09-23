import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BillingService } from '@/application/services/domains';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
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

function renderPanel() {
  return render(
    <BillingTestProviders>
      <PlanPanel workspaceId='workspace-1' />
    </BillingTestProviders>
  );
}

describe('PlanPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.open = jest.fn();
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([]);
    api.getWorkspaceUsage.mockResolvedValue(freeUsage);
  });

  it('renders usage, Pro upgrade toggles and the current plan for a Free workspace', async () => {
    api.getSubscriptionLink.mockResolvedValue('https://checkout/pro');
    renderPanel();

    expect(await screen.findByText('1 of 5 GB')).toBeTruthy();
    expect(screen.getByText('3 of 10')).toBeTruthy();
    // Both toggles upsell Pro: unlimited AI is part of Pro now that AI Max is no longer sold.
    expect(screen.getByTestId('plan-toggle-pro').textContent).toContain('Pro');
    expect(screen.getByTestId('plan-toggle-unlimited-ai').textContent).toContain('Pro');
    expect(screen.queryByText('AI Max')).toBeNull();
    expect(screen.queryByTestId('plan-addon-ai-max')).toBeNull();
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Current plan');
    // Plan copy comes from the pricing catalog, localized with the compare dialog's strings.
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Free');
    expect(screen.getByTestId('current-plan-box').textContent).toContain('For individuals');

    fireEvent.click(screen.getByTestId('plan-change-plan'));
    expect(screen.getByTestId('location-search').textContent).toBe('?action=change_plan');

    fireEvent.click(screen.getByLabelText('Unlimited AI and advanced models'));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://checkout/pro', '_current'));
    expect(api.getSubscriptionLink).toHaveBeenCalledWith('workspace-1', SubscriptionPlan.Pro, SubscriptionInterval.Year);
  });

  it('shows unlimited badges, no toggles and a cancellation notice for a paid workspace', async () => {
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([
      workspaceStatus(SubscriptionPlan.Pro, { cancel_at: PERIOD_END }),
      workspaceStatus(SubscriptionPlan.AIMax),
    ]);
    api.getWorkspaceUsage.mockResolvedValue(proUsage);
    renderPanel();

    expect(await screen.findByText('Unlimited storage')).toBeTruthy();
    expect(screen.getByText('Unlimited responses')).toBeTruthy();
    expect(screen.queryByTestId('plan-toggle-pro')).toBeNull();
    expect(screen.queryByTestId('plan-toggle-unlimited-ai')).toBeNull();
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Pro');
    expect(screen.getByTestId('current-plan-box').textContent).toContain(
      `Downgraded to Free on ${renderDate(PERIOD_END, 'MM/DD/YYYY', true)}.`
    );
    // The retired AI Max add-on is not offered on the plan page even to a workspace that has it.
    expect(screen.queryByText('AI Max')).toBeNull();
  });
});
