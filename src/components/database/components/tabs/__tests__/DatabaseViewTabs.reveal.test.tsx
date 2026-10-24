import { expect } from '@jest/globals';
import { act, render } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { DatabaseViewTabs } from '@/components/database/components/tabs/DatabaseViewTabs';

jest.mock('@/components/_shared/reorder/useReorderableItem', () => ({
  useReorderableItem: () => ({
    dragState: { type: 'idle' },
    shouldSuppressClick: () => false,
  }),
}));

// Each tab item renders one icon: its calls count the tab renders.
const mockTabIconRender = jest.fn();

jest.mock('@/components/_shared/view-icon/PageIcon', () => () => {
  mockTabIconRender();
  return null;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const resizeCallbacks = new Set<() => void>();

class ResizeObserverMock {
  constructor(private readonly callback: () => void) {}

  observe = jest.fn(() => resizeCallbacks.add(this.callback));

  unobserve = jest.fn();

  disconnect = jest.fn(() => resizeCallbacks.delete(this.callback));
}

// A 300px strip of 100px tabs: tab i spans content [i·100, i·100 + 100).
const STRIP_WIDTH = 300;
let stripWidth = STRIP_WIDTH;
const TAB_WIDTH = 100;
const TAB_COUNT = 12;
const viewIds = Array.from({ length: TAB_COUNT }, (_, index) => `view-${index}`);

function scroller() {
  return document.querySelector<HTMLElement>('.appflowy-hidden-scroller');
}

function rect(left: number, width: number): DOMRect {
  return { left, width, right: left + width, top: 0, bottom: 34, height: 34, x: left, y: 0, toJSON: () => ({}) };
}

/** The strip at x = 0, and each tab at its content position minus the strip's scroll offset. */
function measure(element: HTMLElement): DOMRect {
  const strip = scroller();

  if (element === strip) return rect(0, stripWidth);
  const index = viewIds.indexOf(element.dataset.testid?.replace('view-tab-', '') ?? '');

  return index === -1 ? rect(0, 0) : rect(index * TAB_WIDTH - (strip?.scrollLeft ?? 0), TAB_WIDTH);
}

function createViews() {
  const doc = new Y.Doc();
  const views = doc.getMap<YDatabaseView>('views');

  viewIds.forEach((viewId) => {
    const view = new Y.Map() as YDatabaseView;

    view.set(YjsDatabaseKey.id, viewId);
    view.set(YjsDatabaseKey.name, viewId);
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
    views.set(viewId, view);
  });
  return views;
}

function renderTabs(props: {
  selectedViewId: string;
  pendingScrollToViewId?: string | null;
  setPendingScrollToViewId?: jest.Mock;
}) {
  const views = createViews();
  const element = (selectedViewId: string, pending = props.pendingScrollToViewId) => (
    <DatabaseViewTabs
      databasePageId={viewIds[0]}
      menuViewId={null}
      readOnly
      selectedViewId={selectedViewId}
      setDeleteConfirmOpen={jest.fn()}
      setMenuViewId={jest.fn()}
      setRenameView={jest.fn()}
      setSelectedViewId={jest.fn()}
      viewIds={viewIds}
      views={views}
      visibleViewIds={viewIds}
      pendingScrollToViewId={pending}
      setPendingScrollToViewId={props.setPendingScrollToViewId}
    />
  );
  const result = render(element(props.selectedViewId));

  return {
    ...result,
    select: (viewId: string) => result.rerender(element(viewId, null)),
    addTab: (viewId: string) => result.rerender(element(props.selectedViewId, viewId)),
  };
}

describe('DatabaseViewTabs active tab reveal', () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const scrollIntoView = jest.fn();

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this === scroller() ? stripWidth : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this === scroller() ? TAB_COUNT * TAB_WIDTH : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      get(this: HTMLElement) {
        return () => measure(this);
      },
    });
  });

  beforeEach(() => {
    scrollIntoView.mockClear();
    mockTabIconRender.mockClear();
    stripWidth = STRIP_WIDTH;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
    delete (HTMLElement.prototype as { scrollWidth?: unknown }).scrollWidth;
    delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  });

  it('scrolls the strip on mount so an active tab past its end is fully visible', () => {
    renderTabs({ selectedViewId: 'view-9' });

    // End of tab 9 (1000) plus the 16px edge padding, minus the strip width.
    expect(scroller()?.scrollLeft).toBe(9 * TAB_WIDTH + TAB_WIDTH + 16 - STRIP_WIDTH);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('reveals a newly selected tab without moving any ancestor', () => {
    const { select } = renderTabs({ selectedViewId: 'view-9' });

    select('view-1');
    expect(scroller()?.scrollLeft).toBe(1 * TAB_WIDTH - 16);
    select('view-11');
    expect(scroller()?.scrollLeft).toBe(TAB_COUNT * TAB_WIDTH - STRIP_WIDTH);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('reveals the active tab again when the strip narrows after mount', () => {
    renderTabs({ selectedViewId: 'view-8' });

    expect(scroller()?.scrollLeft).toBe(8 * TAB_WIDTH + TAB_WIDTH + 16 - STRIP_WIDTH);
    // The toolbar beside the strip renders and takes 100px.
    stripWidth = 200;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(scroller()?.scrollLeft).toBe(8 * TAB_WIDTH + TAB_WIDTH + 16 - 200);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('reveals from the resize observer of the strip, without re-rendering any tab', () => {
    renderTabs({ selectedViewId: 'view-8' });
    const tabRenders = mockTabIconRender.mock.calls.length;

    expect(tabRenders).toBeGreaterThanOrEqual(TAB_COUNT);
    stripWidth = 200;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(scroller()?.scrollLeft).toBe(8 * TAB_WIDTH + TAB_WIDTH + 16 - 200);
    expect(mockTabIconRender).toHaveBeenCalledTimes(tabRenders);
    // One observer for the strip (reveal and scroll buttons) and one for the tab row.
    expect(resizeCallbacks.size).toBe(2);
  });

  it('leaves the strip where it is when the active tab is already visible', () => {
    renderTabs({ selectedViewId: 'view-1' });

    expect(scroller()?.scrollLeft).toBe(0);
  });

  it('reveals a just-added tab through the strip as well', () => {
    const setPendingScrollToViewId = jest.fn();
    const { addTab } = renderTabs({ selectedViewId: 'view-0', setPendingScrollToViewId });

    expect(scroller()?.scrollLeft).toBe(0);
    addTab('view-6');

    expect(scroller()?.scrollLeft).toBe(6 * TAB_WIDTH + TAB_WIDTH + 16 - STRIP_WIDTH);
    expect(setPendingScrollToViewId).toHaveBeenCalledWith(null);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('marks each tab for the visual parity probe', () => {
    const { container } = renderTabs({ selectedViewId: 'view-0' });

    // The content column is the whole tab row (tabs and toolbar), marked by
    // DatabaseTabs, not this strip.
    expect(container.querySelectorAll('[data-parity-id="dash-content-column"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-parity-id="dash-view-tab"]')).toHaveLength(TAB_COUNT);
  });
});
