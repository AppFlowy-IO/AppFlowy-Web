import { act, cleanup, fireEvent, render } from '@testing-library/react';

import { BlockType } from '@/application/types';
import type { SimpleTableNode } from '@/components/editor/editor.type';

import { SimpleTableActionButtons } from '../SimpleTableActionButtons';
import { SimpleTableContext, type SimpleTableContextValue } from '../SimpleTableContext';

const mockEditor = { readOnly: false };

jest.mock('slate-react', () => ({ useSlateStatic: () => mockEditor }));
jest.mock('@/application/slate-yjs/command', () => ({ CustomEditor: {
  addTableRow: jest.fn(), addTableColumn: jest.fn(), addTableRowAndColumn: jest.fn(),
} }));

const node: SimpleTableNode = { blockId: 'table', type: BlockType.SimpleTableBlock, data: {}, children: [] };
const frames = new Map<number, FrameRequestCallback>();
const mutationObservers: { callback: MutationCallback; disconnect: jest.Mock }[] = [];
const resizeObservers: { callback: ResizeObserverCallback; disconnect: jest.Mock }[] = [];
const originalResizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');

function Harness({ readOnly = false, tableNode = node }: { readOnly?: boolean; tableNode?: SimpleTableNode }) {
  const context: SimpleTableContextValue = {
    tableNode, rowCount: 2, columnCount: 2, cellPositionById: new Map(),
    isHoveringTable: true, hoveringCell: null, readOnly,
    setHoveringCell: jest.fn(), isMenuOpen: false, setIsMenuOpen: jest.fn(),
  };

  return (
    <SimpleTableContext.Provider value={context}>
      <div className="simple-table-root-wrapper">
        <div className="simple-table-scroll-container"><table><tbody><tr><td /></tr><tr><td /></tr></tbody></table></div>
        <SimpleTableActionButtons />
      </div>
    </SimpleTableContext.Provider>
  );
}

describe('Simple table add-button lifecycle', () => {
  beforeEach(() => {
    frames.clear();
    mutationObservers.length = 0;
    resizeObservers.length = 0;
    mockEditor.readOnly = false;
    let nextFrame = 0;

    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
    jest.spyOn(window, 'MutationObserver').mockImplementation((callback) => {
      const observer = { callback, observe: jest.fn(), disconnect: jest.fn(), takeRecords: () => [] };

      mutationObservers.push(observer);
      return observer;
    });
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, writable: true, value: jest.fn((callback) => {
      const observer = { callback, observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };

      resizeObservers.push(observer);
      return observer;
    }) });
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      /** @this {HTMLElement} */
      function (this: HTMLElement) {
        const width = this.tagName === 'TABLE' ? 320 : 760;

        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 66, width, height: 66, toJSON: () => ({}) };
      }
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    if (originalResizeObserver) Object.defineProperty(window, 'ResizeObserver', originalResizeObserver);
    else Reflect.deleteProperty(window, 'ResizeObserver');
  });

  it('shows correctly positioned add buttons when a read-only table becomes editable', () => {
    const { container, rerender } = render(<Harness readOnly />);

    expect(container.querySelector('.simple-table-add-row-btn')).toBeNull();
    rerender(<Harness />);
    const button = container.querySelector<HTMLElement>('.simple-table-add-row-btn');

    expect(button).not.toBeNull();
    expect(button?.style.top).toBe('66px');
    expect(button?.style.width).toBe('312px');
  });

  it('keeps its observers attached when table data changes without changing the table identity', () => {
    const { rerender } = render(<Harness />);

    rerender(<Harness tableNode={{ ...node, data: { enable_header_row: true } }} />);
    expect(mutationObservers).toHaveLength(1);
    expect(resizeObservers).toHaveLength(1);
    expect(mutationObservers[0].disconnect).not.toHaveBeenCalled();
    expect(resizeObservers[0].disconnect).not.toHaveBeenCalled();
  });

  it('disconnects observers and cancels queued measurements and scrolling when unmounted', () => {
    const { container, unmount } = render(<Harness />);

    act(() => mutationObservers[0].callback([], {} as MutationObserver));
    fireEvent.click(container.querySelector('.simple-table-add-col-btn')!);
    expect(frames.size).toBe(2);
    unmount();
    expect(mutationObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
});
