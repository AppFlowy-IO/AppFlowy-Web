import { render } from '@testing-library/react';

import { Card } from '@/components/database/components/board/card/Card';
import { CardType } from '@/components/database/components/board/column/CardList';
import { useCardsDrag } from '@/components/database/components/board/column/useCardsDrag';
import {
  BoardDragContext,
  BoardDragContextValue,
} from '@/components/database/components/board/drag-and-drop/board-context';

type DropTargetArgs = {
  canDrop: (args: { source: { data: Record<string, unknown> } }) => boolean;
  getData?: (args: { input: unknown; element: HTMLElement }) => Record<string | symbol, unknown>;
  onDragEnter?: (args: { source: { data: Record<string, unknown> }; self: { data: Record<string, unknown> } }) => void;
};
type DraggableArgs = { getInitialData: () => Record<string, unknown> };

const mockDropTargets: DropTargetArgs[] = [];
const mockDraggables: DraggableArgs[] = [];

jest.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: (args: DraggableArgs) => {
    mockDraggables.push(args);
    return () => undefined;
  },
  dropTargetForElements: (args: DropTargetArgs) => {
    mockDropTargets.push(args);
    return () => undefined;
  },
}));
jest.mock('@atlaskit/pragmatic-drag-and-drop/external/adapter', () => ({ dropTargetForExternal: () => () => undefined }));
jest.mock('@atlaskit/pragmatic-drag-and-drop/combine', () => ({
  combine:
    (...cleanups: (() => void)[]) =>
    () =>
      cleanups.forEach((cleanup) => cleanup()),
}));
jest.mock('@/application/database-yjs', () => ({ useReadOnly: () => false }));
jest.mock('@/components/database/board/BoardProvider', () => ({ useBoardSelection: () => ({ editingCardId: null }) }));
jest.mock('@/components/database/components/board/card/CardPrimitive', () => ({
  CardPrimitive: () => <div data-testid='card-primitive' />,
}));
jest.mock('@/components/database/components/board/card/NewCard', () => ({ __esModule: true, default: () => null }));

const instanceId = Symbol('board');

function dragContext(sorted: boolean): BoardDragContextValue {
  return {
    getColumns: () => [],
    reorderColumn: jest.fn(),
    reorderCard: jest.fn(),
    moveCard: jest.fn(),
    registerCard: () => () => undefined,
    registerColumn: () => () => undefined,
    instanceId,
    sorted,
  };
}

const card = (columnId: string) => ({ source: { data: { type: 'card', itemId: 'other', columnId, instanceId } } });

function renderCard(sorted: boolean) {
  render(
    <BoardDragContext.Provider value={dragContext(sorted)}>
      <Card columnId='doing' groupFieldId='status' isCreating={false} rowId='website' setIsCreating={jest.fn()} type={CardType.CARD} />
    </BoardDragContext.Provider>
  );
}

function ColumnTarget({ columnId }: { columnId: string }) {
  const { columnInnerRef } = useCardsDrag(columnId, []);

  return <div ref={columnInnerRef} />;
}

describe('board drag and drop while sorted (WP09 §1.4)', () => {
  beforeEach(() => {
    mockDropTargets.length = 0;
    mockDraggables.length = 0;
  });

  it('names the card column in the drag data, so drops know where a card came from', () => {
    renderCard(true);
    expect(mockDraggables[0].getInitialData()).toEqual({ type: 'card', itemId: 'website', columnId: 'doing', instanceId });
  });

  it('makes no card a drop target on a sorted board, so no indicator shows between cards', () => {
    renderCard(true);
    expect(mockDropTargets[0].canDrop(card('doing'))).toBe(false);
    expect(mockDropTargets[0].canDrop(card('todo'))).toBe(false);
  });

  it('keeps card targets on an unsorted board', () => {
    renderCard(false);
    expect(mockDropTargets[0].canDrop(card('doing'))).toBe(true);
    expect(mockDropTargets[0].canDrop(card('todo'))).toBe(true);
  });

  it('lets a sorted column refuse its own cards and take the others', () => {
    render(
      <BoardDragContext.Provider value={dragContext(true)}>
        <ColumnTarget columnId='doing' />
      </BoardDragContext.Provider>
    );
    expect(mockDropTargets[0].canDrop(card('doing'))).toBe(false);
    expect(mockDropTargets[0].canDrop(card('todo'))).toBe(true);
  });

  it('lets an unsorted column take its own cards back', () => {
    render(
      <BoardDragContext.Provider value={dragContext(false)}>
        <ColumnTarget columnId='doing' />
      </BoardDragContext.Provider>
    );
    expect(mockDropTargets[0].canDrop(card('doing'))).toBe(true);
  });
});
