// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { FieldType } from '@/application/database-yjs/database.type';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { VersionHistoryDialog } from '@/components/_shared/version-history';
import { AFConfigContext } from '@/components/main/app.hooks';

import { DatabaseHistoryPreview } from '../DatabaseHistoryPreviewProvider';

// Keep the actual grid, useGridVirtualizer, and TanStack implementation. Only
// browser layout/observer APIs absent from jsdom receive deterministic geometry.
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('preact', () => jest.requireActual(require.resolve('preact').replace('preact.module.js', 'preact.js')));
jest.mock('preact/hooks', () => jest.requireActual(require.resolve('preact/hooks').replace('hooks.module.js', 'hooks.js')));
jest.mock('preact/compat', () => jest.requireActual(require.resolve('preact/compat').replace('compat.module.js', 'compat.js')));
jest.mock('@/components/database/fullcalendar/FullCalendar.styles.scss', () => ({}));
jest.mock('@/utils/runtime-config', () => ({
  isDevelopmentOrTestEnvironment: () => true,
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const VIEWPORT_HEIGHT = 400;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_TOP = 136;
const ROW_HEIGHT = 36;
let rowCount = 4;
const originalResizeObserver = global.ResizeObserver;
const originalIntersectionObserver = global.IntersectionObserver;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function elementHeight(element: HTMLElement) {
  if (element.matches('[data-index], .grid-cell')) return ROW_HEIGHT;
  if (element.classList.contains('appflowy-custom-scroller')) return (rowCount + 2) * ROW_HEIGHT;
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
    scrollHeight: { get(this: HTMLElement) {
      if (this.dataset.testid === 'database-history-preview') {
        return Math.max(VIEWPORT_HEIGHT, (rowCount + 2) * ROW_HEIGHT);
      }

      return elementHeight(this);
    } },
    scrollTo: { value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
      if (options.left !== undefined) this.scrollLeft = options.left;
    } },
    scroll: { value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTo(options);
    } },
  };

  for (const [name, descriptor] of Object.entries(geometry)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, configurable: true });
  }
});

beforeEach(() => {
  rowCount = 4;
  const layout = {
    getBoundingClientRect(this: HTMLElement) {
      const viewport = this.closest<HTMLElement>('[data-testid="database-history-preview"]');
      const top = viewport ? VIEWPORT_TOP +
        (this.classList.contains('appflowy-custom-scroller') ? 40 - viewport.scrollTop : 0) : 0;
      const height = elementHeight(this);

      return { x: 0, y: top, left: 0, top, width: VIEWPORT_WIDTH, height, right: VIEWPORT_WIDTH,
        bottom: top + height, toJSON: () => ({}) };
    },
  };

  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(layout.getBoundingClientRect);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
  global.IntersectionObserver = originalIntersectionObserver;
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

function snapshot(count: number) {
  rowCount = count;
  const root = new Y.Doc({ guid: `history:virtualization:${count}` }) as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const fieldOrders = new Y.Array();
  const fieldSettings = new Y.Map();
  const rows: Record<string, YDoc> = {};

  for (const [id, type] of [['title', FieldType.RichText], ['done', FieldType.Checkbox]] as const) {
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

  for (let index = 1; index <= count; index++) {
    const id = `row-${index}`;

    rowOrders.push([{ id, height: ROW_HEIGHT }]);
    rows[id] = createRowDoc(id, 'database', {
      title: createCell(FieldType.RichText, `Historical value ${index}`),
      done: createCell(FieldType.Checkbox, 'No'),
    });
  }

  view.set(YjsDatabaseKey.id, 'saved-grid');
  view.set(YjsDatabaseKey.name, 'Saved grid');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.groups, new Y.Array());
  view.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set('saved-grid', view);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, new Y.Map());
  root.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return { root, rows };
}

function mountPreview(data: ReturnType<typeof snapshot>) {
  return render(
    <AFConfigContext.Provider value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}>
      <VersionHistoryDialog open onClose={() => undefined} title='Historical database' testId='history-dialog' sidebar={<span>Version history</span>}>
        <DatabaseHistoryPreview {...data} workspaceId='workspace' databaseId='database' databasePageId='saved-grid' />
      </VersionHistoryDialog>
    </AFConfigContext.Provider>
  );
}

test('a four-row snapshot fitting inside the dialog renders every historical value read-only', async () => {
  const data = snapshot(4);
  const beforeRoot = Y.encodeStateAsUpdate(data.root);
  const beforeRows = Object.values(data.rows).map((row) => Y.encodeStateAsUpdate(row));
  const rendered = mountPreview(data);

  try {
    const viewport = screen.getByTestId('database-history-preview');

    // No ancestor overflows. The former heuristic therefore had no scroll
    // element, although the viewport had enough room for all four rows.
    expect(viewport.scrollHeight).toBe(viewport.clientHeight);
    for (let index = 1; index <= 4; index++) {
      await waitFor(() => expect(screen.getByText(`Historical value ${index}`)).toBeVisible());
    }

    viewport.querySelectorAll('[role="checkbox"]').forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.doubleClick(screen.getByText('Historical value 1'));
    fireEvent.keyDown(viewport, { key: 'Delete' });
    expect(viewport.querySelector('[contenteditable="true"]')).toBeNull();
    expect(Y.encodeStateAsUpdate(data.root)).toEqual(beforeRoot);
    expect(Object.values(data.rows).map((row) => Y.encodeStateAsUpdate(row))).toEqual(beforeRows);
  } finally {
    rendered.unmount();
    data.root.destroy();
    Object.values(data.rows).forEach((row) => row.destroy());
  }
});

test('scrolling the history viewport changes the real virtualized row window', async () => {
  const data = snapshot(250);
  const beforeRoot = Y.encodeStateAsUpdate(data.root);
  const rendered = mountPreview(data);

  try {
    await waitFor(() => expect(screen.getByText('Historical value 1')).toBeVisible());
    expect(screen.queryByText('Historical value 150')).not.toBeInTheDocument();
    const viewport = screen.getByTestId('database-history-preview');

    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    const stickyHeader = viewport.querySelector('.grid-sticky-header');

    expect(stickyHeader).not.toBeNull();
    expect(stickyHeader).toHaveStyle({ opacity: '0' });
    // The modal starts below the global page header. Once the normal header
    // leaves this viewport, the sticky header must appear at the modal's top.
    fireEvent.scroll(viewport, { target: { scrollTop: 80 } });
    await waitFor(() => expect(stickyHeader).toHaveStyle({ opacity: '1' }));
    expect(stickyHeader).toBeVisible();
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    await waitFor(() => expect(stickyHeader).toHaveStyle({ opacity: '0' }));

    fireEvent.scroll(viewport, { target: { scrollTop: 150 * ROW_HEIGHT } });
    await waitFor(() => expect(screen.getByText('Historical value 150')).toBeVisible());
    expect(screen.queryByText('Historical value 1')).not.toBeInTheDocument();
    expect(viewport.querySelectorAll('[data-row-id]').length).toBeLessThan(60);
    expect(Y.encodeStateAsUpdate(data.root)).toEqual(beforeRoot);
  } finally {
    rendered.unmount();
    data.root.destroy();
    Object.values(data.rows).forEach((row) => row.destroy());
  }
});
