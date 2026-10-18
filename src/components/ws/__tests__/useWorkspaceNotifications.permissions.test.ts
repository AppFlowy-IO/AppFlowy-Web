import EventEmitter from 'events';

import { renderHook } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import { messages, notification } from '@/proto/messages';

import { useWorkspaceNotifications } from '../sync/useWorkspaceNotifications';

jest.mock('@/application/db', () => ({ deleteCollabDB: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({ deleteOutboxByObjectId: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

const workspaceId = '1053b770-ef6d-4e8f-8485-a795a359d13c';
const scope = { workspaceId, userId: 'user', serverUrl: 'wss://example.test/ws/v2' };

function encodeHint(counter: string, epoch = '9007199254740993', id = workspaceId) {
  return messages.Message.decode(
    messages.Message.encode({
      notification: { workspacePermissionsChanged: { workspaceId: id, epoch, counter } },
    }).finish()
  ).notification;
}

describe('workspace permission revision notifications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('decodes the scoped hint, deduplicates WS/broadcast delivery, and preserves local data', () => {
    const eventEmitter = new EventEmitter();
    const changed = jest.fn();
    const refresh = jest.fn();

    eventEmitter.on(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, changed);
    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, refresh);
    renderHook(() =>
      useWorkspaceNotifications(encodeHint('9007199254740993'), encodeHint('9007199254740993'), eventEmitter, scope)
    );
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({
      workspaceId,
      revision: { epoch: '9007199254740993', counter: '9007199254740993' },
    });
    expect(refresh).toHaveBeenCalledWith({});
    expect(deleteCollabDB).not.toHaveBeenCalled();
    expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
  });

  it('ignores reordered revisions without losing adjacent i64 values or a new epoch', () => {
    const eventEmitter = new EventEmitter();
    const changed = jest.fn();

    eventEmitter.on(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, changed);
    const { rerender } = renderHook(({ hint }) => useWorkspaceNotifications(hint, null, eventEmitter, scope), {
      initialProps: { hint: encodeHint('9007199254740992') },
    });

    rerender({ hint: encodeHint('9007199254740993') });
    rerender({ hint: encodeHint('9007199254740992') });
    rerender({ hint: encodeHint('0', '9007199254740994') });
    rerender({ hint: encodeHint('9223372036854775807', '9007199254740993') });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it.each([
    encodeHint('1', '1', 'another-workspace'),
    encodeHint('-1'),
    encodeHint(''),
    encodeHint('9223372036854775808'),
    { workspacePermissionsChanged: { workspaceId, counter: '1' } },
  ])('ignores malformed or foreign workspace hints: %p', (hint) => {
    const eventEmitter = new EventEmitter();
    const changed = jest.fn();

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, changed);
    renderHook(() => useWorkspaceNotifications(hint, null, eventEmitter, scope));
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['serverUrl', 'userId', 'workspaceId'] as const)('fences retained messages on a %s switch', (key) => {
    const eventEmitter = new EventEmitter();
    const changed = jest.fn();
    const oldHint = encodeHint('20');
    const newScope = { ...scope, [key]: 'new-scope' };

    eventEmitter.on(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, changed);
    const { rerender } = renderHook(
      ({ hint, context }) => useWorkspaceNotifications(hint, null, eventEmitter, context),
      {
        initialProps: { hint: oldHint, context: scope },
      }
    );

    rerender({ hint: oldHint, context: newScope });
    expect(changed).toHaveBeenCalledTimes(1);
    rerender({ hint: encodeHint('1', '1', newScope.workspaceId), context: newScope });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('requires an identified session before accepting broad hints', () => {
    const eventEmitter = new EventEmitter();
    const changed = jest.fn();

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, changed);
    renderHook(() => useWorkspaceNotifications(encodeHint('1'), null, eventEmitter));
    renderHook(() => useWorkspaceNotifications(encodeHint('1'), null, eventEmitter, { ...scope, userId: undefined }));
    expect(changed).not.toHaveBeenCalled();
  });

  it('dispatches a hint received before the current user resolves once the session is identified', () => {
    const eventEmitter = new EventEmitter();
    const changed = jest.fn();
    const hint = encodeHint('7');
    const unidentified = { ...scope, userId: undefined };

    eventEmitter.on(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, changed);
    const { rerender } = renderHook(
      ({ context }) => useWorkspaceNotifications(hint, null, eventEmitter, context),
      { initialProps: { context: unidentified as typeof scope } }
    );

    expect(changed).not.toHaveBeenCalled();
    rerender({ context: scope });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({ workspaceId, revision: { epoch: '9007199254740993', counter: '7' } });
  });

  it('still fences a processed message retained across an unidentified gap between sessions', () => {
    const eventEmitter = new EventEmitter();
    const changed = jest.fn();
    const hint = encodeHint('8');

    eventEmitter.on(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, changed);
    const { rerender } = renderHook(
      ({ context }) => useWorkspaceNotifications(hint, null, eventEmitter, context),
      { initialProps: { context: scope } }
    );

    rerender({ context: { ...scope, userId: undefined } as unknown as typeof scope });
    rerender({ context: { ...scope, userId: 'next-user' } });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('continues to dispatch legacy object notifications alongside the new wire variant', () => {
    const eventEmitter = new EventEmitter();
    const changed = jest.fn();
    const legacy: notification.IWorkspaceNotification = { permissionChanged: { objectId: 'page', reason: 0 } };

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, changed);
    renderHook(() => useWorkspaceNotifications(legacy, encodeHint('1'), eventEmitter, scope));
    expect(changed).toHaveBeenCalledWith(legacy.permissionChanged);
    expect(changed).toHaveBeenCalledWith({});
    expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
  });
});
