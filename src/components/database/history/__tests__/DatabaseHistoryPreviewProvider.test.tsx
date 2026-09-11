import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { type DatabaseContextState } from '@/application/database-yjs/context';
import { runDatabaseAction, runDatabaseRowAction } from '@/application/database-yjs/history';
import { type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { DatabaseHistoryPreview } from '@/components/database/history/DatabaseHistoryPreviewProvider';

let mockContext: DatabaseContextState;

jest.mock('@/components/database/DatabaseViews', () => ({
  __esModule: true,
  default: function PreviewViews({ activeViewId, onChangeView }: { activeViewId: string; onChangeView: (id: string) => void }) {
    const { useDatabaseContext } = jest.requireActual('@/application/database-yjs/context');

    mockContext = useDatabaseContext();
    return (
      <div>
        <span data-testid='active-view'>{activeViewId}</span>
        <button onClick={() => onChangeView('saved-board')}>Saved board</button>
        <button onClick={() => mockContext.navigateToRow?.('row-1')}>Inspect row</button>
      </div>
    );
  },
}));

jest.mock('@/components/database/components/database-row/RowPropertyCell', () => ({
  __esModule: true,
  default: ({ rowId }: { rowId: string }) => <span>{rowId} historical value</span>,
}));

jest.mock('@/utils/runtime-config', () => ({
  isDevelopmentOrTestEnvironment: () => true,
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createSnapshot() {
  const root = new Y.Doc({ guid: 'database-history-version-1' }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();
  const fields = new Y.Map();

  database.set(YjsDatabaseKey.id, 'database-1');

  for (const id of ['saved-grid', 'saved-board', 'internal-view']) {
    const view = new Y.Map();

    view.set(YjsDatabaseKey.id, id);
    view.set(YjsDatabaseKey.is_inline, id === 'internal-view');
    views.set(id, view);
  }

  const field = new Y.Map();

  field.set(YjsDatabaseKey.name, 'Historical field');
  fields.set('field-1', field);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  root.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const row = new Y.Doc({ guid: 'database-history-row-1' }) as YDoc;

  return { root, rows: { 'row-1': row } };
}

describe('DatabaseHistoryPreview isolation', () => {
  it('supplies only historical row loaders and keeps navigation inside the session', async () => {
    const snapshot = createSnapshot();
    const sentinel = { current: 'live database' };
    const testWindow = window as typeof window & { __TEST_DATABASE_CONTEXT__?: unknown };

    testWindow.__TEST_DATABASE_CONTEXT__ = sentinel;
    const rendered = render(
      <DatabaseHistoryPreview {...snapshot} workspaceId='workspace-1' databaseId='database-1' databasePageId='removed-view' activeViewId='removed-view' />
    );

    expect(screen.getByTestId('active-view').textContent).toBe('saved-grid');
    expect(mockContext.readOnly).toBe(true);
    expect(mockContext.canWrite).toBe(false);
    expect(mockContext.canComment).toBe(false);
    expect(mockContext.canShare).toBe(false);
    expect(mockContext.dataSource?.type).toBe('history');
    expect(mockContext.loadView).toBeUndefined();
    expect(mockContext.loadViewMeta).toBeUndefined();
    expect(mockContext.bindViewSync).toBeUndefined();
    expect(mockContext.createRow).toBeUndefined();
    expect(mockContext.loadRowDocument).toBeUndefined();
    expect(mockContext.eventEmitter).toBeUndefined();
    expect(await mockContext.ensureRow?.('row-1')).toBe(snapshot.rows['row-1']);
    expect(await mockContext.loadRowFromSeed?.('missing')).toBeUndefined();
    expect(mockContext.peekRowDocFromSeed?.('missing')).toBeNull();

    fireEvent.click(screen.getByText('Saved board'));
    expect(screen.getByTestId('active-view').textContent).toBe('saved-board');
    expect(testWindow.__TEST_DATABASE_CONTEXT__).toBe(sentinel);
    fireEvent.click(screen.getByText('Inspect row'));
    expect(screen.getByTestId('database-history-row-properties')).toBeTruthy();
    expect(screen.getByText('row-1 historical value')).toBeTruthy();

    rendered.unmount();
    snapshot.root.destroy();
    snapshot.rows['row-1'].destroy();
    delete testWindow.__TEST_DATABASE_CONTEXT__;
  });

  it('blocks root and row dispatch mutations even when invoked directly', () => {
    const snapshot = createSnapshot();
    const rendered = render(
      <DatabaseHistoryPreview {...snapshot} workspaceId='workspace-1' databaseId='database-1' databasePageId='saved-grid' />
    );
    const rootBefore = Y.encodeStateAsUpdate(snapshot.root);
    const rowBefore = Y.encodeStateAsUpdate(snapshot.rows['row-1']);
    const rootMutation = jest.fn(() => snapshot.root.getMap('mutations').set('changed', true));
    const rowMutation = jest.fn(() => snapshot.rows['row-1'].getMap('mutations').set('changed', true));

    act(() => {
      runDatabaseAction(snapshot.root, { type: 'database.resize-column' }, rootMutation);
      runDatabaseRowAction(snapshot.rows['row-1'], { type: 'database.edit-cell' }, rowMutation);
    });

    expect(rootMutation).not.toHaveBeenCalled();
    expect(rowMutation).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(snapshot.root)).toEqual(rootBefore);
    expect(Y.encodeStateAsUpdate(snapshot.rows['row-1'])).toEqual(rowBefore);
    rendered.unmount();
    snapshot.root.destroy();
    snapshot.rows['row-1'].destroy();
  });
});
