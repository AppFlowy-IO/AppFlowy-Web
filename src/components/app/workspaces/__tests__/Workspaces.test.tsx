import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { Workspaces } from '../Workspaces';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
}));

jest.mock('@/components/app/settings', () => ({
  SettingsDialog: () => null,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({
    uid: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  }),
  useIsAuthenticatedOptional: () => true,
  useIsAuthenticated: () => true,
}));

const mockWorkspaces = [
  { id: 'ws-1', name: 'Workspace 1', owner: { uid: 'user-1' } },
  { id: 'ws-2', name: 'Workspace 2', owner: { uid: 'user-1' } },
  { id: 'ws-3', name: 'Workspace 3', owner: { uid: 'user-1' } },
  { id: 'ws-4', name: 'Workspace 4', owner: { uid: 'user-1' } },
  { id: 'ws-5', name: 'Workspace 5', owner: { uid: 'user-1' } },
  { id: 'ws-6', name: 'Workspace 6', owner: { uid: 'user-1' } },
  { id: 'ws-7', name: 'Workspace 7', owner: { uid: 'user-1' } },
];

jest.mock('@/components/app/app.hooks', () => ({
  useUserWorkspaceInfo: () => ({ workspaces: mockWorkspaces }),
  useCurrentWorkspaceId: () => 'ws-1',
  useRefreshUserWorkspaceInfo: () => jest.fn(),
  useAIEnabled: () => false,
  useAppOperations: () => ({ onChangeWorkspace: jest.fn() }),
}));

jest.mock('@/utils/subscription', () => ({
  isAppFlowyHosted: () => false,
}));

describe('Workspaces dropdown list visibility', () => {
  it('renders workspace list container with visible scrollbar class and increased height', async () => {
    render(
      <MemoryRouter>
        <Workspaces />
      </MemoryRouter>
    );

    const trigger = screen.getByTestId('workspace-dropdown-trigger');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      const workspaceListContainer = screen.getByTestId('workspace-list');
      expect(workspaceListContainer).toBeTruthy();
      expect(workspaceListContainer.className).toContain('appflowy-visible-scrollbar');
      expect(workspaceListContainer.className).toContain('max-h-[320px]');
    });
  });
});
