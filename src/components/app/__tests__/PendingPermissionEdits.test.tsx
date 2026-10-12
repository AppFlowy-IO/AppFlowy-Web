import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { hasUnscopedCollabData } from '@/application/db';
import { retryPermissionBlockedSync } from '@/application/sync-outbox';

import { PendingPermissionEdits } from '../PendingPermissionEdits';

let mockPending = { blocked: 1, legacy: 0 };

jest.mock('dexie-react-hooks', () => ({ useLiveQuery: () => mockPending }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/db', () => ({ hasUnscopedCollabData: jest.fn().mockResolvedValue(false), db: {} }));
jest.mock('@/application/sync-outbox', () => ({ retryPermissionBlockedSync: jest.fn(async () => undefined) }));

test('retained changes require an explicit retry scoped to the rendered server/account/workspace', async () => {
  const beforeRetry = jest.fn();

  mockPending = { blocked: 1, legacy: 0 };
  render(<PendingPermissionEdits userId='user' workspaceId='workspace' serverUrl='https://server' beforeRetry={beforeRetry} />);
  expect(retryPermissionBlockedSync).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button')); });
  expect(beforeRetry).toHaveBeenCalledTimes(1);
  expect(retryPermissionBlockedSync).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace', serverUrl: 'https://server' });
});

test('ambiguous legacy bytes are explained without offering an unsafe upload', () => {
  mockPending = { blocked: 0, legacy: 1 };
  render(<PendingPermissionEdits userId='user' workspaceId='workspace' serverUrl='https://server' beforeRetry={jest.fn()} />);
  expect(screen.getByRole('status').textContent).toBe('workspacePermissions.legacyPendingEdits');
  expect(screen.queryByRole('button')).toBeNull();
});


test('retained legacy storage is visible even when no outbox row survived an older client', async () => {
  mockPending = { blocked: 0, legacy: 0 };
  jest.mocked(hasUnscopedCollabData).mockResolvedValueOnce(true);
  render(<PendingPermissionEdits userId='user' workspaceId='workspace' serverUrl='https://server' beforeRetry={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('workspacePermissions.legacyPendingEdits'));
  expect(screen.queryByRole('button')).toBeNull();
});
