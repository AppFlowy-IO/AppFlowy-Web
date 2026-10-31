import { render, screen } from '@testing-library/react';
import { createRef, ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContextState, FieldType } from '@/application/database-yjs';
import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  DashboardFiltersContext,
  DashboardFiltersContextValue,
  DashboardSourceRegistryContext,
  DashboardSourceRegistryContextValue,
} from '../DashboardContext';
import { DashboardHostContext, DashboardHostServices, DashboardUiContext } from '../DashboardUiContext';
import { WidgetActions, WidgetFrame } from '../WidgetContext';
import { WidgetDatabaseHost } from '../WidgetDatabaseHost';

const mockSourceDocs = new Map<string, YDoc>();
const mockPermissions = { readOnly: false };

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string } | string) =>
    typeof options === 'string' ? options : options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
// The nested database renders the real list in the widget card, with what the
// widget hands it: its insets, its permissions and its source doc. Only the
// database shell is left out (its widget composition adds no inline inset:
// card, viewport, layout).
jest.mock('@/components/database', () => ({
  Database: ({
    doc,
    activeViewId,
    paddingStart,
    paddingEnd,
    readOnly,
  }: {
    doc: YDoc;
    activeViewId: string;
    paddingStart?: number;
    paddingEnd?: number;
    readOnly?: boolean;
  }) => {
    const { DatabaseContext: Context } =
      jest.requireActual<typeof import('@/application/database-yjs')>('@/application/database-yjs');
    const { List: RealList } =
      jest.requireActual<typeof import('@/components/database/list')>('@/components/database/list');
    const { WidgetBody } = jest.requireActual<typeof import('../WidgetBody')>('../WidgetBody');
    const value: DatabaseContextState = {
      databaseDoc: doc,
      databasePageId: activeViewId,
      activeViewId,
      readOnly: Boolean(readOnly),
      rowMap: {},
      workspaceId: 'workspace',
      isDocumentBlock: true,
      isDashboardWidget: true,
      paddingStart,
      paddingEnd,
    };

    return (
      <Context.Provider value={value}>
        <WidgetBody>
          <RealList />
        </WidgetBody>
      </Context.Provider>
    );
  },
}));
jest.mock('@/components/database/list/ListGroupingContext', () => ({
  ListGroupingProvider: ({ children }: { children: ReactNode }) => children,
  useListGrouping: () => ({
    activeGroupIds: [],
    groups: [],
    hideEmptyGroups: true,
    isGrouped: false,
    ready: true,
    rowOrders: [{ id: 'row-1', height: 36 }],
    visibleGroups: [],
  }),
}));
// Row creation needs the signed-in user; the rows here are only laid out.
jest.mock('@/application/database-yjs/dispatch', () => ({
  ...jest.requireActual<typeof import('@/application/database-yjs/dispatch')>('@/application/database-yjs/dispatch'),
  useNewRowDispatch: () => jest.fn(),
  useDuplicateRowDispatch: () => jest.fn(),
  useReorderRowDispatch: () => jest.fn(),
}));
jest.mock('@/components/database/components/cell/Cell', () => ({
  Cell: () => <span data-testid='list-title-text'>Title</span>,
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDocumentLoader', () => ({
  useDocumentLoader: ({ viewId, databaseId }: { viewId: string; databaseId: string }) => ({
    doc: viewId ? mockSourceDocs.get(databaseId) ?? null : null,
    notFound: false,
    noAccess: false,
    offline: false,
    setNotFound: jest.fn(),
  }),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus', () => ({
  useDatabaseDeletionStatus: () => 'none',
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions', () => ({
  EmbeddedDatabasePermissionsResolver: ({
    children,
  }: {
    children: (
      permissions: { readOnly: boolean; canWrite: boolean; canShare: boolean },
      status: { settled: boolean }
    ) => ReactNode;
  }) =>
    children(
      { readOnly: mockPermissions.readOnly, canWrite: !mockPermissions.readOnly, canShare: false },
      { settled: true }
    ),
}));
jest.mock('../hooks/useDashboardDnd', () => ({ useDraggableWidget: () => undefined }));
jest.mock('../WidgetHeader', () => ({ WidgetHeaderFrame: () => null }));

/** A source database with one List view of one row, titled by its primary field. */
function createListSource() {
  const doc = new Y.Doc({ guid: 'source-db' }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const title = new Y.Map() as YDatabaseField;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  doc.transact(() => {
    database.set(YjsDatabaseKey.id, 'source-db');
    title.set(YjsDatabaseKey.name, 'Name');
    title.set(YjsDatabaseKey.type, FieldType.RichText);
    title.set(YjsDatabaseKey.is_primary, true);
    fields.set('title', title);
    database.set(YjsDatabaseKey.fields, fields as never);
    view.set(YjsDatabaseKey.name, 'Tasks');
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.List);
    view.set(YjsDatabaseKey.field_orders, Y.Array.from([{ id: 'title' }]) as never);
    view.set(YjsDatabaseKey.field_settings, new Y.Map() as never);
    view.set(YjsDatabaseKey.filters, new Y.Array() as never);
    view.set(YjsDatabaseKey.sorts, new Y.Array() as never);
    view.set(YjsDatabaseKey.groups, new Y.Array() as never);
    view.set(YjsDatabaseKey.row_orders, Y.Array.from([{ id: 'row-1', height: 36 }]) as never);
    views.set('list-view', view);
    database.set(YjsDatabaseKey.views, views as never);
  });
  return doc;
}

