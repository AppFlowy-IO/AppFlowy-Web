import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { prefetchDatabaseBlobDiff } from '@/application/database-blob';
import type { DatabaseContextState, NavigateToRowOptions } from '@/application/database-yjs';
import { OPEN_PAGES_IN_KEY } from '@/application/database-yjs/open-pages-in';
import { getCachedRowDoc } from '@/application/services/js-services/cache';
import { DatabaseViewLayout, UIVariant, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import Database, { Database2Props } from '@/components/database/Database';

let mockDatabaseContext: DatabaseContextState | undefined;
let mockRowDetailContext: DatabaseContextState | undefined;

jest.mock('@/application/database-blob', () => ({
  getDatabaseRowDocFromSeed: jest.fn(),
  peekDatabaseRowDocSeed: jest.fn(),
  prefetchDatabaseBlobDiff: jest.fn(),
  releaseDatabaseRowDocSeedCache: jest.fn(),
  retainDatabaseRowDocSeedCache: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  getCachedRowDoc: jest.fn(),
  openRowDoc: jest.fn(),
}));

jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: () => null,
}));

jest.mock('@/components/database/DatabaseRowModal', () => {
  const { useDatabaseContext } = jest.requireActual<typeof import('@/application/database-yjs/context')>(
    '@/application/database-yjs/context'
  );

  return ({ rowId }: { rowId: string }) => {
    mockRowDetailContext = useDatabaseContext();
    return <div data-row-id={rowId} data-testid='center-peek' />;
  };
});

jest.mock('@/components/database/components/database-row/DatabaseRowSidePeek', () => ({
  DatabaseRowSidePeek: ({ rowId, onSwitchToCenter }: { rowId: string; onSwitchToCenter?: () => void }) => (
    <button data-row-id={rowId} data-testid='side-peek' onClick={onSwitchToCenter} type='button' />
  ),
}));

jest.mock('@/components/database/DatabaseContext', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { DatabaseContext } = jest.requireActual<typeof import('@/application/database-yjs/context')>(
    '@/application/database-yjs/context'
  );

  return {
    DatabaseContextProvider: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: React.ContextType<typeof DatabaseContext>;
    }) => React.createElement(DatabaseContext.Provider, { value }, children),
  };
});

jest.mock('@/components/database/DatabaseViews', () => {
  const { useDatabaseContext } = jest.requireActual<typeof import('@/application/database-yjs/context')>(
    '@/application/database-yjs/context'
  );

  return function MockDatabaseViews() {
    mockDatabaseContext = useDatabaseContext();
    return null;
  };
});

const VIEW_ID = 'view';

