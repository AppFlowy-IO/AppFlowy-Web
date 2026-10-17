import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import SortList from '../SortList';

const mockReorder = jest.fn();
let mockSortIds = ['verification-sort', 'owner', 'date'];
let mockReadOnly = false;

jest.mock('@/application/database-yjs', () => ({
  useReadOnly: () => mockReadOnly,
  useSortsSelector: () => mockSortIds.map((id) => ({ id })),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useReorderSorts: () => mockReorder }));
jest.mock('../Sort', () => ({ __esModule: true, default: ({ sortId }: { sortId: string }) => <span>{sortId}</span> }));
// JSDOM has no scroll layout; keep the actual draggable/drop-target adapter.
jest.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({
  autoScrollForElements: () => () => undefined,
}));

function dragSort(sourceIndex: number, targetIndex: number, edge: 'top' | 'bottom') {
  const handles = screen.getAllByRole('button', { name: 'Reorder sort' });
  const source = handles[sourceIndex].parentElement!;
  const target = handles[targetIndex].parentElement!;
  const hitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
  const domRect = Object.getOwnPropertyDescriptor(globalThis, 'DOMRect');
  const bounds = jest.spyOn(target, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 140,
    left: 0,
    right: 300,
    width: 300,
    height: 40,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  });
  const data = new Map<string, string>();
  const dataTransfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()];
    },
    setDragImage: jest.fn(),
  };
  const dispatch = (element: HTMLElement, type: string, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY });

    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    fireEvent(element, event);
  };

  try {
    Object.defineProperty(globalThis, 'DOMRect', {
      configurable: true,
      value: {
        fromRect: ({ x = 0, y = 0, width = 0, height = 0 }: DOMRectInit) => ({
          x,
          y,
          width,
          height,
          top: y,
          bottom: y + height,
          left: x,
          right: x + width,
        }),
      },
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [handles[sourceIndex]],
    });
    dispatch(source, 'dragstart', 10);
    dispatch(target, 'dragover', edge === 'top' ? 101 : 139);
    dispatch(target, 'drop', edge === 'top' ? 101 : 139);
  } finally {
    dispatch(source, 'dragend', 10);
    bounds.mockRestore();
    if (domRect) Object.defineProperty(globalThis, 'DOMRect', domRect);
    else Reflect.deleteProperty(globalThis, 'DOMRect');
    if (hitTest) Object.defineProperty(document, 'elementsFromPoint', hitTest);
    else Reflect.deleteProperty(document, 'elementsFromPoint');
  }
}

beforeEach(() => {
  mockSortIds = ['verification-sort', 'owner', 'date'];
  mockReadOnly = false;
  mockReorder.mockReset();
});

it('moves native Verification with the same command and persisted order as other sorts', () => {
  const { rerender } = render(<SortList />);
  const handles = screen.getAllByRole('button', { name: 'Reorder sort' });

  expect(handles).toHaveLength(3);
  fireEvent.keyDown(handles[0], { key: 'ArrowDown' });
  expect(mockReorder).toHaveBeenCalledWith('verification-sort', 'owner');
  mockSortIds = ['owner', 'verification-sort', 'date'];
  rerender(<SortList />);
  expect(screen.getAllByRole('button', { name: 'Reorder sort' })[1].parentElement?.textContent).toBe(
    'verification-sort'
  );
});

it('reorders an ordinary sort across Verification in one native list', () => {
  render(<SortList />);
  fireEvent.keyDown(screen.getAllByRole('button', { name: 'Reorder sort' })[1], { key: 'ArrowUp' });
  expect(mockReorder).toHaveBeenCalledWith('owner', undefined);
});

it.each([
  { ids: ['verification-sort', 'owner', 'date'], source: 0, target: 2, edge: 'bottom' as const, previous: 'date' },
  { ids: ['owner', 'date', 'verification-sort'], source: 2, target: 0, edge: 'top' as const, previous: undefined },
])('drags native Verification in both directions', async ({ ids, source, target, edge, previous }) => {
  mockSortIds = ids;
  render(<SortList />);
  dragSort(source, target, edge);
  await waitFor(() => expect(mockReorder).toHaveBeenCalledWith('verification-sort', previous));
  expect(mockReorder).toHaveBeenCalledTimes(1);
});

it.each([0, 2])('ignores keyboard movement beyond list boundary %i', (index) => {
  render(<SortList />);
  fireEvent.keyDown(screen.getAllByRole('button', { name: 'Reorder sort' })[index], {
    key: index === 0 ? 'ArrowUp' : 'ArrowDown',
  });
  expect(mockReorder).not.toHaveBeenCalled();
});

it('omits edit handles in read-only views', () => {
  mockReadOnly = true;
  render(<SortList />);
  expect(screen.queryByRole('button', { name: 'Reorder sort' })).toBeNull();
});
