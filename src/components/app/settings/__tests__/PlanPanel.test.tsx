import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { BillingService } from '@/application/services/domains';
import { SubscriptionInterval, SubscriptionPlan, WorkspaceSubscriptionStatus, WorkspaceUsageAndLimit } from '@/application/types';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import { PlanPanel } from '@/components/app/settings/PlanPanel';
import UpgradePlan from '@/components/billing/UpgradePlan';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';
import { renderDate } from '@/utils/time';

import { BillingTestProviders, PERIOD_END, deferred, freeUsage, proUsage, translate, workspaceStatus } from './billing-test-utils';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: '7', metadata: {} }) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  BillingService: {
    getWorkspaceSubscriptionStatus: jest.fn(),
    getWorkspaceUsage: jest.fn(),
    getSubscriptionLink: jest.fn(),
    getPricingCatalog: jest.fn(),
    cancelSubscription: jest.fn(),
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
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
      status: 'available',
      info: { enable_page_history: true, self_hosted: false },
    });
    resetPricingCatalogCache();
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
    // Server plan copy takes precedence over the client's older Free translations.
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Personal');
    expect(screen.getByTestId('current-plan-box').textContent).toContain('For personal productivity');

    fireEvent.click(screen.getByTestId('plan-change-plan'));
    expect(screen.getByTestId('location-search').textContent).toBe('?action=change_plan');

    fireEvent.click(screen.getByLabelText('Unlimited AI and advanced models'));
    expect(screen.queryByTestId('change-period-confirm')).toBeNull();
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://checkout/pro', '_current'));
    expect(api.getSubscriptionLink).toHaveBeenCalledWith('workspace-1', SubscriptionPlan.Pro, SubscriptionInterval.Month);
  });

  it.each([
    [SubscriptionPlan.Free, 'Personal'],
    [SubscriptionPlan.Pro, 'Pro'],
  ])('shows unavailable storage while preserving the %s plan and AI usage when metering is disabled', async (plan, label) => {
    api.getWorkspaceSubscriptionStatus.mockResolvedValue(plan === SubscriptionPlan.Free ? [] : [workspaceStatus(plan)]);
    api.getWorkspaceUsage.mockResolvedValue({
      ...freeUsage,
      storage_bytes: 0,
      storage_bytes_limit: 0,
      storage_bytes_unlimited: true,
      storage_usage_available: false,
    });
    renderPanel();

    expect(await screen.findByText('Unavailable for the moment')).toBeTruthy();
    const storage = screen.getByTestId('plan-usage-storage');

    expect(within(storage).getByText('Storage')).toBeTruthy();
    expect(within(storage).queryByRole('progressbar')).toBeNull();
    expect(storage.querySelector('svg')).toBeNull();
    expect(screen.queryByText('Unlimited storage')).toBeNull();
    expect(screen.queryByText('0 of 0 GB')).toBeNull();
    expect(screen.getByTestId('plan-usage-ai').textContent).toContain('3 of 10');
    expect(screen.getByTestId('current-plan-box').textContent).toContain(label);
    expect(screen.queryByTestId('plan-usage-error')).toBeNull();
  });

  it.each([true, undefined])('keeps genuine unlimited storage for available or legacy responses (%s)', async (available) => {
    api.getWorkspaceUsage.mockResolvedValue({ ...proUsage, storage_usage_available: available });
    renderPanel();

    expect(await screen.findByText('Unlimited storage')).toBeTruthy();
    expect(screen.queryByText('Unavailable for the moment')).toBeNull();
  });

  it('shows the plan while usage is pending, then offers a retry without inventing usage', async () => {
    const usage = deferred<WorkspaceUsageAndLimit>();

    api.getWorkspaceUsage.mockReturnValueOnce(usage.promise).mockResolvedValue(freeUsage);
    renderPanel();

    expect((await screen.findByTestId('current-plan-box')).textContent).toContain('Personal');
    expect(screen.getByRole('status', { name: 'Plan usage summary' })).toBeTruthy();
    expect(screen.queryByTestId('plan-usage-storage')).toBeNull();
    expect(screen.queryByTestId('plan-usage-ai')).toBeNull();
    expect(screen.queryByTestId('plan-toggle-unlimited-ai')).toBeNull();
    expect(screen.getByTestId('plan-change-plan')).toBeTruthy();

    await act(async () => usage.reject(new Error('Storage accounting is recovering')));
    expect(screen.getByTestId('plan-usage-error').textContent).toContain('Usage is temporarily unavailable.');
    expect(screen.queryByText('Storage accounting is recovering')).toBeNull();
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Personal');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByTestId('plan-toggle-unlimited-ai')).toBeNull();

    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('1 of 5 GB')).toBeTruthy();
    expect(screen.getByText('3 of 10')).toBeTruthy();
    expect(screen.queryByTestId('plan-usage-error')).toBeNull();
    expect(api.getWorkspaceUsage).toHaveBeenCalledTimes(2);
  });

  it('keeps a subscription failure blocking even when usage succeeds', async () => {
    api.getWorkspaceSubscriptionStatus.mockRejectedValueOnce(new Error('billing unavailable'));
    renderPanel();

    expect((await screen.findByTestId('billing-error')).textContent).toContain('Something went wrong. Contact support if this keeps happening.');
    expect(screen.queryByTestId('current-plan-box')).toBeNull();
    expect(screen.queryByTestId('plan-usage-storage')).toBeNull();
    expect(screen.queryByTestId('plan-toggle-pro')).toBeNull();
  });

  it.each([
    [SubscriptionPlan.Free, 'Free'],
    [SubscriptionPlan.Pro, 'Pro'],
    [SubscriptionPlan.Team, 'Team'],
  ])('keeps the %s plan on older servers without a pricing catalog or available storage usage', async (plan, label) => {
    api.getWorkspaceSubscriptionStatus.mockResolvedValue(plan === SubscriptionPlan.Free ? [] : [workspaceStatus(plan)]);
    api.getWorkspaceUsage.mockRejectedValue({
      code: 1005,
      message: 'error returned from database: Workspace storage accounting is being recovered. Please retry shortly.',
    });
    const getPricingCatalog = jest.fn().mockRejectedValue({ response: { status: 404 } });

    render(
      <BillingTestProviders getPricingCatalog={getPricingCatalog}>
        <PlanPanel workspaceId='workspace-1' />
      </BillingTestProviders>
    );

    expect((await screen.findByTestId('current-plan-box')).textContent).toContain(label);
    expect(await screen.findByTestId('plan-usage-error')).toBeTruthy();
    expect(screen.queryByText(/error returned from database/)).toBeNull();
    expect(screen.queryByTestId('plan-usage-storage')).toBeNull();
    expect(api.getWorkspaceSubscriptionStatus).toHaveBeenCalledWith('workspace-1');
    expect(getPricingCatalog).toHaveBeenCalledTimes(1);
  });

  it('uses subscription status for an older Pro plan even when legacy usage has finite limits', async () => {
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([workspaceStatus(SubscriptionPlan.Pro)]);
    // Older usage responses have no newer AI counters or storage-enabled capability field.
    api.getWorkspaceUsage.mockResolvedValue(freeUsage);
    renderPanel();

    expect(await screen.findByText('1 of 5 GB')).toBeTruthy();
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Pro');
    expect(screen.queryByTestId('plan-toggle-pro')).toBeNull();
  });

  it('clears another workspace\'s data and ignores late subscription and usage responses', async () => {
    const lateStatus = deferred<WorkspaceSubscriptionStatus[]>();
    const lateUsage = deferred<WorkspaceUsageAndLimit>();
    const nextStatus = deferred<WorkspaceSubscriptionStatus[]>();
    const nextUsage = deferred<WorkspaceUsageAndLimit>();

    api.getWorkspaceSubscriptionStatus
      .mockResolvedValueOnce([workspaceStatus(SubscriptionPlan.Pro)])
      .mockReturnValueOnce(lateStatus.promise)
      .mockReturnValueOnce(nextStatus.promise);
    api.getWorkspaceUsage
      .mockRejectedValueOnce(new Error('temporary usage failure'))
      .mockReturnValueOnce(lateUsage.promise)
      .mockReturnValueOnce(nextUsage.promise);
    const content = (workspaceId: string) => (
      <BillingTestProviders><PlanPanel workspaceId={workspaceId} /></BillingTestProviders>
    );
    const view = render(content('workspace-1'));

    expect((await screen.findByTestId('current-plan-box')).textContent).toContain('Pro');
    fireEvent.click(await screen.findByText('Retry'));
    view.rerender(content('workspace-2'));
    expect(screen.queryByTestId('current-plan-box')).toBeNull();
    expect(screen.queryByTestId('plan-usage-storage')).toBeNull();

    await act(async () => nextStatus.resolve([]));
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Personal');
    expect(screen.queryByTestId('plan-usage-storage')).toBeNull();
    await act(async () => {
      lateStatus.resolve([workspaceStatus(SubscriptionPlan.Pro)]);
      lateUsage.resolve(proUsage);
    });
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Personal');
    expect(screen.queryByText('Unlimited storage')).toBeNull();
    expect(screen.queryByTestId('plan-usage-storage')).toBeNull();

    await act(async () => nextUsage.resolve(freeUsage));
    expect(screen.getByText('1 of 5 GB')).toBeTruthy();
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Personal');
  });

  it('does not display previously loaded usage while the next workspace is loading', async () => {
    const status = deferred<WorkspaceSubscriptionStatus[]>();
    const usage = deferred<WorkspaceUsageAndLimit>();

    api.getWorkspaceSubscriptionStatus
      .mockResolvedValueOnce([workspaceStatus(SubscriptionPlan.Pro)])
      .mockReturnValueOnce(status.promise);
    api.getWorkspaceUsage.mockResolvedValueOnce(proUsage).mockReturnValueOnce(usage.promise);
    const content = (workspaceId: string) => (
      <BillingTestProviders><PlanPanel workspaceId={workspaceId} /></BillingTestProviders>
    );
    const view = render(content('workspace-1'));

    expect(await screen.findByText('Unlimited storage')).toBeTruthy();
    view.rerender(content('workspace-2'));
    expect(screen.queryByTestId('current-plan-box')).toBeNull();
    expect(screen.queryByText('Unlimited storage')).toBeNull();

    await act(async () => status.resolve([]));
    expect(screen.getByTestId('current-plan-box').textContent).toContain('Personal');
    expect(screen.queryByTestId('plan-usage-storage')).toBeNull();
    expect(screen.queryByTestId('plan-toggle-unlimited-ai')).toBeNull();
    await act(async () => usage.reject(new Error('next workspace usage unavailable')));
    expect(screen.getByTestId('plan-usage-error')).toBeTruthy();
    expect(screen.queryByText('Unlimited storage')).toBeNull();
  });

  it.each(['plan-toggle-pro', 'plan-toggle-unlimited-ai'])('opens monthly checkout directly from %s and blocks repeat clicks', async (toggle) => {
    let resolveCheckout!: (link: string) => void;

    api.getSubscriptionLink.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveCheckout = resolve;
    }));
    renderPanel();
    const button = (await screen.findByTestId(toggle)).querySelector('button')!;

    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.getSubscriptionLink).toHaveBeenCalledTimes(1);
    expect(api.getSubscriptionLink).toHaveBeenCalledWith(
      'workspace-1', SubscriptionPlan.Pro, SubscriptionInterval.Month
    );
    expect(screen.queryByTestId('period-option-month')).toBeNull();
    expect(screen.queryByTestId('change-period-confirm')).toBeNull();
    for (const id of ['plan-toggle-pro', 'plan-toggle-unlimited-ai']) {
      expect(screen.getByTestId(id).querySelector('button')!.disabled).toBe(true);
    }

    await act(async () => resolveCheckout('https://checkout/pro-monthly'));
    expect(window.open).toHaveBeenCalledWith('https://checkout/pro-monthly', '_current');
  });

  it('allows retrying monthly checkout after a failed request', async () => {
    const { notify } = jest.requireMock('@/components/_shared/notify');

    api.getSubscriptionLink.mockRejectedValueOnce(new Error('Checkout unavailable'))
      .mockResolvedValueOnce('https://checkout/retry');
    renderPanel();
    const button = (await screen.findByTestId('plan-toggle-pro')).querySelector('button')!;

    fireEvent.click(button);
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Something went wrong. Contact support if this keeps happening.'));
    expect(button.disabled).toBe(false);
    expect(window.open).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://checkout/retry', '_current'));
    expect(api.getSubscriptionLink).toHaveBeenLastCalledWith(
      'workspace-1', SubscriptionPlan.Pro, SubscriptionInterval.Month
    );
  });

  it('ignores a checkout response after switching workspaces', async () => {
    let resolveCheckout!: (link: string) => void;

    api.getSubscriptionLink.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveCheckout = resolve;
    })).mockResolvedValueOnce('https://checkout/workspace-b');
    const content = (workspaceId: string) => (
      <BillingTestProviders><PlanPanel workspaceId={workspaceId} /></BillingTestProviders>
    );
    const view = render(content('workspace-1'));

    fireEvent.click((await screen.findByTestId('plan-toggle-pro')).querySelector('button')!);
    view.rerender(content('workspace-b'));
    fireEvent.click((await screen.findByTestId('plan-toggle-pro')).querySelector('button')!);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://checkout/workspace-b', '_current'));
    expect(api.getSubscriptionLink).toHaveBeenLastCalledWith(
      'workspace-b', SubscriptionPlan.Pro, SubscriptionInterval.Month
    );
    await act(async () => resolveCheckout('https://checkout/workspace-a'));
    expect(window.open).toHaveBeenCalledTimes(1);
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
    expect(screen.getByTestId('current-plan-box').textContent).toContain('For professional work and teams');
    expect(screen.getByTestId('current-plan-box').textContent).toContain(
      `Downgraded to Free on ${renderDate(PERIOD_END, 'MM/DD/YYYY', true)}.`
    );
    // The retired AI Max add-on is not offered on the plan page even to a workspace that has it.
    expect(screen.queryByText('AI Max')).toBeNull();
  });

  it('refreshes the mounted plan panel after downgrading in the comparison dialog', async () => {
    let canceled = false;

    api.getWorkspaceSubscriptionStatus.mockImplementation(async () => [
      workspaceStatus(SubscriptionPlan.Pro, { cancel_at: canceled ? PERIOD_END : null }),
    ]);
    api.getWorkspaceUsage.mockResolvedValue(proUsage);
    api.cancelSubscription.mockImplementation(async () => {
      canceled = true;
    });
    const getSubscriptions = jest.fn(async () =>
      canceled
        ? []
        : [
            {
              plan: SubscriptionPlan.Pro,
              currency: 'USD',
              price_cents: 12000,
              recurring_interval: SubscriptionInterval.Year,
            },
          ]
    );

    function ComparisonDialog() {
      const [open, setOpen] = useState(false);

      return <UpgradePlan open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />;
    }

    render(
      <AuthInternalContext.Provider
        value={{
          currentWorkspaceId: 'workspace-1',
          isAuthenticated: true,
          onChangeWorkspace: async () => undefined,
        }}
      >
        <BillingTestProviders getSubscriptions={getSubscriptions}>
          <PlanPanel workspaceId='workspace-1' />
          <ComparisonDialog />
        </BillingTestProviders>
      </AuthInternalContext.Provider>
    );

    fireEvent.click(await screen.findByTestId('plan-change-plan'));
    fireEvent.click(await screen.findByTestId('pricing-downgrade-free'));
    for (let question = 0; question < 3; question++) {
      fireEvent.click(await screen.findByRole('button', { name: 'button.next' }));
    }

    fireEvent.click(screen.getByRole('button', { name: 'button.done' }));
    await waitFor(() => expect(api.cancelSubscription).toHaveBeenCalledWith('workspace-1', SubscriptionPlan.Pro, '[]'));
    await screen.findByTestId('pricing-upgrade-pro');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'subscribe.cancelPlan.title' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'button.close' }));

    expect(await screen.findByText(`Downgraded to Free on ${renderDate(PERIOD_END, 'MM/DD/YYYY', true)}.`)).toBeTruthy();
    expect(api.getWorkspaceSubscriptionStatus).toHaveBeenCalledTimes(2);
  });
});
