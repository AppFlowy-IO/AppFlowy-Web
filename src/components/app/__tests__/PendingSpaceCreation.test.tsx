import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { SpaceCreationIntentStore } from '@/application/services/js-services/space-creation-intent';
import { SpaceVisibility } from '@/application/types';
import { PendingSpaceCreation } from '@/components/app/PendingSpaceCreation';

let mockWorkspace = 'workspace-a';
let mockActor = 'actor-a';
const mockClient = {};

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockActor } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => 'https://server-a' }));
jest.mock('@/application/services/js-services/http/core', () => ({ getAxios: () => mockClient }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => mockWorkspace,
  useEnsureViewVisibleInOutline: () => jest.fn(),
  useOpenPageModal: () => jest.fn(),
}));
jest.mock('@/components/app/view-actions/CreateSpaceModal', () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid='resume-dialog'>
      <button data-testid='resume-dialog-close' onClick={onClose}>close</button>
    </div>
  ),
}));
jest.mock('@/components/ui/button', () => ({ Button: ({ children, variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props}>{children}</button> }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ open, title, children, onOk, onCancel, okButtonProps }: {
    open: boolean; title: ReactNode; children: ReactNode; onOk: () => void; onCancel: () => void;
    okButtonProps?: { 'data-testid'?: string };
  }) => open ? (
    <div role='dialog'>
      <h2>{title}</h2>{children}
      <button onClick={onCancel}>cancel</button>
      <button data-testid={okButtonProps?.['data-testid']} onClick={onOk}>ok</button>
    </div>
  ) : null,
}));

function saveRequest() {
  new SpaceCreationIntentStore('workspace-a').begin({
    payload: { name: 'Submitted', view_id: 'space-a', permission: { visibility: SpaceVisibility.Custom } as never },
    members: [], selectedMembers: [], appliedMemberUids: [],
  });
}

beforeEach(() => { sessionStorage.clear(); mockWorkspace = 'workspace-a'; mockActor = 'actor-a'; });

test('Resume is reachable without an outline or creation capability and cannot follow an account/workspace switch', async () => {
  saveRequest();
  const app = render(<PendingSpaceCreation />);

  fireEvent.click(screen.getByTestId('resume-space-creation'));
  expect(await screen.findByTestId('resume-dialog')).toBeTruthy();
  mockActor = 'actor-b';
  app.rerender(<PendingSpaceCreation />);
  expect(screen.queryByTestId('resume-space-creation')).toBeNull();
  expect(screen.queryByTestId('resume-dialog')).toBeNull();
  mockActor = 'actor-a'; mockWorkspace = 'workspace-b';
  app.rerender(<PendingSpaceCreation />);
  expect(screen.queryByTestId('resume-space-creation')).toBeNull();
  mockWorkspace = 'workspace-a';
  app.rerender(<PendingSpaceCreation />);
  expect(screen.getByTestId('resume-space-creation')).toBeTruthy();
  // The switch closed the dialog; coming back offers the request without reopening it.
  expect(screen.queryByTestId('resume-dialog')).toBeNull();
});

test('an open Resume dialog stays until it is closed, even when its saved request goes away', async () => {
  saveRequest();
  render(<PendingSpaceCreation />);

  fireEvent.click(screen.getByTestId('resume-space-creation'));
  expect(await screen.findByTestId('resume-dialog')).toBeTruthy();
  // For example a released draft: the user keeps its fields until they close the dialog.
  act(() => new SpaceCreationIntentStore('workspace-a').discard());
  expect(screen.queryByTestId('pending-space-creation')).toBeNull();
  expect(screen.getByTestId('resume-dialog')).toBeTruthy();

  fireEvent.click(screen.getByTestId('resume-dialog-close'));
  expect(screen.queryByTestId('resume-dialog')).toBeNull();
  // A later saved request is offered in the sidebar but never opens by itself.
  act(() => saveRequest());
  expect(screen.getByTestId('resume-space-creation')).toBeTruthy();
  expect(screen.queryByTestId('resume-dialog')).toBeNull();
});

test('a saved request can be discarded from the sidebar after confirmation', () => {
  saveRequest();
  render(<PendingSpaceCreation />);

  const discard = screen.getByTestId('discard-space-creation');

  expect(discard.getAttribute('aria-label')).toBe('spaceCreation.discardSaved');
  fireEvent.click(discard);
  expect(screen.getByRole('dialog').textContent).toContain('spaceCreation.discardTitle');
  fireEvent.click(screen.getByText('cancel'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(sessionStorage.length).toBe(1);

  fireEvent.click(screen.getByTestId('discard-space-creation'));
  fireEvent.click(screen.getByTestId('discard-space-request-confirm'));
  expect(sessionStorage.length).toBe(0);
  expect(screen.queryByTestId('pending-space-creation')).toBeNull();
});

test('unreadable saved data shows an actionable entry that can be discarded instead of a permanent alert', () => {
  const key = `space-creation:v1:${new SpaceCreationIntentStore('workspace-a').scopeKey}`;

  sessionStorage.setItem(key, '{invalid');
  render(<PendingSpaceCreation />);

  expect(screen.getByTestId('pending-space-creation-invalid').textContent).toContain('spaceCreation.invalidRecovery');
  expect(screen.queryByTestId('resume-space-creation')).toBeNull();
  fireEvent.click(screen.getByTestId('discard-space-creation'));
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(screen.queryByTestId('pending-space-creation')).toBeNull();
});
