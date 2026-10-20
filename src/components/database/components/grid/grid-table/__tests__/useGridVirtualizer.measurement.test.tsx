import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';

import { useGridVirtualizer } from '../useGridVirtualizer';

jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('@/application/database-yjs', () => ({
  PADDING_END: 100,
  useDatabaseContext: () => ({ isDocumentBlock: true }),
  useReadOnly: () => true,
  useSortsSelector: () => [],
  useRowData: () => mockDatabaseRow,
}));
jest.mock('@/components/database/components/grid/grid-column/useRenderFields', () => ({
  GridColumnType: { Field: 0, NewProperty: 1 },
}));
jest.mock('@/components/database/components/grid/grid-row', () =>
  jest.requireActual('@/components/database/components/grid/grid-row/useRenderRows')
);
jest.mock('@/components/global-comment/utils', () => ({ getScrollParent: jest.fn() }));
jest.mock('@/utils/platform', () => ({ getPlatform: () => ({ isMobile: false }) }));
jest.mock('@/components/database/components/grid/grid-column/GridVirtualColumn', () => ({
  __esModule: true,
  default: () => <div className='grid-cell'>A cell whose text can wrap or contain loaded media</div>,
}));
jest.mock('@/components/database/components/grid/controls/HoverControls', () => ({ HoverControls: () => null }));
jest.mock('@/components/database/components/sorts/ClearSortingConfirm', () => ({ ClearSortingConfirm: () => null }));
jest.mock('@/components/database/components/grid/grid-row/useGridRowDraggable', () => ({
  useGridRowDraggable: jest.fn(),
}));
jest.mock('@/components/database/components/grid/drag-and-drop/GridDragContext', () => ({
  GridDragState: { IDLE: 'idle', DRAGGING: 'dragging', IS_OVER: 'is-over' },
  useGridDragContext: () => ({ registerRow: jest.fn(), rowInstanceId: Symbol.for('test-grid') }),
}));
jest.mock('@/components/database/grid/useGridContext', () => ({
  useGridContext: () => ({ isGrouped: false, rowResizeStore: { report: jest.fn() } }),
  useGridInteractionActions: () => ({ setHoverRowKey: jest.fn() }),
  useIsGridRowActive: () => false,
}));

const mockDatabaseRow = new Y.Doc().getMap<Y.Map<string>>('row');
const mockCells = new Y.Map<string>();

mockDatabaseRow.set('cells', mockCells);
mockCells.set('title', 'Initial title');

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

function Harness({ rows }: { rows: RenderRow[] }) {
  const { parentRef, virtualizer, columnVirtualizer } = useGridVirtualizer({ data: rows, columns });

  return (
    <div ref={parentRef} data-measured-height='600'>
      <output data-testid='total-height'>{virtualizer.getTotalSize()}</output>
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          ref={virtualizer.measureElement}
          data-index={row.index}
          data-start={row.start}
          data-testid={String(row.key)}
        >
          <GridVirtualRow
            row={row}
            data={rows}
            columns={columns}
            columnItems={columnVirtualizer.getVirtualItems()}
            totalSize={columnVirtualizer.getTotalSize()}
          />
        </div>
      ))}
    </div>
  );
}

function resizeRow(rowId: string, height: number) {
  const row = screen.getByTestId(rowId);

  act(() => observers.forEach((observer) => observer.resize(row, height)));
}

describe('grid row measurement', () => {
  const originalResizeObserver = window.ResizeObserver;
  const originalScrollTo = HTMLElement.prototype.scrollTo;

  beforeEach(() => {
    window.ResizeObserver = TestResizeObserver;
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      // The getter receives the measured DOM element as its receiver.
      // eslint-disable-next-line no-invalid-this
      return Number(this.dataset.measuredHeight ?? 36);
    });
    jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    HTMLElement.prototype.scrollTo = jest.fn();
  });

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver;
    HTMLElement.prototype.scrollTo = originalScrollTo;
    observers.clear();
    jest.restoreAllMocks();
  });

  it('updates row positions when wrapping or loaded media changes the observed row border box', () => {
    render(
      <Harness
        rows={[
          { type: RenderRowType.Row, rowId: 'text-row' },
          { type: RenderRowType.Row, rowId: 'image-row' },
          { type: RenderRowType.Row, rowId: 'last-row' },
        ]}
      />
    );

    expect(screen.getByTestId('total-height').textContent).toBe('108');
    resizeRow('text-row', 120);
    expect(screen.getByTestId('image-row').getAttribute('data-start')).toBe('120');
    expect(screen.getByTestId('total-height').textContent).toBe('192');

    resizeRow('image-row', 256);
    expect(screen.getByTestId('last-row').getAttribute('data-start')).toBe('376');
    expect(screen.getByTestId('total-height').textContent).toBe('412');

    resizeRow('text-row', 36);
    expect(screen.getByTestId('image-row').getAttribute('data-start')).toBe('36');
    expect(screen.getByTestId('last-row').getAttribute('data-start')).toBe('292');
  });

  it('measures replacement rows independently when the active view changes', () => {
    const { rerender } = render(<Harness rows={[{ type: RenderRowType.Row, rowId: 'old-row' }]} />);

    resizeRow('old-row', 200);
    expect(screen.getByTestId('total-height').textContent).toBe('200');

    rerender(<Harness rows={[{ type: RenderRowType.Row, rowId: 'replacement-row' }]} />);
    expect(screen.getByTestId('total-height').textContent).toBe('36');
    resizeRow('replacement-row', 72);
    expect(screen.getByTestId('total-height').textContent).toBe('72');
  });

  it('updates rendered row geometry without scanning cell rectangles on data or resize events', () => {
    const cellRectRead = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect');

    render(<Harness rows={[{ type: RenderRowType.Row, rowId: 'edited-row' }]} />);
    expect(screen.getByTestId('grid-row-edited-row').querySelectorAll('.grid-cell')).toHaveLength(1);

    act(() => {
      mockCells.set('title', 'Updated text that wraps across several lines');
    });
    resizeRow('edited-row', 144);

    expect(screen.getByTestId('total-height').textContent).toBe('144');
    expect(cellRectRead.mock.instances.filter((element) => element.classList.contains('grid-cell'))).toHaveLength(0);
  });
});
