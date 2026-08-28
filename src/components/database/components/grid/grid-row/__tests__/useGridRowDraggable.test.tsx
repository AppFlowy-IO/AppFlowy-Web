import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { renderHook } from '@testing-library/react';

import { useGridRowDraggable } from '@/components/database/components/grid/grid-row/useGridRowDraggable';

jest.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: jest.fn(({ element }: { element: HTMLElement }) => {
    element.setAttribute('draggable', 'true');
    return () => element.removeAttribute('draggable');
  }),
}));

const mockDraggable = draggable as jest.MockedFunction<typeof draggable>;

describe('useGridRowDraggable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes draggable behavior while disabled and restores it when re-enabled', () => {
    const element = document.createElement('div');
    const dragHandle = document.createElement('div');
    const elementRef = { current: element };
    const dragHandleRef = { current: dragHandle };
    const setState = jest.fn();
    const { rerender } = renderHook(
      ({ enabled }) =>
        useGridRowDraggable({
          elementRef,
          dragHandleRef,
          enabled,
          instanceId: Symbol.for('row-instance'),
          rowId: 'row-1',
          rowIndex: 0,
          setState,
        }),
      { initialProps: { enabled: true } }
    );

    expect(element.getAttribute('draggable')).toBe('true');
    expect(mockDraggable).toHaveBeenCalledTimes(1);
    expect(mockDraggable).toHaveBeenCalledWith(expect.objectContaining({ element, dragHandle }));

    rerender({ enabled: false });

    expect(element.getAttribute('draggable')).toBeNull();
    expect(mockDraggable).toHaveBeenCalledTimes(1);

    rerender({ enabled: true });

    expect(element.getAttribute('draggable')).toBe('true');
    expect(mockDraggable).toHaveBeenCalledTimes(2);
  });
});
