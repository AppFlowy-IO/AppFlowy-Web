import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import en from '@/@types/translations/en.json';

import { SettingsDialog } from '../Settings';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useUserWorkspaceInfo: () => undefined,
  useIsOfficialHosted: () => false,
}));
jest.mock('@/components/app/settings/AccountAppPanel', () => ({ AccountAppPanel: () => null }));
jest.mock('@/components/app/settings/ProfilePanel', () => ({ ProfilePanel: () => null }));
jest.mock('@/components/app/settings/ManageDataPanel', () => ({ ManageDataPanel: () => null }));
jest.mock('@/components/app/settings/MembersPanel', () => ({
  MembersPanel: ({ initialTab }: { initialTab?: string }) => (
    <div data-testid='members-panel'>{initialTab ?? 'default-tab'}</div>
  ),
}));
jest.mock('@/components/app/settings/WorkspacePermissionsPanel', () => ({
  WorkspacePermissionsPanel: ({ onOpenGroups }: { onOpenGroups?: () => void }) => (
    <button type='button' onClick={onOpenGroups}>
      groupSpaceAccess.manageGroups
    </button>
  ),
}));

function renderSettings() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <SettingsDialog open onClose={jest.fn()} />
    </MemoryRouter>
  );
}

describe('Permissions settings navigation', () => {
  it('labels the menu entry with the short Permissions title and an app icon', () => {
    renderSettings();
    const item = screen.getByTestId('settings-menu-permissions');

    expect(item.textContent).toBe('workspacePermissions.title');
    expect(en.workspacePermissions.title).toBe('Permissions');
    // Same SVG set as the sibling entries, not a lucide glyph with a different stroke.
    expect(item.querySelector('svg')?.getAttribute('class') ?? '').not.toContain('lucide');
  });

  it('opens People > Groups from the Permissions panel and resets the tab on manual navigation', async () => {
    renderSettings();
    fireEvent.click(screen.getByTestId('settings-menu-permissions'));
    fireEvent.click(await screen.findByRole('button', { name: 'groupSpaceAccess.manageGroups' }));

    expect(screen.getByTestId('members-panel').textContent).toBe('groups');
    expect(screen.getByTestId('settings-menu-members').getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByTestId('settings-menu-account'));
    fireEvent.click(screen.getByTestId('settings-menu-members'));
    expect(screen.getByTestId('members-panel').textContent).toBe('default-tab');
  });
});
