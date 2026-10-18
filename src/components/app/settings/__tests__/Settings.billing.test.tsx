jest.mock('@/components/app/hooks/useWorkspaceCreationCapability', () => ({
  useWorkspaceCreationCapability: () => ({ status: 'ready', canCreate: true, refresh: jest.fn(), isCurrent: () => true, scopeKey: 'server:user' }),
}));
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { BillingService } from '@/application/services/domains';
import { Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import { Workspaces } from '@/components/app/workspaces/Workspaces';

import { SettingsDialog } from '../Settings';

import { catalog, deferred, freeUsage, setBillingHostingMode, workspaceStatus } from './billing-test-utils';

let mockIsOfficialHosted = true;
let mockCurrentWorkspaceId = 'workspace-1';
let mockRole: string | undefined = 'Owner';
let mockOwnerUid = 42;
let mockWorkspaceInfo: { workspaces: { id: string; role?: string; owner: { uid: number } }[] };
let mockGetSubscriptions = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => mockCurrentWorkspaceId,
  useUserWorkspaceInfo: () => mockWorkspaceInfo,
  useIsOfficialHosted: () => mockIsOfficialHosted,
  useRefreshUserWorkspaceInfo: () => undefined,
  useAppOperations: () => ({}),
  useGetSubscriptions: () => mockGetSubscriptions,
}));
jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => 'user',
  useCurrentUserOptional: () => ({ uid: '7' }),
  useCurrentUser: () => ({ uid: '7' }),
}));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { create: jest.fn() },
  BillingService: {
    getWorkspaceSubscriptionStatus: jest.fn(),
    getWorkspaceUsage: jest.fn(),
    getPricingCatalog: jest.fn(),
  },
}));
jest.mock('@/components/_shared/more-actions/importer/Import', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/workspaces/CurrentWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/workspaces/WorkspaceList', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/workspaces/EditWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/workspaces/DeleteWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/workspaces/LeaveWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/settings/AccountAppPanel', () => ({ AccountAppPanel: () => null }));
jest.mock('@/components/app/settings/ProfilePanel', () => ({ ProfilePanel: () => null }));
jest.mock('@/components/app/settings/MembersPanel', () => ({ MembersPanel: () => null }));
jest.mock('@/components/app/settings/ManageDataPanel', () => ({ ManageDataPanel: () => null }));

function renderSettings(withWorkspaceMenu = false, search = '') {
  mockWorkspaceInfo = { workspaces: [{ id: 'workspace-1', role: mockRole, owner: { uid: mockOwnerUid } }] };

  return render(
    <MemoryRouter initialEntries={['/' + search]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      {withWorkspaceMenu ? <Workspaces /> : <SettingsDialog open onClose={jest.fn()} />}
    </MemoryRouter>
  );
}

function subscription(plan: SubscriptionPlan): Subscription {
  return { plan, currency: 'USD', price_cents: 2000, recurring_interval: SubscriptionInterval.Month };
}

async function openWorkspaceMenu() {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('workspace-dropdown-trigger'), { key: 'Enter' });
  });
  expect(screen.getByTestId('workspace-dropdown-content')).toBeTruthy();
}

