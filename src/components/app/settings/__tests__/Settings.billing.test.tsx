import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { BillingService } from '@/application/services/domains';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import { Workspaces } from '@/components/app/workspaces/Workspaces';

import { SettingsDialog } from '../Settings';

import { catalog, freeUsage } from './billing-test-utils';

let mockIsOfficialHosted = true;
let mockRole: string | undefined = 'Owner';
let mockOwnerUid = 42;
let mockWorkspaceInfo: { workspaces: { id: string; role?: string; owner: { uid: number } }[] };
const mockGetSubscriptions = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useUserWorkspaceInfo: () => mockWorkspaceInfo,
  useIsOfficialHosted: () => mockIsOfficialHosted,
  useRefreshUserWorkspaceInfo: () => undefined,
  useAppOperations: () => ({}),
  useGetSubscriptions: () => mockGetSubscriptions,
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ uid: '7' }),
  useCurrentUser: () => ({ uid: '7' }),
}));
jest.mock('@/application/services/domains', () => ({
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

describe('Settings billing menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPricingCatalogCache();
    mockIsOfficialHosted = true;
    mockRole = 'Owner';
    mockOwnerUid = 42;
    mockGetSubscriptions.mockResolvedValue([]);
    jest.mocked(BillingService.getWorkspaceSubscriptionStatus).mockResolvedValue([]);
    jest.mocked(BillingService.getWorkspaceUsage).mockResolvedValue(freeUsage);
    jest.mocked(BillingService.getPricingCatalog).mockResolvedValue(catalog);
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

  it.each(['plan', 'billing'])(
    'opens the comparison dialog from %s for an owner with a different owner UID',
    async (panel) => {
      renderSettings(true, `?setting=${panel.toUpperCase()}`);

      fireEvent.click(await screen.findByTestId(`${panel}-change-plan`));

      expect(await screen.findByRole('dialog', { name: 'subscribe.upgradePlanTitle' })).toBeTruthy();
      expect(await screen.findByTestId('pricing-upgrade-pro')).toBeTruthy();
    }
  );

  it('opens the comparison dialog for an owner identified only by UID', async () => {
    mockRole = undefined;
    mockOwnerUid = 7;
    renderSettings(true, '?setting=PLAN');

    fireEvent.click(await screen.findByTestId('plan-change-plan'));

    expect(await screen.findByTestId('pricing-upgrade-pro')).toBeTruthy();
  });

  it.each([
    { role: 'Member', hosted: true },
    { role: 'Owner', hosted: false },
  ])('rejects billing deep links for role $role with official hosting $hosted', async ({ role, hosted }) => {
    mockRole = role;
    mockIsOfficialHosted = hosted;
    renderSettings(true, '?setting=PLAN&action=change_plan');

    await screen.findByTestId('settings-dialog');
    expect(screen.queryByTestId('settings-menu-plan')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'subscribe.upgradePlanTitle' })).toBeNull();
  });
});
