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

// The indicator package ships compiled CSS that jest cannot parse.
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({
  DropIndicator: () => null,
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

jest.mock('../WidgetPicker', () => ({ WidgetPicker: () => null, preloadWidgetPicker: () => undefined }));

jest.mock('../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: () => ({ databases: [], loading: false, error: null }),
}));

jest.mock('../hooks/useCreateWidgetView', () => ({
  useCreateWidgetView: () => ({ createView: jest.fn(), canCreateInOtherDatabases: true, bridge: null }),
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
    renderGrid(makeRows([4, 4, 4]));
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

  it('reserves the same page inset in View and Edit mode for editors', () => {
    renderGrid(makeRows([12]));
    const content = screen.getByTestId('dashboard-grid').parentElement as HTMLElement;
    const before = [content.style.paddingLeft, content.style.paddingRight];

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    expect([content.style.paddingLeft, content.style.paddingRight]).toEqual(before);
    expect(before).toEqual(['96px', '96px']);
  });
});
