import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { SettingsDialog } from '../Settings';

let mockIsOfficialHosted = true;
let mockRole: string | undefined = 'Owner';
let mockOwnerUid = 42;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useUserWorkspaceInfo: () => ({
    workspaces: [{ id: 'workspace-1', role: mockRole, owner: { uid: mockOwnerUid } }],
  }),
  useIsOfficialHosted: () => mockIsOfficialHosted,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: '7' }) }));
jest.mock('@/components/app/settings/AccountAppPanel', () => ({ AccountAppPanel: () => null }));
jest.mock('@/components/app/settings/ProfilePanel', () => ({ ProfilePanel: () => null }));
jest.mock('@/components/app/settings/MembersPanel', () => ({ MembersPanel: () => null }));
jest.mock('@/components/app/settings/ManageDataPanel', () => ({ ManageDataPanel: () => null }));
jest.mock('@/components/app/settings/PlanPanel', () => ({
  PlanPanel: ({ workspaceId }: { workspaceId: string }) => <div data-testid='plan-panel-mock'>{workspaceId}</div>,
}));
jest.mock('@/components/app/settings/BillingPanel', () => ({
  BillingPanel: ({ workspaceId }: { workspaceId: string }) => <div data-testid='billing-panel-mock'>{workspaceId}</div>,
}));

const renderSettings = () =>
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <SettingsDialog open onClose={jest.fn()} />
    </MemoryRouter>
  );

describe('Settings billing menu', () => {
  beforeEach(() => {
    mockIsOfficialHosted = true;
    mockRole = 'Owner';
    mockOwnerUid = 42;
  });

  it('shows Plan and Billing to a workspace owner on the official cloud and renders the panels', async () => {
    renderSettings();

    fireEvent.click(screen.getByTestId('settings-menu-plan'));
    expect((await screen.findByTestId('plan-panel-mock')).textContent).toContain('workspace-1');

    fireEvent.click(screen.getByTestId('settings-menu-billing'));
    expect((await screen.findByTestId('billing-panel-mock')).textContent).toContain('workspace-1');
    expect(screen.queryByTestId('plan-panel-mock')).toBeNull();
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
});
