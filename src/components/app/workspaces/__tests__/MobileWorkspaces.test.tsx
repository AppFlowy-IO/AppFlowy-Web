import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import MobileWorkspaces from '../MobileWorkspaces';

const mockChange = jest.fn();
const mockNotifyError = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: (...args: unknown[]) => mockNotifyError(...args) } }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ email: 'user@example.com' }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'current',
  useUserWorkspaceInfo: () => ({ workspaces: [{ id: 'current', name: 'Current' }, { id: 'other', name: 'Other' }] }),
  useAppOperations: () => ({ onChangeWorkspace: mockChange }),
}));
jest.mock('@/components/_shared/mobile-drawer', () => ({
  MobileDrawer: ({ triggerNode, children }: { triggerNode: ReactNode; children: ReactNode }) => (
    <div>
      {triggerNode}
      {children}
    </div>
  ),
}));
jest.mock('@/components/app/workspaces/CurrentWorkspace', () => ({
  __esModule: true,
  default: ({ onChangeWorkspace }: { onChangeWorkspace: (id: string) => void }) => (
    <button type='button' onClick={() => onChangeWorkspace('other')}>
      Open other
    </button>
  ),
}));
jest.mock('@/components/app/workspaces/WorkspaceList', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
});

test("a failed switch to another workspace is reported in the reader's language", async () => {
  mockChange.mockRejectedValueOnce(new Error('Network Error'));
  const onClose = jest.fn();

  render(<MobileWorkspaces onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open other' }));

  await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('workspace.openFailed'));
  expect(mockChange).toHaveBeenCalledWith('other');
});

test('a successful switch reports nothing', async () => {
  mockChange.mockResolvedValueOnce(undefined);
  const onClose = jest.fn();

  render(<MobileWorkspaces onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open other' }));

  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(mockNotifyError).not.toHaveBeenCalled();
});
