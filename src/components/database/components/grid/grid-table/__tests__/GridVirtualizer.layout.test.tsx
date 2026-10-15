import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, ReactNode } from 'react';

import GridVirtualizer from '../GridVirtualizer';

jest.mock('@/application/database-yjs', () => ({
  PADDING_END: 100,
  useDatabaseContext: () => mockDatabaseContext,
}));
jest.mock('@/components/database/grid/useGridContext', () => ({
  useGridContext: () => mockGridContext,
}));
jest.mock('@/components/database/components/grid/grid-row', () =>
  jest.requireActual('@/components/database/components/grid/grid-row/useRenderRows')
);
jest.mock('@/components/database/components/grid/grid-row/GridVirtualRow', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/grid/grid-row/GridLoadMoreRow', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/grid/grid-row/GridNewRow', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/grid/grid-group/GridGroupHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/grid/grid-column/useColumnResize', () => ({
  useColumnResize: () => ({ isResizing: false, handleResizeStart: jest.fn() }),
}));
jest.mock('@/components/database/components/grid/grid-table/useGridDnd', () => ({
  useGridDnd: () => null,
}));
jest.mock('@/components/database/components/grid/grid-table/useGridVirtualizer', () => ({
  PADDING_INLINE: 96,
  useGridVirtualizer: () => mockVirtualizers,
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div data-testid='sticky-overlay'>{children}</div>,
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar', () => ({
  __esModule: true,
  default: () => null,
}));

const mockDatabaseContext = { isDocumentBlock: true, embeddedHeight: 600 };
const mockGridContext = {
  rows: [],
  rowOrders: [] as unknown[] | undefined,
  setShowStickyHeader: jest.fn(),
  rowResizeStore: { subscribe: () => jest.fn() },
};
const mockVirtualizers = {
  parentRef: createRef<HTMLDivElement>(),
  virtualizer: {
    scrollElement: document.createElement('div'),
    getVirtualItems: () => [],
    getTotalSize: () => 72,
    options: { scrollMargin: 0 },
    measureElement: jest.fn(),
  },
  columnVirtualizer: {
    getVirtualItems: () => [],
    getTotalSize: () => 800,
    measure: jest.fn(),
  },
  scrollMarginTop: 0,
  isReady: true,
};

describe('GridVirtualizer layout work', () => {
  beforeEach(() => {
    mockDatabaseContext.isDocumentBlock = true;
    mockGridContext.rowOrders = [];
    mockVirtualizers.parentRef = createRef<HTMLDivElement>();
    mockVirtualizers.virtualizer.scrollElement = document.createElement('div');
    jest.clearAllMocks();
  });

  afterEach(() => jest.restoreAllMocks());

  it('does not read sticky-header geometry when an embedded grid mounts or scrolls', () => {
    const readRect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect');

    render(<GridVirtualizer columns={[]} />);
    expect(screen.queryByTestId('sticky-overlay')).toBeNull();
    fireEvent.scroll(mockVirtualizers.virtualizer.scrollElement);
    fireEvent.scroll(mockVirtualizers.virtualizer.scrollElement);

    expect(readRect).not.toHaveBeenCalled();
    expect(mockGridContext.setShowStickyHeader).not.toHaveBeenCalled();
  });

  it('still positions standalone sticky headers and removes their scroll listener on unmount', () => {
    mockDatabaseContext.isDocumentBlock = false;
    const readRect = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: 20, bottom: 500 } as DOMRect);
    const { unmount } = render(<GridVirtualizer columns={[]} />);
    const stickyHeader = screen.getByTestId('sticky-overlay').firstElementChild as HTMLElement;

    expect(stickyHeader.style.opacity).toBe('1');
    expect(mockGridContext.setShowStickyHeader).toHaveBeenLastCalledWith(true);

    readRect.mockReturnValue({ top: 100, bottom: 500 } as DOMRect);
    fireEvent.scroll(mockVirtualizers.virtualizer.scrollElement);
    expect(stickyHeader.style.opacity).toBe('0');
    expect(mockGridContext.setShowStickyHeader).toHaveBeenLastCalledWith(false);
    expect(readRect).toHaveBeenCalledTimes(2);

    unmount();
    fireEvent.scroll(mockVirtualizers.virtualizer.scrollElement);
    expect(readRect).toHaveBeenCalledTimes(2);
  });

  it('reserves the embedded height during loading and compacts after rows settle', () => {
    mockGridContext.rowOrders = undefined;
    const { rerender } = render(<GridVirtualizer columns={[]} />);
    const viewport = mockVirtualizers.parentRef.current!;

    expect(viewport.style.height).toBe('600px');
    expect(viewport.style.maxHeight).toBe('600px');

    mockGridContext.rowOrders = [];
    rerender(<GridVirtualizer columns={[]} />);
    expect(viewport.style.height).toBe('72px');
    expect(viewport.style.maxHeight).toBe('600px');
  });
});
