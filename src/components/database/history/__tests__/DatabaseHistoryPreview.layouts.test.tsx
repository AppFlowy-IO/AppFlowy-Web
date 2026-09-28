import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { DatabaseViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { DatabaseHistoryPreview } from '../DatabaseHistoryPreviewProvider';

jest.mock('lodash-es', () => jest.requireActual('lodash'));

// jsdom has no element measurements; render every fixture row/column while
// retaining the real Grid row, cell, DnD, and read-only implementations.
jest.mock('@/components/database/components/grid/grid-table/useGridVirtualizer', () => ({
  PADDING_INLINE: 24,
  useGridVirtualizer: ({ data, columns }: { data: unknown[]; columns: unknown[] }) => {
    const { useMemo, useRef } = jest.requireActual('react');
    const make = (items: unknown[], size: number) => ({
      getVirtualItems: () => items.map((_, index) => ({ index, key: index, start: index * size, end: (index + 1) * size, size })),
      getTotalSize: () => items.length * size,
      measure: () => undefined, measureElement: () => undefined, resizeItem: () => undefined,
      scrollToIndex: () => undefined, scrollElement: null, options: { scrollMargin: 0 },
    });

    return { parentRef: useRef(null), virtualizer: useMemo(() => make(data, 40), [data]),
      columnVirtualizer: useMemo(() => make(columns, 180), [columns]), scrollMarginTop: 0, isReady: true };
  },
}));

beforeAll(() => {
  global.ResizeObserver = class { observe() { return undefined; } unobserve() { return undefined; } disconnect() { return undefined; } };
  global.IntersectionObserver = class { observe() { return undefined; } unobserve() { return undefined; } disconnect() { return undefined; } } as unknown as typeof IntersectionObserver;
});

// Jest's jsdom resolver selects Preact's ESM browser entry; FullCalendar also
// ships CJS, so use that entry without replacing the calendar implementation.
jest.mock('preact', () => jest.requireActual(require.resolve('preact').replace('preact.module.js', 'preact.js')));
jest.mock('preact/hooks', () => jest.requireActual(require.resolve('preact/hooks').replace('hooks.module.js', 'hooks.js')));
jest.mock('preact/compat', () => jest.requireActual(require.resolve('preact/compat').replace('compat.module.js', 'compat.js')));
jest.mock('@/components/database/fullcalendar/FullCalendar.styles.scss', () => ({}));

jest.mock('@/utils/runtime-config', () => ({
  isDevelopmentOrTestEnvironment: () => true,
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function snapshot(layout: DatabaseViewLayout) {
  const root = new Y.Doc({ guid: `history:layouts:${layout}` }) as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const fieldOrders = new Y.Array();
  const fieldSettings = new Y.Map();

  for (const [id, type] of [['title', FieldType.RichText], ['done', FieldType.Checkbox], ['date', FieldType.DateTime]] as const) {
    const field = new Y.Map();

    field.set(YjsDatabaseKey.id, id);
    field.set(YjsDatabaseKey.name, id);
    field.set(YjsDatabaseKey.type, type);
    field.set(YjsDatabaseKey.is_primary, id === 'title');
    field.set(YjsDatabaseKey.type_option, new Y.Map());
    fields.set(id, field);
    fieldOrders.push([{ id }]);
    fieldSettings.set(id, new Y.Map([['visibility', 0], ['width', 180]]));
  }

  const rowOrders = new Y.Array();

  rowOrders.push([{ id: 'row-1', height: 40 }]);
  view.set(YjsDatabaseKey.id, 'saved-view');
  view.set(YjsDatabaseKey.name, 'Saved layout');
  view.set(YjsDatabaseKey.layout, layout);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  const groups = new Y.Array();
  const group = new Y.Map();
  const columns = new Y.Array();

  columns.push([new Y.Map([['id', 'No'], ['name', 'Unchecked']]), new Y.Map([['id', 'Yes'], ['name', 'Checked']])]);
  group.set(YjsDatabaseKey.id, 'done-group');
  group.set(YjsDatabaseKey.field_id, 'done');
  group.set(YjsDatabaseKey.type, FieldType.Checkbox);
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);
  view.set(YjsDatabaseKey.groups, groups);
  const layoutSettings = new Y.Map();

  layoutSettings.set(String(DatabaseViewLayout.Calendar), new Y.Map([['field_id', 'date']]));
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  views.set('saved-view', view);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, new Y.Map());
  root.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const row = createRowDoc('row-1', 'database', {
    title: createCell(FieldType.RichText, 'Historical task'),
    done: createCell(FieldType.Checkbox, 'No'),
    date: createCell(FieldType.DateTime, '1788998400'),
  });

  return { root, rows: { 'row-1': row } };
}

test.each([
  ['Grid', DatabaseViewLayout.Grid], ['Board', DatabaseViewLayout.Board], ['Calendar', DatabaseViewLayout.Calendar],
  ['Chart', DatabaseViewLayout.Chart], ['List', DatabaseViewLayout.List], ['Gallery', DatabaseViewLayout.Gallery],
  ['Feed', DatabaseViewLayout.Feed], ['Form', DatabaseViewLayout.Form],
])('mounts the real saved %s layout without changing the historical snapshot', async (_name, layout) => {
  const data = snapshot(layout as DatabaseViewLayout);
  const beforeRoot = Y.encodeStateAsUpdate(data.root);
  const beforeRow = Y.encodeStateAsUpdate(data.rows['row-1']);
  const loadLiveData = jest.fn(async () => { throw new Error('Historical layout called a live loader'); });
  const liveContext: DatabaseContextState = {
    databaseDoc: data.root, databasePageId: 'live-view', activeViewId: 'live-view', workspaceId: 'workspace',
    rowMap: data.rows, readOnly: false, loadRowDocument: loadLiveData, loadView: loadLiveData,
    loadViewMeta: loadLiveData, createRow: loadLiveData, getViewIdFromDatabaseId: loadLiveData,
  };
  const rendered = render(
    <AFConfigContext.Provider value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}>
      <div className='sticky-header-overlay' data-testid='live-sticky-overlay'>Live header</div>
      <DatabaseContext.Provider value={liveContext}>
        <DatabaseHistoryPreview {...data} workspaceId='workspace' databaseId='database' databasePageId='saved-view' />
      </DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );

  await waitFor(() => expect(screen.getByTestId('database-history-preview')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('Saved layout')).toBeTruthy());
  const selector = {
    [DatabaseViewLayout.Grid]: '[data-testid="database-grid"]',
    [DatabaseViewLayout.Board]: '.database-board',
    [DatabaseViewLayout.Calendar]: '.database-calendar',
    [DatabaseViewLayout.Chart]: '[data-testid="database-chart"]',
    [DatabaseViewLayout.List]: '[data-testid="database-list"]',
    [DatabaseViewLayout.Gallery]: '[data-testid="database-gallery"]',
    [DatabaseViewLayout.Feed]: '[data-testid="database-feed"]',
    [DatabaseViewLayout.Form]: '[data-testid="form-builder-scroll-container"]',
  }[layout as DatabaseViewLayout];

  await waitFor(() => expect(rendered.container.querySelector(selector)).not.toBeNull());
  rendered.container.querySelectorAll('[role="checkbox"]').forEach((checkbox) => fireEvent.click(checkbox));
  const title = screen.queryAllByText('Historical task')[0];

  if (title) fireEvent.doubleClick(title);
  fireEvent.keyDown(rendered.container, { key: 'Delete' });
  fireEvent.keyDown(rendered.container, { key: 'Backspace' });
  expect(Y.encodeStateAsUpdate(data.root)).toEqual(beforeRoot);
  expect(Y.encodeStateAsUpdate(data.rows['row-1'])).toEqual(beforeRow);
  expect(rendered.container.querySelector('[contenteditable="true"]')).toBeNull();
  expect(screen.queryByText('Something went wrong')).toBeNull();
  expect(loadLiveData).not.toHaveBeenCalled();
  expect(screen.getByTestId('live-sticky-overlay').textContent).toBe('Live header');
  rendered.unmount();
  data.root.destroy();
  data.rows['row-1'].destroy();
});