function createDoc(openPagesIn?: string, layout = DatabaseViewLayout.Grid) {
  const doc = new Y.Doc({ guid: 'database' }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();

  view.set(YjsDatabaseKey.layout, layout);
  view.set(YjsDatabaseKey.row_orders, new Y.Array());
  if (openPagesIn !== undefined) view.set(OPEN_PAGES_IN_KEY, openPagesIn);
  views.set(VIEW_ID, view);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return doc;
}

function renderDatabase(props: Partial<Database2Props> & { openPagesIn?: string; layout?: DatabaseViewLayout } = {}) {
  const { openPagesIn, layout, ...rest } = props;
  const onOpenRowPage = jest.fn();
  const navigateToView = jest.fn().mockResolvedValue(undefined);

  render(
    <Database
      activeViewId={VIEW_ID}
      createRow={jest.fn()}
      databaseName=''
      databasePageId={VIEW_ID}
      doc={createDoc(openPagesIn, layout)}
      navigateToView={navigateToView}
      onChangeView={jest.fn()}
      onOpenRowPage={onOpenRowPage}
      readOnly={false}
      workspaceId='workspace'
      {...rest}
    />
  );
  return { onOpenRowPage, navigateToView };
}

async function openRow(rowId: string, options?: NavigateToRowOptions, viewId?: string) {
  await waitFor(() => expect(mockDatabaseContext?.navigateToRow).toBeDefined());
  await act(async () => {
    // `handleOpenRow` is async behind the context's void signature.
    await Promise.resolve(mockDatabaseContext?.navigateToRow?.(rowId, viewId, options));
  });
}

describe('Database record openers (open_pages_in, WP13 §3.8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabaseContext = undefined;
    mockRowDetailContext = undefined;
    window.innerWidth = 1440;
    (getCachedRowDoc as jest.Mock).mockReturnValue(undefined);
    (prefetchDatabaseBlobDiff as jest.Mock).mockImplementation(() => new Promise(() => undefined));
  });

  it('opens a dashboard widget record in a side peek when nothing is stored', async () => {
    renderDatabase({ isDashboardWidget: true, isDocumentBlock: true });
    await openRow('r1');
    expect(screen.getByTestId('side-peek').getAttribute('data-row-id')).toBe('r1');
    expect(screen.queryByTestId('center-peek')).toBeNull();
  });

  it('opens a widget record in the centre peek when the view says center_peek', async () => {
    renderDatabase({ isDashboardWidget: true, isDocumentBlock: true, openPagesIn: 'center_peek' });
    await openRow('r1');
    expect(screen.getByTestId('center-peek')).toBeTruthy();
    expect(screen.queryByTestId('side-peek')).toBeNull();
  });

  it('opens a widget record as a full page when the view says full_page', async () => {
    const { onOpenRowPage } = renderDatabase({
      isDashboardWidget: true,
      isDocumentBlock: true,
      openPagesIn: 'full_page',
    });

    await openRow('r1');
    expect(onOpenRowPage).toHaveBeenCalledWith('r1');
    expect(screen.queryByTestId('side-peek')).toBeNull();
    expect(screen.queryByTestId('center-peek')).toBeNull();
  });

  it('keeps the centre modal for a standalone view with nothing stored', async () => {
    renderDatabase();
    await openRow('r1');
    expect(screen.getByTestId('center-peek')).toBeTruthy();
  });

  it('reads an unknown stored value as absent', async () => {
    renderDatabase({ isDashboardWidget: true, isDocumentBlock: true, openPagesIn: 'bogus' });
    await openRow('r1');
    expect(screen.getByTestId('side-peek')).toBeTruthy();
  });

  it('opens a drill-down record of a standalone chart in a side peek', async () => {
    renderDatabase({ layout: DatabaseViewLayout.Chart });
    await openRow('r1', { source: 'drilldown' });
    expect(screen.getByTestId('side-peek')).toBeTruthy();
  });

  it('switches the side peek to the centre peek for the same record', async () => {
    renderDatabase({ isDashboardWidget: true, isDocumentBlock: true });
    await openRow('r2');
    fireEvent.click(screen.getByTestId('side-peek'));
    expect(screen.getByTestId('center-peek').getAttribute('data-row-id')).toBe('r2');
  });

  it('keeps the published row-page navigation', async () => {
    const { onOpenRowPage } = renderDatabase({
      readOnly: true,
      variant: UIVariant.Publish,
      isDashboardWidget: true,
      isDocumentBlock: true,
      openPagesIn: 'center_peek',
    });

    await openRow('r1', { source: 'drilldown' });
    expect(onOpenRowPage).toHaveBeenCalledWith('r1');
    expect(screen.queryByTestId('side-peek')).toBeNull();
    expect(screen.queryByTestId('center-peek')).toBeNull();
  });

  it('opens records full screen in a mobile context', async () => {
    window.innerWidth = 390;
    const { onOpenRowPage } = renderDatabase({ isDashboardWidget: true, isDocumentBlock: true });

    await openRow('r1');
    expect(onOpenRowPage).toHaveBeenCalledWith('r1');
    expect(screen.queryByTestId('side-peek')).toBeNull();
  });

  it.each([
    ['desktop full_page', 1440, 'full_page', undefined],
    ['mobile', 390, undefined, undefined],
    ['mobile full_page', 390, 'full_page', undefined],
    ['desktop full_page with a view id', 1440, 'full_page', 'linked-view'],
    ['mobile with a view id', 390, undefined, 'linked-view'],
    ['mobile full_page with a view id', 390, 'full_page', 'linked-view'],
  ] as const)('keeps a locked embed row local on %s', async (_label, width, openPagesIn, viewId) => {
    window.innerWidth = width;
    const sourceDoc = createDoc();
    const rowDoc = new Y.Doc({ guid: 'r1' }) as YDoc;
    const loadView = jest.fn().mockResolvedValue(sourceDoc);
    const { onOpenRowPage, navigateToView } = renderDatabase({
      readOnly: true,
      variant: UIVariant.App,
      isDocumentBlock: true,
      openPagesIn,
      loadView,
      createRow: jest.fn().mockResolvedValue(rowDoc),
    });

    await openRow('r1', undefined, viewId);

    expect(screen.getByTestId('center-peek').getAttribute('data-row-id')).toBe('r1');
    expect(mockRowDetailContext?.readOnly).toBe(true);
    expect(onOpenRowPage).not.toHaveBeenCalled();
    expect(navigateToView).not.toHaveBeenCalled();
    if (viewId) {
      expect(loadView).toHaveBeenCalledWith(viewId);
      expect(mockRowDetailContext?.databaseDoc).toBe(sourceDoc);
      expect(mockRowDetailContext?.activeViewId).toBe(viewId);
    }
  });

  it('does not navigate a locked embed to a source view when its document cannot be loaded', async () => {
    const { onOpenRowPage, navigateToView } = renderDatabase({
      readOnly: true,
      variant: UIVariant.App,
      isDocumentBlock: true,
      openPagesIn: 'full_page',
      loadView: jest.fn().mockResolvedValue(undefined),
    });

    await openRow('r1', undefined, 'linked-view');

    expect(onOpenRowPage).not.toHaveBeenCalled();
    expect(navigateToView).not.toHaveBeenCalled();
  });

  it.each([
    ['published', true, UIVariant.Publish, 1440],
    ['writable full_page', false, UIVariant.App, 1440],
    ['writable mobile', false, UIVariant.App, 390],
  ] as const)('preserves explicit-view page navigation for a %s database', async (_label, readOnly, variant, width) => {
    window.innerWidth = width;
    const { onOpenRowPage, navigateToView } = renderDatabase({
      readOnly,
      variant,
      isDocumentBlock: true,
      openPagesIn: 'full_page',
    });

    await openRow('r1', undefined, 'linked-view');

    expect(navigateToView).toHaveBeenCalledWith('linked-view', 'r1');
    expect(onOpenRowPage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('center-peek')).toBeNull();
    expect(screen.queryByTestId('side-peek')).toBeNull();
  });
});