const actions: WidgetActions = {
  open: jest.fn(),
  changeView: jest.fn(),
  duplicate: jest.fn(),
  remove: jest.fn(),
  move: jest.fn(),
  openSettings: jest.fn(),
};

function createFrame(editing: boolean): WidgetFrame {
  return {
    widgetId: 'w1',
    databaseId: 'source-db',
    viewId: 'list-view',
    folderName: '',
    folderLayout: undefined,
    icon: null,
    isEditing: editing,
    canEdit: true,
    editing,
    showWidgetTitles: true,
    showIcon: false,
    headerHeight: 40,
    isDragging: false,
    menuOpen: false,
    setMenuOpen: jest.fn(),
    settingsOpen: false,
    setSettingsOpen: jest.fn(),
    getBoxElement: () => null,
    titleRef: createRef(),
    optionsRef: createRef(),
    settingsToolRef: createRef(),
    actions,
  };
}

function renderListWidget(editing: boolean) {
  const hostDoc = new Y.Doc({ guid: 'host-db' }) as YDoc;
  const host = { databaseDoc: hostDoc, readOnly: false, workspaceId: 'workspace' } as DashboardHostServices;
  const filters = {
    effectiveGlobalFilters: [],
    getViewOverlay: () => undefined,
    setViewOverlayWritable: jest.fn(),
  } as unknown as DashboardFiltersContextValue;
  const registry = {
    markWidgetShown: () => () => undefined,
    getShownDoc: () => null,
  } as unknown as DashboardSourceRegistryContextValue;

  render(
    <DashboardHostContext.Provider value={host}>
      <DashboardUiContext.Provider
        value={{
          hostDatabaseId: 'host-db',
          dndInstanceId: Symbol('list-inset'),
          getRows: () => [],
          updateRows: jest.fn(),
          openPicker: jest.fn(),
          showLimitMessage: jest.fn(),
          acquireSourceDoc: () => () => undefined,
          selectWidget: jest.fn(),
        }}
      >
        <DashboardFiltersContext.Provider value={filters}>
          <DashboardSourceRegistryContext.Provider value={registry}>
            <WidgetDatabaseHost frame={createFrame(editing)} viewportHeight={320} />
          </DashboardSourceRegistryContext.Provider>
        </DashboardFiltersContext.Provider>
      </DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );
}

/** Tailwind's spacing scale: `1.5` is 6px, `[12px]` is 12px. */
function spacing(value: string) {
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value);

  if (arbitrary) return Number(arbitrary[1]);
  return value === 'px' ? 1 : Number(value) * 4;
}

/** The inline-start padding of an element: its inline style, else its Tailwind padding class. */
function paddingStartOf(element: HTMLElement) {
  const inline = element.style.paddingInlineStart || element.style.paddingLeft;

  if (inline) return parseFloat(inline);
  const classes = Array.from(element.classList);
  const own = ['pl-', 'ps-', 'px-', 'p-']
    .map((prefix) => classes.find((name) => name.startsWith(prefix)))
    .find((name) => name !== undefined);

  return own ? spacing(own.slice(own.indexOf('-') + 1)) : 0;
}

/** The width an in-flow box takes before its next sibling: its inline width, else its Tailwind width class. */
function widthOf(element: HTMLElement) {
  if (element.classList.contains('absolute')) return 0;
  if (element.style.width) return parseFloat(element.style.width);
  const width = Array.from(element.classList).find((name) => /^w-(\d|\[)/.test(name));

  return width ? spacing(width.slice(2)) : 0;
}

/**
 * Where `target` starts inside `container`, from the layout code: the paddings
 * along the path plus the boxes laid out before it on each row (jsdom lays out
 * nothing, so this reads the styles and classes the browser would use).
 */
function inlineStartWithin(container: HTMLElement, target: HTMLElement) {
  const path: HTMLElement[] = [];

  for (let node: HTMLElement | null = target; node && node !== container; node = node.parentElement) path.unshift(node);
  expect(path[0]?.parentElement).toBe(container);
  let offset = paddingStartOf(container);

  path.forEach((node) => {
    const parent = node.parentElement as HTMLElement;
    const flexRow = parent.classList.contains('flex') && !parent.classList.contains('flex-col');

    if (flexRow) {
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        offset += widthOf(sibling as HTMLElement);
      }
    }

    if (node !== target) offset += paddingStartOf(node);
  });
  return offset;
}

const { geometry } = loadParityFixture<{ geometry: { list_title_inset: number } }>('widget-content.json');

beforeEach(() => {
  mockSourceDocs.clear();
  mockSourceDocs.set('source-db', createListSource());
});

describe('a list widget', () => {
  it.each([
    ['editable', 'View', false, false],
    ['editable', 'Edit', false, true],
    ['read-only', 'View', true, false],
    ['read-only', 'Edit', true, true],
  ])('starts its row titles at the shared inset: %s, %s mode', (_access, _mode, readOnly, editing) => {
    mockPermissions.readOnly = readOnly;
    renderListWidget(editing);

    const card = screen.getByTestId('dashboard-widget-body');
    const titleCell = screen.getByTestId('list-primary-cell-row-1');

    // The row keeps its actions slot (empty when read-only), so titles line up in both cases.
    expect(screen.queryByTestId('list-row-actions-row-1') === null).toBe(readOnly);
    expect(inlineStartWithin(card, titleCell)).toBe(geometry.list_title_inset);
  });
});
