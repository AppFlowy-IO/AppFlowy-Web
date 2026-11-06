// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, FieldType, type GridGrouping } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useRenderFields } from '@/components/database/components/grid/grid-column/useRenderFields';
import { GridProvider } from '@/components/database/grid/GridProvider';
import { AFConfigContext } from '@/components/main/app.hooks';

import GridVirtualizer from '../GridVirtualizer';

// The real grid provider, header rows, field menus and property editors, with
// the sticky header in the page overlay; only jsdom's missing geometry is
// supplied (as in GridVirtualizer.rerenders.test.tsx).
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 600;
const VIEWPORT_WIDTH = 480;
const COLUMN_WIDTH = 100;
// Few enough fields that every column, and the New property column, renders.
const FIELD_COUNT = 4;
// A grouped grid: 3 groups of 3 rows, each with its header row, all rendered.
const GROUP_COUNT = 3;
const GROUP_SIZE = 3;
// The grid's own scroller: tall enough that its header stays pinned a while.
const GRID_HEIGHT = 14 * ROW_HEIGHT;
const originalResizeObserver = global.ResizeObserver;
const originalIntersectionObserver = global.IntersectionObserver;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function elementHeight(element: HTMLElement) {
  if (element.matches('[data-index], .grid-cell')) return ROW_HEIGHT;
  if (element.classList.contains('appflowy-custom-scroller')) return GRID_HEIGHT;
  return VIEWPORT_HEIGHT;
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  };
  global.IntersectionObserver = class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  } as unknown as typeof IntersectionObserver;

  const geometry: Record<string, PropertyDescriptor> = {
    offsetWidth: { get() { return VIEWPORT_WIDTH; } },
    clientWidth: { get() { return VIEWPORT_WIDTH; } },
    scrollWidth: { get() { return VIEWPORT_WIDTH; } },
    offsetHeight: { get(this: HTMLElement) { return elementHeight(this); } },
    clientHeight: { get(this: HTMLElement) { return elementHeight(this); } },
    scrollHeight: { get(this: HTMLElement) { return elementHeight(this); } },
    scrollTo: { value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
      if (options.left !== undefined) this.scrollLeft = options.left;
    } },
    scroll: { value(this: HTMLElement, options: ScrollToOptions) { this.scrollTo(options); } },
  };

  for (const [name, descriptor] of Object.entries(geometry)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, configurable: true });
  }
});

beforeEach(() => {
  jest.useFakeTimers();
  // The grid starts 100px down the page: its header pins under the 48px app bar
  // once the page scrolls past 52px.
  const pageLayout = {
    getBoundingClientRect(this: HTMLElement) {
      const height = elementHeight(this);
      const viewport = this.closest<HTMLElement>('[data-testid="property-editor-viewport"]');
      const isGrid = Boolean(viewport) && this !== viewport && this.classList.contains('appflowy-custom-scroller');
      const top = isGrid ? 100 - (viewport?.scrollTop ?? 0) : 0;

      return {
        x: 0,
        y: top,
        left: 0,
        top,
        width: VIEWPORT_WIDTH,
        height,
        right: VIEWPORT_WIDTH,
        bottom: top + height,
        toJSON: () => ({}),
      };
    },
  };

  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(pageLayout.getBoundingClientRect);
  // The page's overlay, which the grid's sticky header row portals into.
  const stickyHeaderOverlay = document.createElement('div');

  stickyHeaderOverlay.className = 'sticky-header-overlay';
  document.body.appendChild(stickyHeaderOverlay);
});

