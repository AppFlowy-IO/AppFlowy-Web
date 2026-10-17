import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { RowService } from '@/application/services/domains';
import { UIVariant, View, ViewLayout, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';

import BreadcrumbItem from '../BreadcrumbItem';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'Untitled' }),
}));
jest.mock('@/application/services/domains', () => ({ RowService: { create: jest.fn() } }));
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => null);
jest.mock('@/components/_shared/view-icon/PublishIcon', () => () => null);
jest.mock('@/components/_shared/view-icon/SpaceIcon', () => () => null);
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));

function fixture(name = 'Stale view title') {
  const databaseDoc = new Y.Doc();
  const rowDoc = new Y.Doc();
  const primaryField = new Y.Map();

  primaryField.set(YjsDatabaseKey.id, 'title');
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  primaryField.set(YjsDatabaseKey.is_primary, true);
  const fields = new Y.Map([['title', primaryField]]);
  const database = new Y.Map([[YjsDatabaseKey.fields, fields]]);

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const cell = new Y.Map<unknown>([
    [YjsDatabaseKey.data, 'Actual row title'],
    [YjsDatabaseKey.field_type, FieldType.RichText],
  ]);
  const cells = new Y.Map([['title', cell]]);

  rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, new Y.Map([[YjsDatabaseKey.cells, cells]]));
  const loadView = jest.fn().mockResolvedValue(databaseDoc);
  const registerSyncContext = jest.fn().mockReturnValue({ doc: rowDoc });
  const scheduleDeferredCleanup = jest.fn();

  (RowService.create as jest.Mock).mockResolvedValue(rowDoc);
  const crumb: View = {
    view_id: 'row-document',
    parent_view_id: 'row-document',
    name,
    layout: ViewLayout.Document,
    extra: { row_document: { source: { database_id: 'database', database_view_id: 'database-view', row_id: 'row' } } },
    icon: null,
    children: [],
    is_published: false,
    is_private: false,
  };
  const operations = { loadView } as unknown as AppOperationsContextType;
  const sync = { registerSyncContext, scheduleDeferredCleanup } as unknown as SyncInternalContextType;
  const tree = (view = crumb, variant = UIVariant.App) => (
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AppOperationsContext.Provider value={operations}>
        <SyncInternalContext.Provider value={sync}>
          <BreadcrumbItem crumb={view} variant={variant} />
        </SyncInternalContext.Provider>
      </AppOperationsContext.Provider>
    </MemoryRouter>
  );

  return { tree, cell, crumb, databaseDoc, rowDoc, loadView, registerSyncContext, scheduleDeferredCleanup };
}

describe('row ancestor breadcrumb', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['', 'Stale view title'])('reads and observes the primary cell when the view name is "%s"', async (name) => {
    const f = fixture(name);
    const { unmount, rerender } = render(f.tree());

    await waitFor(() => expect(screen.getByText('Actual row title')).toBeTruthy());
    expect(screen.queryByText('Stale view title')).toBeNull();
    expect(f.loadView).toHaveBeenCalledWith('database-view', false, false, {
      databaseId: 'database', databaseMetadataOnly: true,
    });
    expect(RowService.create).toHaveBeenCalledWith('database_rows_row');

    await act(async () => { f.cell.set(YjsDatabaseKey.data, 'Renamed row'); });
    expect(screen.getByText('Renamed row')).toBeTruthy();
    rerender(f.tree({ ...f.crumb, name: 'Another stale view title' }));
    expect(screen.getByText('Renamed row')).toBeTruthy();
    expect(f.registerSyncContext).toHaveBeenCalledTimes(1);

    await act(async () => { f.cell.set(YjsDatabaseKey.data, ''); });
    expect(screen.getByText('Untitled')).toBeTruthy();
    unmount();
    expect(f.scheduleDeferredCleanup).toHaveBeenCalledWith('row');
    f.databaseDoc.destroy();
    f.rowDoc.destroy();
  });

  it('keeps ordinary page titles on the view metadata path', () => {
    const f = fixture();
    const { unmount } = render(f.tree({ ...f.crumb, name: 'Child page', extra: null }));

    expect(screen.getByText('Child page')).toBeTruthy();
    expect(f.loadView).not.toHaveBeenCalled();
    expect(RowService.create).not.toHaveBeenCalled();
    unmount();
    f.databaseDoc.destroy();
    f.rowDoc.destroy();
  });

  it('uses the view implementation for published breadcrumb metadata', () => {
    const f = fixture('Published row title');
    const { unmount } = render(f.tree(f.crumb, UIVariant.Publish));

    expect(screen.getByText('Published row title')).toBeTruthy();
    expect(f.loadView).not.toHaveBeenCalled();
    expect(RowService.create).not.toHaveBeenCalled();
    unmount();
    f.databaseDoc.destroy();
    f.rowDoc.destroy();
  });

  it('observes the canonical row when a cold row hydrates after opening the subpage', async () => {
    const f = fixture();
    const coldRow = new Y.Doc();

    f.registerSyncContext.mockReturnValue({ doc: coldRow });
    const { unmount } = render(f.tree());

    await waitFor(() => expect(f.registerSyncContext).toHaveBeenCalledTimes(1));

    await act(async () => { Y.applyUpdate(coldRow, Y.encodeStateAsUpdate(f.rowDoc)); });
    expect(screen.getByText('Actual row title')).toBeTruthy();
    unmount();
    expect(f.scheduleDeferredCleanup).toHaveBeenCalledWith('row');
    coldRow.destroy();
    f.databaseDoc.destroy();
    f.rowDoc.destroy();
  });

  it('does not attach row synchronization after the breadcrumb is unmounted', async () => {
    const f = fixture();
    let resolveDatabase: (doc: Y.Doc) => void = () => undefined;

    f.loadView.mockReturnValue(new Promise<Y.Doc>((resolve) => { resolveDatabase = resolve; }));
    const { unmount } = render(f.tree());

    unmount();
    await act(async () => { resolveDatabase(f.databaseDoc); });
    expect(f.registerSyncContext).not.toHaveBeenCalled();
    expect(f.scheduleDeferredCleanup).not.toHaveBeenCalled();
    f.databaseDoc.destroy();
    f.rowDoc.destroy();
  });
});
