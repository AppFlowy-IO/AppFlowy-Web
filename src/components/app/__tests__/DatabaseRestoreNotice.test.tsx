import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import translations from '@/@types/translations/en.json';
import { APP_EVENTS } from '@/application/constants';
import { Types } from '@/application/types';

import { DatabaseRestoreNoticeProvider, useDatabaseRestoreNotice } from '../DatabaseRestoreNotice';
import { RevertedDialog } from '../RevertedDialog';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations.versionHistory[key.split('.')[1] as keyof typeof translations.versionHistory],
  }),
}));

function Editor({ databaseId, workspaceId = 'workspace' }: { databaseId: string; workspaceId?: string }) {
  useDatabaseRestoreNotice(workspaceId, databaseId);
  return <input aria-label={`Editing ${databaseId}`} />;
}

function complete(events: EventEmitter, databaseId = 'database', restoreId = 'restore-1', workspaceId = 'workspace') {
  act(() => {
    events.emit(APP_EVENTS.DATABASE_RESTORED, { workspaceId, databaseId, restoreId });
  });
}

function reset(events: EventEmitter, restoreId = 'restore-1', collabType = Types.Database) {
  act(() => {
    events.emit(APP_EVENTS.COLLAB_DOC_RESET, {
      objectId: 'database',
      // A shared root can carry the view ID of a different mounted sidebar tab.
      viewId: 'different-sidebar-view',
      doc: { databaseRestoreId: restoreId, _collabType: collabType },
      isExternalRevert: true,
    });
  });
}

function expectDatabaseRestoreNotice() {
  const dialog = screen.getByRole('dialog', { name: 'Database restored' });

  expect(screen.getAllByRole('dialog', { name: 'Database restored' })).toHaveLength(1);
  expect(dialog.textContent).toContain(
    'This database was restored to a previous version. You can continue editing the restored version.'
  );
  expect(within(dialog).getByRole('button', { name: 'Got it' })).toBeTruthy();
}

describe('database restore notice', () => {
  it('announces completed aggregate restoration once across multiple database views', async () => {
    const events = new EventEmitter();

    render(
      <DatabaseRestoreNoticeProvider workspaceId='workspace' eventEmitter={events}>
        <Editor databaseId='database' />
        <Editor databaseId='database' />
      </DatabaseRestoreNoticeProvider>
    );
    expect(events.listenerCount(APP_EVENTS.DATABASE_RESTORED)).toBe(1);
    reset(events);
    expect(screen.queryByRole('dialog')).toBeNull();
    complete(events);
    expectDatabaseRestoreNotice();
    complete(events);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    complete(events);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Restoring the same saved version again has a distinct restore generation.
    complete(events, 'database', 'restore-2');
    expectDatabaseRestoreNotice();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    complete(events, 'database', 'restore-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('retains the notice when the restored editor is replaced or removed', async () => {
    const events = new EventEmitter();
    const page = (editing: boolean) => (
      <DatabaseRestoreNoticeProvider workspaceId='workspace' eventEmitter={events}>
        {editing && <Editor databaseId='database' />}
      </DatabaseRestoreNoticeProvider>
    );
    const view = render(page(true));

    reset(events);
    view.rerender(page(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    complete(events);
    expectDatabaseRestoreNotice();
    view.rerender(page(true));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    complete(events);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ignores hydration before mounting, unopened databases, and other workspaces', () => {
    const events = new EventEmitter();
    const page = (editing: boolean) => (
      <DatabaseRestoreNoticeProvider workspaceId='workspace' eventEmitter={events}>
        {editing && <Editor databaseId='database' />}
      </DatabaseRestoreNoticeProvider>
    );
    const view = render(page(false));

    reset(events);
    complete(events);
    view.rerender(page(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    complete(events, 'unopened');
    complete(events, 'database', 'restore-1', 'other-workspace');
    complete(events, 'database', '00000000-0000-0000-0000-000000000000');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not announce initial authority hydration after an editor mounts', () => {
    const events = new EventEmitter();

    render(
      <DatabaseRestoreNoticeProvider workspaceId='workspace' eventEmitter={events}>
        <Editor databaseId='database' />
      </DatabaseRestoreNoticeProvider>
    );
    reset(events);
    act(() => {
      events.emit(APP_EVENTS.DATABASE_RESTORED, {
        workspaceId: 'workspace',
        databaseId: 'database',
        restoreId: 'restore-1',
        isInitialHydration: true,
      });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // A later restore replaces content that this session has already opened.
    complete(events, 'database', 'restore-2');
    expectDatabaseRestoreNotice();
  });

  it('does not treat row replacement as an independently restored editor', () => {
    const events = new EventEmitter();
    const page = (editing: boolean) => (
      <DatabaseRestoreNoticeProvider workspaceId='workspace' eventEmitter={events}>
        {editing && <Editor databaseId='database' />}
      </DatabaseRestoreNoticeProvider>
    );
    const view = render(page(true));

    reset(events, 'restore-1', Types.DatabaseRow);
    view.rerender(page(false));
    complete(events);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears pending notices and listeners when the workspace session changes', () => {
    const events = new EventEmitter();
    const page = (workspaceId: string) => (
      <DatabaseRestoreNoticeProvider key={workspaceId} workspaceId={workspaceId} eventEmitter={events}>
        <Editor workspaceId={workspaceId} databaseId='database' />
      </DatabaseRestoreNoticeProvider>
    );
    const view = render(page('workspace'));

    complete(events);
    expectDatabaseRestoreNotice();
    view.rerender(page('other-workspace'));
    expect(screen.queryByRole('dialog')).toBeNull();
    complete(events);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(events.listenerCount(APP_EVENTS.DATABASE_RESTORED)).toBe(1);
    view.unmount();
    expect(events.listenerCount(APP_EVENTS.DATABASE_RESTORED)).toBe(0);
    expect(events.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(0);
  });

  it('preserves the existing document restore message', () => {
    const dismiss = jest.fn();

    render(<RevertedDialog open onDismiss={dismiss} />);
    expect(screen.getByRole('dialog').textContent).toContain('Page Restored');
    expect(screen.getByRole('dialog').textContent).toContain(
      'This page was restored to a previous version from another device.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