afterEach(async () => {
  await act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.querySelectorAll('.sticky-header-overlay').forEach((overlay) => overlay.remove());
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
  global.IntersectionObserver = originalIntersectionObserver;
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

/** An editable grid view with its fields listed in the view, grouped into 3 groups or not. */
function fixture({ grouped }: { grouped: boolean }) {
  const databaseDoc = new Y.Doc({ guid: 'property-editor-database' }) as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map();
  const view = new Y.Map();
  const views = new Y.Map();
  const fieldSettings = new Y.Map();
  const rowMap: Record<string, YDoc> = {};
  const rowOrders = Array.from({ length: GROUP_COUNT * GROUP_SIZE }, (_, index) => ({
    id: `row-${index + 1}`,
    height: ROW_HEIGHT,
  }));
  const fieldIds = Array.from({ length: FIELD_COUNT }, (_, index) => `field-${index}`);

  fieldIds.forEach((fieldId, index) => {
    const field = new Y.Map();
    const setting = new Y.Map();

    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.name, fieldId);
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    field.set(YjsDatabaseKey.is_primary, index === 0);
    field.set(YjsDatabaseKey.type_option, new Y.Map());
    fields.set(fieldId, field);
    setting.set(YjsDatabaseKey.width, COLUMN_WIDTH);
    fieldSettings.set(fieldId, setting);
  });

  for (const { id } of rowOrders) {
    rowMap[id] = createRowDoc(
      id,
      'property-editor-database',
      Object.fromEntries(fieldIds.map((fieldId) => [fieldId, createCell(FieldType.RichText, `${fieldId} ${id}`)]))
    );
  }

  view.set(YjsDatabaseKey.id, 'property-editor-view');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(rowOrders));
  view.set(YjsDatabaseKey.field_orders, Y.Array.from(fieldIds.map((id) => ({ id }))));
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  views.set('property-editor-view', view);
  database.set(YjsDatabaseKey.id, 'property-editor-database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const context: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    activeViewId: 'property-editor-view',
    databasePageId: 'property-editor-view',
    workspaceId: 'property-editor-workspace',
    rowMap,
    seedsReady: true,
    blobPrefetchComplete: true,
    isDocumentBlock: false,
  };
  const groups = Array.from({ length: GROUP_COUNT }, (_, index) => ({
    id: `group-${index}`,
    label: `Group ${index}`,
    rows: rowOrders.slice(index * GROUP_SIZE, (index + 1) * GROUP_SIZE),
    isDefault: false,
    visible: true,
    hidden: false,
    automaticallyHidden: false,
    collapsed: false,
  }));
  const grouping: GridGrouping = grouped
    ? {
        rowOrders,
        isGrouped: true,
        groupId: 'property-editor-group-config',
        fieldId: 'field-1',
        fieldName: 'field-1',
        fieldType: FieldType.SingleSelect,
        ready: true,
        activeGroupIds: groups.map(({ id }) => id),
        groups,
        visibleGroups: groups,
        hideEmptyGroups: false,
      }
    : {
        rowOrders,
        isGrouped: false,
        ready: true,
        activeGroupIds: [],
        groups: [],
        visibleGroups: [],
        hideEmptyGroups: false,
      };
  // The view's field ids, in their order.
  const viewFieldIds = () =>
    (view.get(YjsDatabaseKey.field_orders) as Y.Array<{ id: string }>).toArray().map(({ id }) => id);
  const destroy = () => {
    databaseDoc.destroy();
    Object.values(rowMap).forEach((row) => row.destroy());
  };

  return { context, grouping, viewFieldIds, destroy };
}

/** The grid with the columns of its view and the New property column, as `Grid` renders it. */
function GridOfView() {
  const { fields } = useRenderFields();

  return <GridVirtualizer columns={fields} />;
}

function Providers({
  data,
  grouping,
  children,
}: {
  data: ReturnType<typeof fixture>;
  grouping?: GridGrouping;
  children: ReactNode;
}) {
  return (
    <AFConfigContext.Provider
      value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}
    >
      <DatabaseContext.Provider value={data.context}>
        <div className='appflowy-scroll-container' data-testid='property-editor-viewport'>
          <GridProvider grouping={grouping ?? data.grouping}>{children}</GridProvider>
        </div>
      </DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}

async function renderGrid(data: ReturnType<typeof fixture>) {
  const rendered = render(
    <Providers data={data}>
      <GridOfView />
    </Providers>
  );

  await waitFor(() => expect(screen.getAllByText('field-3 row-9').length).toBeGreaterThan(0));
  await act(() => jest.runOnlyPendingTimers());
  return rendered;
}

