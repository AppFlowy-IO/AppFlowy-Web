import EventEmitter from 'events';

import { Dialog as MuiDialog } from '@mui/material';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import translations from '@/@types/translations/en.json';
import { APP_EVENTS } from '@/application/constants';
import { Types, YDocWithMeta } from '@/application/types';
import { DatabaseRestoreNoticeProvider, useDatabaseRestoreNotice } from '@/components/app/DatabaseRestoreNotice';
import { RevertedDialog } from '@/components/app/RevertedDialog';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContextOptional: () => ({
    workspaceId: 'workspace',
    databaseDoc: { guid: 'related-database' },
  }),
  useReadOnly: () => false,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: () => jest.fn(),
  useTrashAwareDeleteRowsDispatch: () => jest.fn(),
}));

jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: () => <input aria-label='Row name' defaultValue='Editing a related row' />,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      translations.versionHistory[key.split('.')[1] as keyof typeof translations.versionHistory] || key,
  }),
}));

function OpenDatabaseAndRelatedRow() {
  useDatabaseRestoreNotice('workspace', 'page-database');

  return <DatabaseRowModal onOpenChange={jest.fn()} open rowId='related-row' />;
}

function DatabasePageModal() {
  useDatabaseRestoreNotice('workspace', 'page-database');

  // Page, history, and template editors already use MUI's default focus trap.
  // The shared restore notice must cooperate without modifying each surface.
  return (
    <MuiDialog open>
      <input aria-label='Database page name' />
    </MuiDialog>
  );
}

describe('DatabaseRowModal restore notification', () => {
  it('preserves the existing document notice copy and acknowledgement by default', () => {
    const onDismiss = jest.fn();

    render(<RevertedDialog open onDismiss={onDismiss} />);

    const dialog = screen.getByRole('dialog', { name: 'Page Restored' });
    const confirm = screen.getByRole('button', { name: 'Got it' });

    expect(dialog.textContent).toContain('This page was restored to a previous version from another device.');
    expect(screen.queryByRole('heading', { name: 'Database restored' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(confirm.className).toContain('bg-fill-theme-thick');
    fireEvent.click(confirm);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('takes focus above an existing MUI page dialog without competing focus traps', async () => {
    const eventEmitter = new EventEmitter();

    render(
      <DatabaseRestoreNoticeProvider workspaceId='workspace' eventEmitter={eventEmitter}>
        <DatabasePageModal />
      </DatabaseRestoreNoticeProvider>
    );

    const pageInput = screen.getByRole('textbox', { name: 'Database page name' });

    act(() => pageInput.focus());
    expect(document.activeElement).toBe(pageInput);

    const restored = {
      workspaceId: 'workspace',
      databaseId: 'page-database',
      restoreId: 'restore-1',
    };

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.DATABASE_RESTORED, restored);
    });

    const confirm = await screen.findByRole('button', { name: 'Got it' });

    expect(screen.getByRole('dialog', { name: 'Database restored' }).textContent).toContain(
      'This database was restored to a previous version. You can continue editing the restored version.'
    );

    await waitFor(() => expect(document.activeElement).toBe(confirm));
    act(() => pageInput.focus());
    await waitFor(() => expect(document.activeElement).not.toBe(pageInput));
    act(() => confirm.focus());
    expect(document.activeElement).toBe(confirm);
    await act(async () => {
      eventEmitter.emit(APP_EVENTS.DATABASE_RESTORED, restored);
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByTestId('reverted-dialog')).toBeNull());
    await act(async () => {
      eventEmitter.emit(APP_EVENTS.DATABASE_RESTORED, restored);
    });
    expect(screen.queryByTestId('reverted-dialog')).toBeNull();
  });

  it('notifies once for the related database and lets the restore dialog take keyboard focus', async () => {
    const eventEmitter = new EventEmitter();

    render(
      <DatabaseRestoreNoticeProvider workspaceId='workspace' eventEmitter={eventEmitter}>
        <OpenDatabaseAndRelatedRow />
      </DatabaseRestoreNoticeProvider>
    );

    const rowInput = screen.getByRole('textbox', { name: 'Row name' });

    act(() => rowInput.focus());
    expect(document.activeElement).toBe(rowInput);

    const restored = {
      workspaceId: 'workspace',
      databaseId: 'related-database',
      restoreId: 'restore-1',
    };

    act(() => {
      eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, {
        objectId: 'related-database',
        viewId: 'a-different-linked-view',
        doc: { _collabType: Types.Database, databaseRestoreId: restored.restoreId } as YDocWithMeta,
        isExternalRevert: true,
      });
      eventEmitter.emit(APP_EVENTS.DATABASE_RESTORED, restored);
    });

    const confirm = await screen.findByRole('button', { name: 'Got it' });

    expect(screen.getByRole('dialog', { name: 'Database restored' }).textContent).toContain(
      'This database was restored to a previous version. You can continue editing the restored version.'
    );

    expect(screen.getByRole('heading', { name: 'Database restored' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(confirm));

    // The row remains mounted beneath the notice. Its focus trap must yield to
    // the notice, including attempts to focus the background editor.
    act(() => rowInput.focus());
    await waitFor(() => expect(document.activeElement).not.toBe(rowInput));
    act(() => confirm.focus());
    expect(document.activeElement).toBe(confirm);

    act(() => {
      eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, {
        objectId: 'related-row',
        doc: { _collabType: Types.DatabaseRow, databaseRestoreId: restored.restoreId } as YDocWithMeta,
        isExternalRevert: true,
      });
      eventEmitter.emit(APP_EVENTS.DATABASE_RESTORED, restored);
    });

    expect(screen.getAllByTestId('reverted-dialog')).toHaveLength(1);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByTestId('reverted-dialog')).toBeNull());

    // A duplicate completion must not queue a second acknowledgement after the
    // first is dismissed, and the row editor must regain its normal focus.
    act(() => {
      eventEmitter.emit(APP_EVENTS.DATABASE_RESTORED, restored);
      rowInput.focus();
    });
    expect(screen.queryByTestId('reverted-dialog')).toBeNull();
    expect(document.activeElement).toBe(rowInput);
  });
});
