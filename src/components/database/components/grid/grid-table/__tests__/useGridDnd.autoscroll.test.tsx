import { renderHook } from '@testing-library/react';


import { autoScrollForSharedElement } from '@/components/database/components/drag-and-drop/autoScrollForSharedElement';

import { useGridDnd } from '../useGridDnd';

import type { Virtualizer } from '@tanstack/react-virtual';

const mockAutoScrollCleanups: jest.Mock[] = [];
const mockAutoScroll = jest.fn((_args: { element: Element; canScroll?: (args: unknown) => boolean }) => {
  const cleanup = jest.fn();

  mockAutoScrollCleanups.push(cleanup);
  return cleanup;
});

jest.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({
  autoScrollForElements: (args: { element: Element; canScroll?: (args: unknown) => boolean }) => mockAutoScroll(args),
}));
jest.mock('@atlaskit/pragmatic-drag-and-drop-live-region', () => ({ announce: jest.fn(), cleanup: jest.fn() }));
jest.mock('@/application/database-yjs', () => ({
  useDatabaseViewId: () => 'grid-view',
  useReadOnly: () => false,
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useReorderColumnDispatch: () => jest.fn(),
  useReorderRowDispatch: () => jest.fn(),
}));
jest.mock('@/components/database/grid/useGridContext', () => ({
  useGridContext: () => ({ isGrouped: false, rows: [], setRows: jest.fn() }),
}));

function virtualizers(scrollElement: Element) {
  const virtualizer = { scrollElement, scrollToIndex: jest.fn() };

  return {
    rows: virtualizer as unknown as Virtualizer<Element, Element>,
    columns: virtualizer as unknown as Virtualizer<HTMLDivElement, Element>,
  };
}

beforeEach(() => {
  mockAutoScroll.mockClear();
  mockAutoScrollCleanups.length = 0;
});

describe('grid auto-scroll', () => {
  it('registers the grid scroller once for row and column drags, and releases it on unmount', () => {
    const scroller = document.createElement('div');
    const { rows, columns } = virtualizers(scroller);
    const { result, unmount } = renderHook(() => useGridDnd([], rows, columns));

    // Two registrations on one element made the library log both in development,
    // and an open inspector kept the logged scroller and its detached grid alive.
    expect(mockAutoScroll).toHaveBeenCalledTimes(1);
    const [{ element, canScroll }] = mockAutoScroll.mock.calls[0];

    expect(element).toBe(scroller);
    expect(canScroll?.({ source: { data: { instanceId: result.current.rowInstanceId } } })).toBe(true);
    expect(canScroll?.({ source: { data: { instanceId: result.current.columnInstanceId } } })).toBe(true);
    expect(canScroll?.({ source: { data: { instanceId: Symbol('another grid') } } })).toBe(false);

    unmount();
    expect(mockAutoScrollCleanups).toHaveLength(1);
    expect(mockAutoScrollCleanups[0]).toHaveBeenCalledTimes(1);
  });

  it('keeps one registration per element until its last user releases it, whatever the order', () => {
    const scroller = document.createElement('div');
    const releaseRows = autoScrollForSharedElement(scroller, () => false);
    const releaseColumns = autoScrollForSharedElement(scroller, () => true);

    expect(mockAutoScroll).toHaveBeenCalledTimes(1);
    expect(mockAutoScroll.mock.calls[0][0].canScroll?.({})).toBe(true);

    releaseColumns();
    expect(mockAutoScroll.mock.calls[0][0].canScroll?.({})).toBe(false);
    expect(mockAutoScrollCleanups[0]).not.toHaveBeenCalled();
    releaseRows();
    // A release called twice (the hooks also clean up before re-registering) changes nothing.
    releaseRows();
    expect(mockAutoScrollCleanups[0]).toHaveBeenCalledTimes(1);

    autoScrollForSharedElement(scroller, () => true);
    expect(mockAutoScroll).toHaveBeenCalledTimes(2);
    releaseColumns();
    expect(mockAutoScrollCleanups[1]).not.toHaveBeenCalled();
  });
});
