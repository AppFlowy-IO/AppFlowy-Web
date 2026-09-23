import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import { BillingService } from '@/application/services/domains';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import { BillingPanel } from '@/components/app/settings/BillingPanel';
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
    cancelSubscription: jest.fn(),
    getBillingPortalLink: jest.fn(),
    setSubscriptionRecurringInterval: jest.fn(),
    getPricingCatalog: jest.fn(),
  },
}));
jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    open,
    title,
    children,
    onOk,
    okButtonProps,
  }: {
    open: boolean;
    title?: ReactNode;
    children?: ReactNode;
    onOk?: () => void;
    okButtonProps?: { disabled?: boolean; 'data-testid'?: string };
  }) =>
    open ? (
      <div role='dialog'>
        <div>{title}</div>
        {children}
        <button
          type='button'
          data-testid={okButtonProps?.['data-testid'] ?? 'modal-ok'}
          disabled={okButtonProps?.disabled}
          onClick={onOk}
        >
          ok
        </button>
      </div>
    ) : null,
}));

const api = jest.mocked(BillingService);
const dueDate = renderDate(PERIOD_END, 'MM/DD/YYYY', true);

function renderPanel() {
  return render(
    <BillingTestProviders>
      <BillingPanel workspaceId='workspace-1' />
    </BillingTestProviders>
  );
}

describe('BillingPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPricingCatalogCache();
    window.open = jest.fn();
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([]);
    api.getWorkspaceUsage.mockResolvedValue(freeUsage);
  });

  it('shows the Free plan and opens the upgrade modal through the change_plan action', async () => {
    renderPanel();

    expect(await screen.findByText('Free')).toBeTruthy();
    expect(screen.queryByTestId('billing-edit-period')).toBeNull();
    expect(screen.queryByTestId('billing-edit-payment-method')).toBeNull();

    fireEvent.click(screen.getByTestId('billing-change-plan'));
    expect(screen.getByTestId('location-search').textContent).toBe('?action=change_plan');
  });

  it('does not offer the retired AI Max add-on to a workspace without it', async () => {
    renderPanel();

    expect(await screen.findByText('Free')).toBeTruthy();
    expect(screen.queryByText('Add-ons')).toBeNull();
    expect(screen.queryByTestId('billing-ai-max-action')).toBeNull();
    expect(api.getSubscriptionLink).not.toHaveBeenCalled();
  });

  it('describes an active AI Max add-on and removes it after confirmation', async () => {
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([
      workspaceStatus(SubscriptionPlan.AIMax, { recurring_interval: SubscriptionInterval.Month }),
    ]);
    api.cancelSubscription.mockResolvedValue(undefined);
    renderPanel();

    expect(await screen.findByText(`Next invoice due on ${dueDate}`)).toBeTruthy();
    expect(screen.getByTestId('billing-ai-max-action').textContent).toContain('Remove');
    expect(screen.getByText('AI Max period')).toBeTruthy();
    expect(screen.getByText('Monthly')).toBeTruthy();
    // Any paid subscription enables the Stripe customer portal.
    expect(screen.getByTestId('billing-edit-payment-method')).toBeTruthy();

    fireEvent.click(screen.getByTestId('billing-ai-max-action'));
    expect(screen.getByText('Remove AI Max')).toBeTruthy();
    expect(screen.getByText('Are you sure you want to remove AI Max? AI Max ends now.')).toBeTruthy();

    fireEvent.click(screen.getByTestId('billing-remove-confirm'));
    await waitFor(() =>
      expect(api.cancelSubscription).toHaveBeenCalledWith('workspace-1', SubscriptionPlan.AIMax, undefined)
    );
    await waitFor(() => expect(api.getWorkspaceSubscriptionStatus).toHaveBeenCalledTimes(2));
  });

  it('hides a canceled AI Max add-on instead of offering to renew it', async () => {
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([
      workspaceStatus(SubscriptionPlan.AIMax, { cancel_at: PERIOD_END }),
    ]);
    renderPanel();

    expect(await screen.findByText('Free')).toBeTruthy();
    expect(screen.queryByText(`AI Max will be available until ${dueDate}`)).toBeNull();
    expect(screen.queryByTestId('billing-ai-max-action')).toBeNull();
    expect(api.getSubscriptionLink).not.toHaveBeenCalled();
  });

  it('lets a Pro workspace edit its billing period and payment method', async () => {
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([workspaceStatus(SubscriptionPlan.Pro)]);
    api.getWorkspaceUsage.mockResolvedValue(proUsage);
    api.getBillingPortalLink.mockResolvedValue('https://portal');
    api.setSubscriptionRecurringInterval.mockResolvedValue(undefined);
    renderPanel();

    expect(await screen.findByText('Pro')).toBeTruthy();
    expect(screen.getByText('Annually')).toBeTruthy();

    fireEvent.click(screen.getByTestId('billing-edit-payment-method'));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://portal', '_current'));

    fireEvent.click(screen.getByTestId('billing-edit-period'));
    const confirm = await screen.findByTestId('change-period-confirm');

    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(`period-option-${SubscriptionInterval.Month}`));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.setSubscriptionRecurringInterval).toHaveBeenCalledWith(
        'workspace-1',
        SubscriptionPlan.Pro,
        SubscriptionInterval.Month
      )
    );
  });

  it('shows an error with retry when the billing data cannot be loaded', async () => {
    api.getWorkspaceSubscriptionStatus.mockRejectedValueOnce(new Error('billing down')).mockResolvedValue([]);
    renderPanel();

    expect((await screen.findByTestId('billing-error')).textContent).toContain('billing down');
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('Free')).toBeTruthy();
  });
});