/** Scrolls the page: 60px pins the sticky header, 0 unpins it. */
async function scrollPageTo(top: number) {
  fireEvent.scroll(screen.getByTestId('property-editor-viewport'), { target: { scrollTop: top } });
  await act(() => jest.advanceTimersByTime(200));
}

/** A header row by render key: `header`, a group's `group:<id>:header`, or the sticky one, `sticky-header`. */
function headerRow(rowKey: string) {
  return document.querySelector<HTMLElement>(`[data-parity-id="dash-widget-grid-header"][data-row-key="${rowKey}"]`);
}

/** Picks an item of the field menu of a header cell. */
async function pickFieldMenuItem(rowKey: string, fieldId: string, item: string) {
  fireEvent.click(headerRow(rowKey)?.querySelector(`[data-testid="grid-field-header-${fieldId}"]`) as HTMLElement);
  await act(() => jest.advanceTimersByTime(200));
  fireEvent.click(screen.getByTestId(`grid-field-${item}`));
  await act(() => jest.advanceTimersByTime(200));
}

async function clickNewProperty(rowKey: string) {
  fireEvent.click(headerRow(rowKey)?.querySelector('[data-testid="grid-new-property-button"]') as HTMLElement);
  await act(() => jest.advanceTimersByTime(200));
}

async function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await act(() => jest.advanceTimersByTime(200));
}

/**
 * The header rows whose cell of the field shows its property editor (the
 * editor's trigger is expanded; the field menu is closed by then), and how many
 * property editors are open in all.
 */
function propertyEditors(fieldId: string) {
  const triggers = document.querySelectorAll(`[data-column-id="${fieldId}"] [aria-expanded="true"]`);

  return {
    rows: Array.from(triggers).map((trigger) => trigger.closest('[data-row-key]')?.getAttribute('data-row-key')),
    open: document.querySelectorAll('[data-testid="property-menu-duplicate"]').length,
  };
}

test('a grouped grid opens one property editor, in the header row whose field menu was used', async () => {
  const data = fixture({ grouped: true });
  const rendered = await renderGrid(data);

  try {
    // Each group repeats the header row, and each copy holds the field menus.
    for (let index = 0; index < GROUP_COUNT; index += 1) {
      expect(headerRow(`group:group-${index}:header`)?.querySelector('[aria-haspopup="menu"]')).not.toBeNull();
    }

    await pickFieldMenuItem('group:group-1:header', 'field-1', 'edit-property');
    expect(propertyEditors('field-1')).toEqual({ rows: ['group:group-1:header'], open: 1 });

    // Pinned, the sticky header holds the field menus, and the editor moves there...
    await scrollPageTo(60);
    expect(propertyEditors('field-1')).toEqual({ rows: ['sticky-header'], open: 1 });
    // ...and back to its own row once unpinned.
    await scrollPageTo(0);
    expect(propertyEditors('field-1')).toEqual({ rows: ['group:group-1:header'], open: 1 });

    await pressEscape();
    expect(propertyEditors('field-1')).toEqual({ rows: [], open: 0 });

    // One opened from the sticky header moves to the grid's first header row once unpinned.
    await scrollPageTo(60);
    await pickFieldMenuItem('sticky-header', 'field-2', 'edit-property');
    expect(propertyEditors('field-2')).toEqual({ rows: ['sticky-header'], open: 1 });
    await scrollPageTo(0);
    expect(propertyEditors('field-2')).toEqual({ rows: ['group:group-0:header'], open: 1 });
  } finally {
    rendered.unmount();
    data.destroy();
  }
}, 15000); // Real grid, menus and timers: give a loaded CI runner room.

