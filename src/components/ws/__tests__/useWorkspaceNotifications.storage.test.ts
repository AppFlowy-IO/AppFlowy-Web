import EventEmitter from 'events';

import { renderHook } from '@testing-library/react';
import { toast } from 'sonner';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import { messages } from '@/proto/messages';
import { getBillingErrorMessage } from '@/utils/billing-error';

import { useWorkspaceNotifications } from '../sync/useWorkspaceNotifications';

const mockPendingEdits = new Map<string, Uint8Array>();

jest.mock('@/application/db', () => ({ deleteCollabDB: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn((objectId: string) => mockPendingEdits.delete(objectId)),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/billing-error', () => ({ getBillingErrorMessage: jest.fn() }));

describe('realtime storage refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingEdits.clear();
    // Hosting policy is covered by the billing formatter's tests. Exercise both
    // formatter outcomes here without assuming this notification's deployment.
    jest.mocked(getBillingErrorMessage).mockReturnValue('Upgrade this workspace to Pro for unlimited storage.');
  });

  it('decodes the server notification, shows Pro guidance, and retains unacknowledged edits and access', () => {
    const objectId = '110a7f23-f5fa-4d4b-abce-bf24872d859e';
    const pending = new Uint8Array([1, 2, 3]);
    mockPendingEdits.set(objectId, pending);
    const eventEmitter = new EventEmitter();
    const permissionChanged = jest.fn();
    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, permissionChanged);
    const decoded = messages.Message.decode(messages.Message.encode({
      notification: {
        storageLimitExceeded: { objectId, code: ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED, message: 'Storage is full' },
      },
    }).finish());

    const { unmount } = renderHook(() => useWorkspaceNotifications(decoded.notification, null, eventEmitter));

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('workspace to Pro'), {
      id: 'workspace-storage-limit-exceeded',
    });
    expect(getBillingErrorMessage).toHaveBeenCalledWith(decoded.notification?.storageLimitExceeded);
    expect(decoded.collabMessage).toBeNull();
    expect(mockPendingEdits.get(objectId)).toBe(pending);
    expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
    expect(deleteCollabDB).not.toHaveBeenCalled();
    expect(permissionChanged).not.toHaveBeenCalled();
    unmount();
  });

  it('uses one toast identity for websocket retries and sibling-tab notifications', () => {
    const notification = {
      storageLimitExceeded: {
        objectId: 'object', code: ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED,
        message: 'Upgrade this workspace to Pro for unlimited storage.',
      },
    };
    const { unmount } = renderHook(() => useWorkspaceNotifications(notification, notification, new EventEmitter()));
    expect(toast.error).toHaveBeenCalledTimes(2);
    for (const [, options] of (toast.error as jest.Mock).mock.calls) {
      expect(options.id).toBe('workspace-storage-limit-exceeded');
    }
    unmount();
  });

  it('preserves the server storage-limit message when cloud upgrade guidance is unavailable', () => {
    const message = 'Workspace storage is full. Contact your administrator.';

    jest.mocked(getBillingErrorMessage).mockReturnValue(undefined);
    const { unmount } = renderHook(() => useWorkspaceNotifications({
      storageLimitExceeded: { objectId: 'object', code: ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED, message },
    }, null, new EventEmitter()));

    expect(toast.error).toHaveBeenCalledWith(message, { id: 'workspace-storage-limit-exceeded' });
    expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
    expect(deleteCollabDB).not.toHaveBeenCalled();
    unmount();
  });

  it('does not reinterpret a different quota code as a Pro storage upgrade', () => {
    const { unmount } = renderHook(() => useWorkspaceNotifications({
      storageLimitExceeded: { objectId: 'object', code: ERROR_CODE.PAID_PLAN_GUEST_LIMIT_EXCEEDED },
    }, null, new EventEmitter()));
    expect(toast.error).not.toHaveBeenCalled();
    unmount();
  });

  it('retains the existing deletion handling for actual permission notifications', () => {
    mockPendingEdits.set('deleted-object', new Uint8Array([4]));
    const { unmount } = renderHook(() => useWorkspaceNotifications({
      permissionChanged: { objectId: 'deleted-object', reason: 1 },
    }, null, new EventEmitter()));
    expect(deleteOutboxByObjectId).toHaveBeenCalledWith('deleted-object');
    expect(mockPendingEdits.has('deleted-object')).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
    unmount();
  });
});