describe('Workspace billing entry points', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setBillingHostingMode();
    resetPricingCatalogCache();
    mockIsOfficialHosted = true;
    mockCurrentWorkspaceId = 'workspace-1';
    mockRole = 'Owner';
    mockOwnerUid = 42;
    mockGetSubscriptions = jest.fn().mockResolvedValue([]);
    jest.mocked(BillingService.getWorkspaceSubscriptionStatus).mockResolvedValue([]);
    jest.mocked(BillingService.getWorkspaceUsage).mockResolvedValue(freeUsage);
    jest.mocked(BillingService.getPricingCatalog).mockResolvedValue(catalog);
  });

  it.each([SubscriptionPlan.Pro, SubscriptionPlan.Team])('hides the upgrade entry for a %s workspace', async (plan) => {
    mockGetSubscriptions.mockResolvedValue([subscription(plan)]);
    renderSettings(true);
    expect(mockGetSubscriptions).not.toHaveBeenCalled();

    await openWorkspaceMenu();

    expect(screen.queryByRole('menuitem', { name: 'subscribe.changePlan' })).toBeNull();
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'Free', subscriptions: [] },
    { name: 'AI add-on only', subscriptions: [subscription(SubscriptionPlan.AIMax)] },
  ])('offers an upgrade for a $name workspace', async ({ subscriptions }) => {
    mockGetSubscriptions.mockResolvedValue(subscriptions);
    renderSettings(true);

    await openWorkspaceMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'subscribe.changePlan' }));
    expect(await screen.findByTestId('pricing-upgrade-pro')).toBeTruthy();
  });

  it('withholds the upgrade entry while the plan is loading or unavailable', async () => {
    const request = deferred<Subscription[]>();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetSubscriptions.mockReturnValue(request.promise);
    renderSettings(true);

    try {
      await openWorkspaceMenu();
      expect(screen.queryByRole('menuitem', { name: 'subscribe.changePlan' })).toBeNull();

      await act(async () => request.reject(new Error('Billing unavailable')));

      expect(screen.queryByRole('menuitem', { name: 'subscribe.changePlan' })).toBeNull();
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('refreshes the plan when the menu reopens after an upgrade', async () => {
    renderSettings(true);
    await openWorkspaceMenu();
    expect(screen.getByRole('menuitem', { name: 'subscribe.changePlan' })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByTestId('workspace-dropdown-content')).toBeNull();
    mockGetSubscriptions.mockResolvedValue([subscription(SubscriptionPlan.Pro)]);
    await openWorkspaceMenu();

    expect(screen.queryByRole('menuitem', { name: 'subscribe.changePlan' })).toBeNull();
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('ignores a previous workspace response after switching to a Pro workspace', async () => {
    const previousRequest = deferred<Subscription[]>();

    mockGetSubscriptions.mockReturnValue(previousRequest.promise);
    const { rerender } = renderSettings(true);

    await openWorkspaceMenu();
    mockCurrentWorkspaceId = 'workspace-2';
    mockWorkspaceInfo = { workspaces: [{ id: 'workspace-2', role: 'Owner', owner: { uid: 7 } }] };
    mockGetSubscriptions = jest.fn().mockResolvedValue([subscription(SubscriptionPlan.Pro)]);
    await act(async () => {
      rerender(
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <Workspaces />
        </MemoryRouter>
      );
    });
    await act(async () => previousRequest.resolve([]));

    expect(screen.getByTestId('workspace-dropdown-content')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'subscribe.changePlan' })).toBeNull();
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('shows Plan and Billing to a workspace owner on the official cloud and renders the panels', async () => {
    renderSettings();

    fireEvent.click(screen.getByTestId('settings-menu-plan'));
    expect(await screen.findByTestId('plan-change-plan')).toBeTruthy();

    fireEvent.click(screen.getByTestId('settings-menu-billing'));
    expect(await screen.findByTestId('billing-change-plan')).toBeTruthy();
    expect(screen.queryByTestId('plan-panel')).toBeNull();
    expect(BillingService.getWorkspaceSubscriptionStatus).toHaveBeenCalledWith('workspace-1');
  });

  it('recognises the owner by uid when the role is missing', () => {
    mockRole = undefined;
    mockOwnerUid = 7;
    renderSettings();

    expect(screen.getByTestId('settings-menu-plan')).toBeTruthy();
  });

  it('hides Plan and Billing on self-hosted servers', () => {
    mockIsOfficialHosted = false;
    setBillingHostingMode('self-hosted');
    renderSettings();

    expect(screen.queryByTestId('settings-menu-plan')).toBeNull();
    expect(screen.queryByTestId('settings-menu-billing')).toBeNull();
  });

  it('hides Plan and Billing from members who do not own the workspace', () => {
    mockRole = 'Member';
    renderSettings();

    expect(screen.queryByTestId('settings-menu-plan')).toBeNull();
    expect(screen.queryByTestId('settings-menu-billing')).toBeNull();
  });

  it.each(['plan', 'billing'])('keeps plan management available from %s for a Pro workspace owner', async (panel) => {
    mockGetSubscriptions.mockResolvedValue([subscription(SubscriptionPlan.Pro)]);
    jest
      .mocked(BillingService.getWorkspaceSubscriptionStatus)
      .mockResolvedValue([workspaceStatus(SubscriptionPlan.Pro)]);
    renderSettings(true, `?setting=${panel.toUpperCase()}`);

    fireEvent.click(await screen.findByTestId(`${panel}-change-plan`));

    expect(await screen.findByRole('dialog', { name: 'subscribe.upgradePlanTitle' })).toBeTruthy();
    expect(await screen.findByTestId('pricing-downgrade-free')).toBeTruthy();
  });

  it('opens the comparison dialog for an owner identified only by UID', async () => {
    mockRole = undefined;
    mockOwnerUid = 7;
    renderSettings(true, '?setting=PLAN');

    fireEvent.click(await screen.findByTestId('plan-change-plan'));

    expect(await screen.findByTestId('pricing-upgrade-pro')).toBeTruthy();
  });

  it.each([
    { role: 'Member', mode: 'cloud', panel: 'PLAN' },
    { role: 'Owner', mode: 'self-hosted', panel: 'PLAN' },
    { role: 'Owner', mode: 'self-hosted', panel: 'BILLING' },
    { role: 'Owner', mode: 'unknown', panel: 'PLAN' },
  ] as const)(
    'rejects $panel deep links for role $role with $mode hosting without requests',
    async ({ role, mode, panel }) => {
      mockRole = role;
      mockIsOfficialHosted = mode === 'cloud';
      setBillingHostingMode(mode);
      renderSettings(true, `?setting=${panel}&action=change_plan`);

      await screen.findByTestId('settings-dialog');
      expect(screen.queryByTestId('settings-menu-plan')).toBeNull();
      expect(screen.queryByTestId('settings-menu-billing')).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'subscribe.upgradePlanTitle' })).toBeNull();
      expect(mockGetSubscriptions).not.toHaveBeenCalled();
      for (const method of Object.values(BillingService)) expect(method).not.toHaveBeenCalled();
    }
  );
});