test('a grouped grid opens the editor of a property added from a header row in that row only', async () => {
  const data = fixture({ grouped: true });
  const rendered = await renderGrid(data);
  // The field a step added to the view.
  const fieldAddedBy = async (step: () => Promise<void>) => {
    const before = data.viewFieldIds();

    await step();
    return data.viewFieldIds().find((fieldId) => !before.includes(fieldId)) as string;
  };

  try {
    const left = await fieldAddedBy(() => pickFieldMenuItem('group:group-1:header', 'field-1', 'insert-left'));

    expect(data.viewFieldIds().indexOf(left)).toBe(data.viewFieldIds().indexOf('field-1') - 1);
    expect(propertyEditors(left)).toEqual({ rows: ['group:group-1:header'], open: 1 });
    await pressEscape();

    const right = await fieldAddedBy(() => pickFieldMenuItem('group:group-2:header', 'field-1', 'insert-right'));

    expect(data.viewFieldIds().indexOf(right)).toBe(data.viewFieldIds().indexOf('field-1') + 1);
    expect(propertyEditors(right)).toEqual({ rows: ['group:group-2:header'], open: 1 });
    await pressEscape();

    const added = await fieldAddedBy(() => clickNewProperty('group:group-1:header'));

    expect(data.viewFieldIds().at(-1)).toBe(added);
    expect(propertyEditors(added)).toEqual({ rows: ['group:group-1:header'], open: 1 });
  } finally {
    rendered.unmount();
    data.destroy();
  }
}, 15000); // Real grid, menus and timers: give a loaded CI runner room.

test("a grouped grid moves the property editor to its first header row when the editor's group collapses", async () => {
  const data = fixture({ grouped: true });
  const rendered = await renderGrid(data);

  try {
    await pickFieldMenuItem('group:group-1:header', 'field-2', 'edit-property');
    expect(propertyEditors('field-2')).toEqual({ rows: ['group:group-1:header'], open: 1 });

    // A collapsed group has no header row: the editor keeps one, the first.
    rendered.rerender(
      <Providers
        data={data}
        grouping={{
          ...data.grouping,
          visibleGroups: data.grouping.visibleGroups.map((group) =>
            group.id === 'group-1' ? { ...group, collapsed: true } : group
          ),
        }}
      >
        <GridOfView />
      </Providers>
    );
    await act(() => jest.advanceTimersByTime(200));
    expect(headerRow('group:group-1:header')).toBeNull();
    expect(propertyEditors('field-2')).toEqual({ rows: ['group:group-0:header'], open: 1 });
  } finally {
    rendered.unmount();
    data.destroy();
  }
}, 15000); // Real grid, menus and timers: give a loaded CI runner room.

test('an ungrouped grid shows its property editor in the header row in view as the sticky header pins and unpins', async () => {
  const data = fixture({ grouped: false });
  const rendered = await renderGrid(data);

  try {
    await pickFieldMenuItem('header', 'field-1', 'edit-property');
    expect(propertyEditors('field-1')).toEqual({ rows: ['header'], open: 1 });
    await scrollPageTo(60);
    expect(propertyEditors('field-1')).toEqual({ rows: ['sticky-header'], open: 1 });
    await scrollPageTo(0);
    expect(propertyEditors('field-1')).toEqual({ rows: ['header'], open: 1 });
    await pressEscape();
    expect(propertyEditors('field-1')).toEqual({ rows: [], open: 0 });

    await scrollPageTo(60);
    await pickFieldMenuItem('sticky-header', 'field-2', 'edit-property');
    expect(propertyEditors('field-2')).toEqual({ rows: ['sticky-header'], open: 1 });
    await scrollPageTo(0);
    expect(propertyEditors('field-2')).toEqual({ rows: ['header'], open: 1 });

    // Closed, it stays closed as the header pins and unpins.
    await pressEscape();
    await scrollPageTo(60);
    await scrollPageTo(0);
    expect(propertyEditors('field-2')).toEqual({ rows: [], open: 0 });

    // The New property column opens the new property's editor in its row.
    const before = data.viewFieldIds();

    await clickNewProperty('header');
    const added = data.viewFieldIds().find((fieldId) => !before.includes(fieldId)) as string;

    expect(propertyEditors(added)).toEqual({ rows: ['header'], open: 1 });
  } finally {
    rendered.unmount();
    data.destroy();
  }
}, 15000); // Real grid, menus and timers: give a loaded CI runner room.
