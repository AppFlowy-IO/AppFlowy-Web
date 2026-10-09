import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { Dashboard } from '../Dashboard';
import { DashboardActions } from '../DashboardActions';
import { DashboardProvider } from '../DashboardContext';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({
  autoScrollForElements: () => () => undefined,
}));

jest.mock('../global-filters/GlobalFilterBar', () => ({
  GlobalFilterBar: () => null,
}));

jest.mock('../global-filters/GlobalFilterButton', () => ({
  GlobalFilterButton: () => null,
}));

jest.mock('../DashboardWidget', () => ({
  DashboardWidget: ({ widget, span, lineSize }: { widget: { id: string }; span: number; lineSize: number }) => (
    <div data-line-size={lineSize} data-span={span} data-testid='dashboard-widget' data-widget-id={widget.id} />
  ),
}));

jest.mock('../WidgetPicker', () => ({ LazyWidgetDockHost: () => null, preloadWidgetPicker: () => undefined }));

jest.mock('../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: () => ({ databases: [], loading: false, error: null }),
}));

type ResizeCallback = (entries: Array<{ contentRect: { width: number } }>) => void;

const observers: ResizeCallback[] = [];
const originalResizeObserver = window.ResizeObserver;

class MockResizeObserver {
  constructor(private readonly callback: ResizeCallback) {
    observers.push(callback);
  }

  observe() {
    return undefined;
  }

  disconnect() {
    return undefined;
  }
}

const DATABASE_ID = 'host-database';
const VIEW_ID = 'dashboard-view';

function makeRows(...layout: number[][]): DashboardRow[] {
  return layout.map((widths, rowIndex) => ({
    id: `r${rowIndex + 1}`,
    height: 360,
    widgets: widths.map((width, index) => ({
      id: `w${rowIndex + 1}-${index}`,
      viewId: `view-${rowIndex + 1}-${index}`,
      databaseId: DATABASE_ID,
      width,
    })),
  }));
}

function renderGrid(rows: DashboardRow[]) {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.views, views as never);
  views.set(VIEW_ID, view);
  doc.transact(() => updateDashboardLayoutSetting(view, { rows }));

  const value: DatabaseContextState = {
    readOnly: false,
    databaseDoc: doc,
    databasePageId: VIEW_ID,
    activeViewId: VIEW_ID,
    rowMap: {},
    workspaceId: 'workspace-id',
  };

  return render(
    <DatabaseContext.Provider value={value}>
      <DashboardProvider>
        <DashboardActions />
        <Dashboard />
      </DashboardProvider>
    </DatabaseContext.Provider>
  );
}

/** The grid's content width; the row tracks are 12px wider (the box bleed). */
function measureGrid(width: number) {
  act(() => observers.forEach((callback) => callback([{ contentRect: { width } }])));
}

const row = (rowId: string) =>
  screen.getAllByTestId('dashboard-row').find((element) => element.dataset.rowId === rowId) as HTMLElement;
const attributes = (elements: HTMLElement[], name: string) => elements.map((element) => element.getAttribute(name));

beforeEach(() => {
  observers.length = 0;
  window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  window.ResizeObserver = originalResizeObserver;
});

