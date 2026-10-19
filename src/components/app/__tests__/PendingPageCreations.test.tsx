import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';

import {
  captureAtomicCreationOwner,
  discardPageCreationsFromEarlierLoads,
  isFromEarlierPageLoad,
  listPendingAtomicCreationsForCurrentUser,
} from '@/application/atomic-creation';
import { recoverDefaultPage } from '@/application/services/js-services/http/page-default-creation';

import { PendingPageCreations } from '../PendingPageCreations';

import type { ButtonHTMLAttributes } from 'react';

const mockEnsureVisible = jest.fn();
const mockToView = jest.fn();
const record = { id: 'saved-command', kind: 'document', requestId: 'request-id', logicalTarget: 'page-id' };

jest.mock('dexie-react-hooks', () => ({ useLiveQuery: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} />,
}));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceIdOptional: () => 'workspace',
  useEnsureViewVisibleInOutline: () => mockEnsureVisible,
  useAppOperations: () => ({ toView: mockToView }),
}));
jest.mock('@/application/atomic-creation', () => ({
  AtomicCreationPendingError: class AtomicCreationPendingError extends Error {},
  captureAtomicCreationOwner: jest.fn(),
  discardPageCreationsFromEarlierLoads: jest.fn(),
  isFromEarlierPageLoad: jest.fn(),
  listPendingAtomicCreationsForCurrentUser: jest.fn(),
  getAtomicCreationActivityRevision: () => 0,
  subscribeAtomicCreationActivity: () => () => undefined,
  isAtomicCreationInFlight: () => false,
}));
jest.mock('@/application/services/js-services/http/page-default-creation', () => ({ recoverDefaultPage: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLiveQuery).mockReturnValue([record]);
  jest.mocked(discardPageCreationsFromEarlierLoads).mockResolvedValue();
  jest.mocked(isFromEarlierPageLoad).mockReturnValue(false);
  jest.mocked(captureAtomicCreationOwner).mockImplementation((_workspace, check) => ({
    workspaceId: 'workspace',
    serverUrl: 'server',
    userId: 'user',
    assertCurrent: () => check?.(),
  }));
  jest.mocked(recoverDefaultPage).mockImplementation(async (_owner, _record, activation) => {
    const page = { view_id: 'page-id' };

    await activation?.activate?.(page);
    return page;
  });
  mockEnsureVisible.mockResolvedValue(['space', 'page-id']);
});

it('discovers saved commands before the sync owner starts, without trying to submit them', async () => {
  jest.mocked(listPendingAtomicCreationsForCurrentUser).mockResolvedValue([record as never]);
  render(<PendingPageCreations />);
  const query = jest.mocked(useLiveQuery).mock.calls[0][0];

  await expect(query()).resolves.toEqual([record]);
  expect(listPendingAtomicCreationsForCurrentUser).toHaveBeenCalledWith('workspace');
  expect(captureAtomicCreationOwner).not.toHaveBeenCalled();
  expect(recoverDefaultPage).not.toHaveBeenCalled();
});

it('discards and hides page creations left by an earlier page load', async () => {
  const earlier = { ...record, id: 'earlier-command', requestId: 'earlier-request' };

  jest.mocked(isFromEarlierPageLoad).mockImplementation((saved) => saved === earlier);
  jest.mocked(listPendingAtomicCreationsForCurrentUser).mockResolvedValue([earlier, record] as never);
  render(<PendingPageCreations />);
  const query = jest.mocked(useLiveQuery).mock.calls[0][0];

  await expect(query()).resolves.toEqual([record]);
  expect(discardPageCreationsFromEarlierLoads).toHaveBeenCalledWith('workspace');
});

it('finishes the saved command and waits for current navigation before selection', async () => {
  let release!: (ids: string[]) => void;

  mockEnsureVisible.mockReturnValue(
    new Promise<string[]>((resolve) => {
      release = resolve;
    })
  );
  render(<PendingPageCreations />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(mockEnsureVisible).toHaveBeenCalledWith('page-id'));
  expect(mockToView).not.toHaveBeenCalled();
  expect(screen.getByRole('button').disabled).toBe(true);
  await act(async () => release(['space', 'page-id']));
  await waitFor(() => expect(mockToView).toHaveBeenCalledWith('page-id'));
  expect(jest.mocked(recoverDefaultPage).mock.calls[0][1]).toBe(record);
});

it('refuses selection when current navigation cannot prove the page exists', async () => {
  mockEnsureVisible.mockResolvedValue([]);
  render(<PendingPageCreations />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(mockToView).not.toHaveBeenCalled();
});

it('handles admission failure without losing the retry UI', async () => {
  jest.mocked(captureAtomicCreationOwner).mockImplementation(() => {
    throw new Error('offline');
  });
  render(<PendingPageCreations />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByRole('button').disabled).toBe(false);
  expect(recoverDefaultPage).not.toHaveBeenCalled();
});

it('does not select or toast into a replacement workspace after unmount', async () => {
  let release!: (ids: string[]) => void;

  mockEnsureVisible.mockReturnValue(
    new Promise<string[]>((resolve) => {
      release = resolve;
    })
  );
  const ui = render(<PendingPageCreations />);

  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(mockEnsureVisible).toHaveBeenCalled());
  ui.unmount();
  await act(async () => release(['space', 'page-id']));
  expect(mockToView).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});
