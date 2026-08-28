import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, useDatabaseHistoryManager } from '@/application/database-yjs';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import DatabaseViews from '@/components/database/DatabaseViews';

import type { ReactNode } from 'react';

jest.mock('@/application/database-yjs', () => {
  const actual = jest.requireActual<typeof import('@/application/database-yjs')>('@/application/database-yjs');

  return {
    ...actual,
    useDatabaseHistoryManager: jest.fn(),
  };
});

jest.mock('@/components/database/board', () => ({
  Board: () => <button data-testid='board-layout'>Board</button>,
}));

jest.mock('@/components/database/chart', () => ({
  Chart: () => <button data-testid='chart-layout'>Chart</button>,
}));

jest.mock('@/components/database/components/conditions/DatabaseSearchContext', () => ({
  DatabaseSearchProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/tabs', () => ({
  DatabaseTabs: () => <button data-testid='database-tabs'>Database tabs</button>,
}));

jest.mock('@/components/database/fullcalendar', () => ({
  Calendar: () => <button data-testid='calendar-layout'>Calendar</button>,
}));

jest.mock('@/components/database/gallery', () => ({
  __esModule: true,
  default: () => <button data-testid='gallery-layout'>Gallery</button>,
}));

jest.mock('@/components/database/grid', () => ({
  Grid: () => <button data-testid='grid-layout'>Grid</button>,
}));

jest.mock('@/components/database/grid/GridGroupingContext', () => ({
  GridGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/list/List', () => ({
  __esModule: true,
  default: () => <button data-testid='list-layout'>List</button>,
}));

jest.mock('@/components/database/list/ListGroupingContext', () => ({
  ListGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('src/components/database/components/conditions/DatabaseConditions', () => () => (
  <button data-testid='database-conditions'>Database conditions</button>
));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const mockUseDatabaseHistoryManager = jest.mocked(useDatabaseHistoryManager);
const undo = jest.fn();
const redo = jest.fn();

function createDatabaseDoc(layout: DatabaseViewLayout): YDoc {
  const doc = new Y.Doc({ guid: 'database-id' }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();

  view.set(YjsDatabaseKey.id, 'view-id');
  view.set(YjsDatabaseKey.name, 'View');
  view.set(YjsDatabaseKey.layout, layout);
  view.set(YjsDatabaseKey.created_at, '100');
  view.set(YjsDatabaseKey.is_inline, false);
  view.set(YjsDatabaseKey.embedded, false);
  views.set('view-id', view);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function renderDatabaseViews(layout: DatabaseViewLayout) {
  const databaseDoc = createDatabaseDoc(layout);
  const contextValue: DatabaseContextState = {
    activeViewId: 'view-id',
    databaseDoc,
    databasePageId: 'view-id',
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
  };
  const rendered = render(
    <>
      <DatabaseContext.Provider value={contextValue}>
        <DatabaseViews
          activeViewId='view-id'
          databasePageId='view-id'
          onChangeView={jest.fn()}
          visibleViewIds={['view-id']}
        />
      </DatabaseContext.Provider>
      <button data-testid='outside-database'>Outside database</button>
    </>
  );

  return {
    ...rendered,
    databaseDoc,
  };
}

function dispatchHistoryHotkey(target: HTMLElement, redoAction = false) {
  const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };

  fireEvent.keyDown(target, {
    bubbles: true,
    cancelable: true,
    code: 'KeyZ',
    key: 'z',
    keyCode: 90,
    shiftKey: redoAction,
    which: 90,
    ...modifier,
  });
}

describe('DatabaseViews history scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseHistoryManager.mockReturnValue({
      canRedo: () => true,
      canUndo: () => true,
      redo,
      undo,
    } as unknown as ReturnType<typeof useDatabaseHistoryManager>);
  });

  it.each([
    ['Board', DatabaseViewLayout.Board, 'board-layout'],
    ['List', DatabaseViewLayout.List, 'list-layout'],
    ['Gallery', DatabaseViewLayout.Gallery, 'gallery-layout'],
    ['Calendar', DatabaseViewLayout.Calendar, 'calendar-layout'],
  ])('handles keyboard undo and redo from the %s layout', async (_name, layout, testId) => {
    const { databaseDoc, unmount } = renderDatabaseViews(layout);
    const layoutSurface = await screen.findByTestId(testId);
    const tabs = screen.getByTestId('database-tabs');
    const conditions = screen.getByTestId('database-conditions');
    const historyScope = layoutSurface.closest('[data-database-history-scope]');

    expect(historyScope).not.toBeNull();
    expect(tabs.closest('[data-database-history-scope]')).toBe(historyScope);
    expect(conditions.closest('[data-database-history-scope]')).toBe(historyScope);

    fireEvent.pointerDown(layoutSurface);
    dispatchHistoryHotkey(layoutSurface);
    dispatchHistoryHotkey(layoutSurface, true);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);

    unmount();
    databaseDoc.destroy();
  });

  it('handles history hotkeys from the tabs and conditions above Grid', async () => {
    const { databaseDoc, unmount } = renderDatabaseViews(DatabaseViewLayout.Grid);
    const grid = await screen.findByTestId('grid-layout');
    const tabs = screen.getByTestId('database-tabs');
    const conditions = screen.getByTestId('database-conditions');
    const outside = screen.getByTestId('outside-database');
    const historyScope = grid.closest('[data-database-history-scope]');

    expect(historyScope).not.toBeNull();
    expect(tabs.closest('[data-database-history-scope]')).toBe(historyScope);
    expect(conditions.closest('[data-database-history-scope]')).toBe(historyScope);

    fireEvent.pointerDown(tabs);
    dispatchHistoryHotkey(tabs);
    expect(undo).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(outside);
    dispatchHistoryHotkey(outside);
    expect(undo).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(conditions);
    dispatchHistoryHotkey(conditions, true);
    expect(redo).toHaveBeenCalledTimes(1);

    unmount();
    databaseDoc.destroy();
  });

  it('keeps history ownership when switching between layout providers', async () => {
    const { databaseDoc, unmount } = renderDatabaseViews(DatabaseViewLayout.Grid);
    const grid = await screen.findByTestId('grid-layout');
    const tabs = screen.getByTestId('database-tabs');
    const historyScope = grid.closest('[data-database-history-scope]');

    fireEvent.pointerDown(tabs);
    act(() => {
      databaseDoc
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database)
        ?.get(YjsDatabaseKey.views)
        ?.get('view-id')
        ?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    });

    const board = await screen.findByTestId('board-layout');

    expect(board.closest('[data-database-history-scope]')).toBe(historyScope);
    dispatchHistoryHotkey(board);
    expect(undo).toHaveBeenCalledTimes(1);

    unmount();
    databaseDoc.destroy();
  });
});