describe('DashboardGrid', () => {
  it('wraps a row of three into two plus one on a 704px track, without width handles', () => {
    renderGrid(makeRows([4, 4, 4], [12]));
    measureGrid(692);
    fireEvent.click(screen.getByTestId('dashboard-edit-button'));

    expect(screen.getByTestId('dashboard-grid').getAttribute('data-track-width')).toBe('704');
    expect(row('r1').getAttribute('data-lines')).toBe('2,1');
    expect(row('r1').getAttribute('data-wrap-columns')).toBe('2');
    const widgets = within(row('r1')).getAllByTestId('dashboard-widget');

    expect(attributes(widgets, 'data-span')).toEqual(['6', '6', '12']);
    expect(attributes(widgets, 'data-line-size')).toEqual(['2', '2', '1']);
    expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
    expect(attributes(within(row('r1')).getAllByTestId('dashboard-row-control-anchor'), 'data-side')).toEqual([
      'start',
      'end',
    ]);
  });

  it('keeps the stored widths and the width handles when the row fits (1244px track)', () => {
    renderGrid(makeRows([3, 6, 3]));
    measureGrid(1232);
    fireEvent.click(screen.getByTestId('dashboard-edit-button'));

    expect(row('r1').getAttribute('data-lines')).toBe('3');
    expect(attributes(within(row('r1')).getAllByTestId('dashboard-widget'), 'data-span')).toEqual(['3', '6', '3']);
    expect(screen.getAllByTestId('dashboard-width-handle')).toHaveLength(2);
    // 240px at 1244: the resize minimum is 3 columns.
    expect(screen.getAllByTestId('dashboard-width-handle')[0].getAttribute('aria-valuemin')).toBe('3');
  });

  it('never wraps an unmeasured row', () => {
    renderGrid(makeRows([3, 3, 3, 3]));

    expect(screen.getByTestId('dashboard-grid').getAttribute('data-track-width')).toBe('');
    expect(row('r1').getAttribute('data-lines')).toBe('4');
    expect(attributes(within(row('r1')).getAllByTestId('dashboard-widget'), 'data-span')).toEqual(['3', '3', '3', '3']);
  });

  it('keeps the same bands in View and Edit mode; only Edit mode adds drop zones and height handles', () => {
    renderGrid(makeRows([6, 6], [12]));
    measureGrid(1232);
    const bands = () => screen.getAllByTestId('dashboard-row-gap');

    expect(bands().map((band) => band.style.height)).toEqual(['12px', '16px', '16px']);
    expect(screen.queryByTestId('dashboard-row-drop-zone')).toBeNull();
    expect(screen.queryByTestId('dashboard-height-handle')).toBeNull();

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));

    expect(bands().map((band) => band.style.height)).toEqual(['12px', '16px', '16px']);
    expect(attributes(screen.getAllByTestId('dashboard-row-drop-zone'), 'data-row-index')).toEqual(['0', '1', '2']);
    // The height handle of row N sits in the band after it.
    expect(within(bands()[0]).queryByTestId('dashboard-height-handle')).toBeNull();
    expect(within(bands()[1]).getByTestId('dashboard-height-handle').getAttribute('data-row-id')).toBe('r1');
    expect(within(bands()[2]).getByTestId('dashboard-height-handle').getAttribute('data-row-id')).toBe('r2');
  });

  it('hands every row its controls and puts "Add to new row" under the last row (WP04)', () => {
    renderGrid(makeRows([3, 3, 3, 3], [6, 6], [12]));
    fireEvent.click(screen.getByTestId('dashboard-edit-button'));

    const moves = (rowId: string) =>
      within(row(rowId))
        .queryAllByTestId(/^dashboard-row-move-(up|down)$/)
        .map((button) => button.getAttribute('data-testid'));

    expect(moves('r1')).toEqual(['dashboard-row-move-down']);
    expect(moves('r2')).toEqual(['dashboard-row-move-up', 'dashboard-row-move-down']);
    expect(moves('r3')).toEqual(['dashboard-row-move-up']);
    // The full row has no "Add to row"; the others do.
    expect(within(row('r1')).queryByTestId('dashboard-add-widget-row-button')).toBeNull();
    expect(within(row('r2')).getByTestId('dashboard-add-widget-row-button')).toBeTruthy();

    const addToNewRow = screen.getByTestId('dashboard-add-widget-button');
    const grid = screen.getByTestId('dashboard-grid');

    expect(addToNewRow.getAttribute('aria-label')).toBe('Add to new row');
    expect(addToNewRow.hasAttribute('aria-disabled')).toBe(false);
    // In flow after the last band, the grid's last child.
    expect(grid.lastElementChild?.contains(addToNewRow)).toBe(true);
    expect(screen.queryByTestId('dashboard-insert-row-button')).toBeNull();
  });

  it('shows no row controls and no "Add to new row" in View mode', () => {
    renderGrid(makeRows([6, 6], [12]));

    expect(screen.queryByTestId('dashboard-row-move-control')).toBeNull();
    expect(screen.queryByTestId('dashboard-add-widget-row-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-add-widget-button')).toBeNull();
  });

  it('reserves the same page inset in View and Edit mode for editors', () => {
    renderGrid(makeRows([12]));
    const content = screen.getByTestId('dashboard-grid').parentElement as HTMLElement;
    const before = [content.style.paddingLeft, content.style.paddingRight];

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    expect([content.style.paddingLeft, content.style.paddingRight]).toEqual(before);
    expect(before).toEqual(['96px', '96px']);
  });
});
