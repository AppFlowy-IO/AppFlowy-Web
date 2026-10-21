import { act, render, screen } from '@testing-library/react';

import { useDatabaseContext } from '@/application/database-yjs';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';

import { useGridVirtualizer } from '../useGridVirtualizer';

jest.mock('@/application/database-yjs', () => ({
  PADDING_END: 100,
  useDatabaseContext: jest.fn(() => ({ isDocumentBlock: true })),
}));
jest.mock('@/components/database/components/grid/grid-row', () =>
  jest.requireActual('@/components/database/components/grid/grid-row/useRenderRows')
);
jest.mock('@/components/database/components/grid/grid-column/useRenderFields', () => ({
  GridColumnType: { Field: 0, NewProperty: 1 },
}));
jest.mock('@/components/global-comment/utils', () => ({ getScrollParent: jest.fn() }));
jest.mock('@/utils/platform', () => ({ getPlatform: () => ({ isMobile: false }) }));

const observers = new Set<TestResizeObserver>();

class TestResizeObserver implements ResizeObserver {
  targets = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {
    observers.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
  resize(target: Element, height: number) {
    if (!this.targets.has(target)) return;
    this.callback([{ target, borderBoxSize: [{ blockSize: height, inlineSize: 800 }] } as ResizeObserverEntry], this);
  }
}

const columns = [{ type: 0, fieldId: 'title', width: 180 }];

function Harness({ rows, hiddenRow }: { rows: RenderRow[]; hiddenRow?: string }) {
  const { parentRef, virtualizer, isReady } = useGridVirtualizer({ data: rows, columns });

  return (
    <div ref={parentRef} data-testid='viewport'>
      <output data-testid='ready'>{String(isReady)}</output>
      <output data-testid='total-height'>{virtualizer.getTotalSize()}</output>
      {virtualizer
        .getVirtualItems()
        .filter((row) => row.key !== hiddenRow)
        .map((row) => (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={row.index}
            data-testid={String(row.key)}
            data-start={row.start}
            data-measured-row
          >
            Wrapped text or asynchronously loaded media
          </div>
        ))}
    </div>
  );
}

function resizeRow(key: string, height: number) {
  const element = screen.getByTestId(key);

  act(() => observers.forEach((observer) => observer.resize(element, height)));
}

describe('deferred grid row measurement', () => {
  const originalResizeObserver = window.ResizeObserver;
  const originalScrollTo = HTMLElement.prototype.scrollTo;
  let rowLayoutReads: number;

  beforeEach(() => {
    rowLayoutReads = 0;
    jest.mocked(useDatabaseContext).mockReturnValue({ isDocumentBlock: true } as ReturnType<typeof useDatabaseContext>);
    window.ResizeObserver = TestResizeObserver;
    HTMLElement.prototype.scrollTo = jest.fn();
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      // eslint-disable-next-line no-invalid-this
      if (this.hasAttribute('data-measured-row')) {
        rowLayoutReads += 1;
        return 36;
      }

      return 600;
    });
    jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    window.ResizeObserver = originalResizeObserver;
    HTMLElement.prototype.scrollTo = originalScrollTo;
    observers.clear();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('mounts rows without synchronous layout reads and updates positions from observed border boxes', () => {
    render(
      <Harness
        rows={[
          { type: RenderRowType.Row, rowId: 'text' },
          { type: RenderRowType.Row, rowId: 'image' },
          { type: RenderRowType.Row, rowId: 'last' },
        ]}
      />
    );
    expect(rowLayoutReads).toBe(0);
    expect(screen.getByTestId('total-height').textContent).toBe('108');
    resizeRow('text', 120);
    resizeRow('image', 256);
    expect(screen.getByTestId('image').getAttribute('data-start')).toBe('120');
    expect(screen.getByTestId('last').getAttribute('data-start')).toBe('376');
    expect(screen.getByTestId('total-height').textContent).toBe('412');
    resizeRow('text', 36);
    expect(screen.getByTestId('last').getAttribute('data-start')).toBe('292');
    expect(rowLayoutReads).toBe(0);
  });

  it('preserves a measured height across unmount/remount and follows the row key when reordered', () => {
    const rows = [
      { type: RenderRowType.Row, rowId: 'tall' },
      { type: RenderRowType.Row, rowId: 'short' },
    ];
    const { rerender } = render(<Harness rows={rows} />);

    resizeRow('tall', 200);
    rerender(<Harness rows={rows} hiddenRow='tall' />);
    rerender(<Harness rows={[rows[1], rows[0]]} />);
    expect(screen.getByTestId('tall').getAttribute('data-start')).toBe('36');
    expect(screen.getByTestId('total-height').textContent).toBe('236');
    expect(rowLayoutReads).toBe(0);
    resizeRow('tall', 160);
    expect(screen.getByTestId('total-height').textContent).toBe('196');
  });

  it('uses distinct estimates for group controls and never reuses a replaced row height', () => {
    const { rerender } = render(
      <Harness
        rows={[
          { type: RenderRowType.GroupHeader, key: 'group' },
          { type: RenderRowType.Row, rowId: 'old' },
          { type: RenderRowType.GroupSeparator, key: 'separator' },
        ]}
      />
    );

    expect(screen.getByTestId('old').getAttribute('data-start')).toBe('44');
    expect(screen.getByTestId('total-height').textContent).toBe('92');
    resizeRow('old', 200);
    rerender(<Harness rows={[{ type: RenderRowType.Row, rowId: 'replacement' }]} />);
    expect(screen.getByTestId('total-height').textContent).toBe('36');
    resizeRow('replacement', 72);
    expect(screen.getByTestId('total-height').textContent).toBe('72');
    expect(rowLayoutReads).toBe(0);
  });

  it('positions a full-page grid after rendering without reading its offset during commit', async () => {
    jest.useFakeTimers();
    jest.mocked(useDatabaseContext).mockReturnValue({ isDocumentBlock: false } as ReturnType<typeof useDatabaseContext>);
    const measure = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        // eslint-disable-next-line no-invalid-this
        return { top: this.dataset.testid === 'viewport' ? 120 : 20 } as DOMRect;
      });

    render(
      <div className='appflowy-scroll-container'>
        <Harness rows={[{ type: RenderRowType.Row, rowId: 'first' }]} />
      </div>
    );
    expect(measure).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready').textContent).toBe('false');
    await act(() => jest.advanceTimersByTime(64));
    expect(screen.getByTestId('ready').textContent).toBe('true');
    expect(screen.getByTestId('first').getAttribute('data-start')).toBe('100');
  });
});
