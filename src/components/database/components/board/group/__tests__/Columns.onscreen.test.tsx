import { act, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import * as Y from 'yjs';

import type { GroupColumn, Row } from '@/application/database-yjs';
import { BoardCardFieldsContext } from '@/components/database/components/board/card/CardPrimitive';
import {
  CardListSizingContext,
  ColumnOnScreenContext,
  estimateCardHeight,
} from '@/components/database/components/board/column/CardList';
import { BoardDragContext, BoardDragContextValue } from '@/components/database/components/board/drag-and-drop/board-context';

import Columns, { LARGE_WIDGET_BOARD_CARDS } from '../Columns';

/** The monitor the columns registered for card drags. */
const mockMonitor: { onDragStart?: (args: unknown) => void; onDrop?: () => void } = {};
let mockIsDashboardWidget = true;

const COLUMN_WIDTH = 256;
const COLUMN_PITCH = 264;
const VIEWPORT_WIDTH = 300;
const FIELD_IDS = ['title', 'status', 'owner', 'notes'];

const fieldsDoc = new Y.Doc();
const mockFields = fieldsDoc.getMap('fields');
const mockView = fieldsDoc.getMap('view');

FIELD_IDS.forEach((id) => {
  const field = new Y.Map();

  mockFields.set(id, field);
  field.set('ty', 0);
});
mockView.set('field_orders', Y.Array.from(FIELD_IDS.map((id) => ({ id }))));
mockView.set('field_settings', new Y.Map());

jest.mock('@/application/database-yjs', () => ({
  PADDING_END: 0,
  FieldType: { SingleSelect: 3, MultiSelect: 4 },
  FieldVisibility: { AlwaysShown: 0, HideWhenEmpty: 1, AlwaysHidden: 2 },
  isAIFieldType: () => false,
  useDatabase: () => ({ get: (key: string) => (key === 'fields' ? mockFields : undefined) }),
  useDatabaseContext: () => ({ isDashboardWidget: mockIsDashboardWidget }),
  useDatabaseView: () => mockView,
  useFieldType: () => 0,
  useReadOnly: () => true,
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
}));

jest.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  monitorForElements: (args: typeof mockMonitor) => {
    Object.assign(mockMonitor, args);
    return () => undefined;
  },
}));

// The board's cards, its hidden groups and its add button are out of scope.
jest.mock('@/components/database/components/board/card/CardPrimitive', () => ({
  BoardCardFieldsContext: jest.requireActual<typeof import('react')>('react').createContext(null),
}));
jest.mock('@/components/database/components/board/card', () => ({ Card: () => null }));
jest.mock('@/components/database/board/BoardProvider', () => ({
  useBoardActions: () => ({ setCreatingColumnId: jest.fn() }),
  useBoardSelection: () => ({ creatingColumnId: null }),
}));
jest.mock('@/components/database/components/board/column/HiddenGroupColumn', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/board/group/AddGroupColumn', () => ({ __esModule: true, default: () => null }));

jest.mock('@/components/database/components/board/column', () => ({
  Column: ({ id }: { id: string }) => {
    const onScreen = useContext(ColumnOnScreenContext);
    const sizing = useContext(CardListSizingContext);
    const fields = useContext(BoardCardFieldsContext);

    return (
      <div
        data-column-id={id}
        data-testid={`column-${id}`}
        data-on-screen={String(onScreen)}
        data-estimate={sizing.estimatedCardHeight}
        data-overscan={sizing.overscan}
        data-fields={fields?.map((field) => field.fieldId).join(',')}
      />
    );
  },
}));

const COLUMN_IDS = ['none', 'todo', 'doing', 'review', 'done', 'archived'];
const columns = COLUMN_IDS.map((id) => ({ id, visible: true })) as unknown as GroupColumn[];

/** A board with `rowsPerColumn` cards in every column. */
function groupResultOf(rowsPerColumn: number) {
  return new Map<string, Row[]>(
    COLUMN_IDS.map((id) => [id, Array.from({ length: rowsPerColumn }, (_, index) => ({ id: `${id}-${index}`, height: 36 }))])
  );
}

/** 6 columns of 20 cards: more than a widget board mounts in every column. */
const LARGE_BOARD = groupResultOf(20);

let scrollLeft = 0;

function rect(left: number, width: number) {
  return { left, right: left + width, top: 0, bottom: 300, width, height: 300, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
}

function renderBoard(scroller: HTMLDivElement, groupResult = LARGE_BOARD) {
  const drag = { instanceId: Symbol('board') } as unknown as BoardDragContextValue;

  return render(
    <BoardDragContext.Provider value={drag}>
      <Columns
        fieldId='status'
        groupId='group'
        groupRowsReady
        columns={columns}
        groupResult={groupResult}
        addCardBefore={() => undefined}
        scrollElement={scroller}
      />
    </BoardDragContext.Provider>
  );
}

function onScreenColumns() {
  return COLUMN_IDS.filter((id) => screen.getByTestId(`column-${id}`).dataset.onScreen === 'true');
}

async function scrollTo(scroller: HTMLDivElement, left: number) {
  scrollLeft = left;
  await act(async () => {
    scroller.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

describe('Board columns inside a dashboard widget (W5)', () => {
  const getBoundingClientRect = Element.prototype.getBoundingClientRect;
  let scroller: HTMLDivElement;

  beforeAll(() => {
    // The widget shows 300px of the board; the columns are 256px wide, 8px apart.
    Element.prototype.getBoundingClientRect = function boundingRect(this: Element) {
      if (this === scroller) return rect(0, VIEWPORT_WIDTH);
      const id = (this as HTMLElement).dataset?.columnId;

      if (id !== undefined) return rect(COLUMN_IDS.indexOf(id) * COLUMN_PITCH - scrollLeft, COLUMN_WIDTH);
      return getBoundingClientRect.call(this);
    };
  });

  afterAll(() => {
    Element.prototype.getBoundingClientRect = getBoundingClientRect;
  });

  beforeEach(() => {
    scrollLeft = 0;
    mockIsDashboardWidget = true;
    scroller = document.createElement('div');
    document.body.appendChild(scroller);
  });

  afterEach(() => {
    scroller.remove();
  });

  it('mounts cards only in the columns on the viewport and one column on each side', () => {
    expect(COLUMN_IDS.length * 20).toBeGreaterThan(LARGE_WIDGET_BOARD_CARDS);
    renderBoard(scroller);

    // "none" and "todo" intersect the 300px viewport; "doing" is the column after them.
    expect(onScreenColumns()).toEqual(['none', 'todo', 'doing']);
  });

  it('follows the horizontal scroll', async () => {
    renderBoard(scroller);
    await scrollTo(scroller, 3 * COLUMN_PITCH);

    // "review" and "done" are on the viewport now.
    expect(onScreenColumns()).toEqual(['doing', 'review', 'done', 'archived']);
  });

  it('keeps the cards of the column a dragged card comes from', async () => {
    renderBoard(scroller);
    act(() => mockMonitor.onDragStart?.({ source: { data: { columnId: 'none' } } }));
    await scrollTo(scroller, 3 * COLUMN_PITCH);

    expect(onScreenColumns()).toEqual(['none', 'doing', 'review', 'done', 'archived']);

    act(() => mockMonitor.onDrop?.());
    expect(onScreenColumns()).toEqual(['doing', 'review', 'done', 'archived']);
  });

  it('mounts the cards of every column in a small board, with the usual overscan, as before', () => {
    renderBoard(scroller, groupResultOf(3));

    expect(onScreenColumns()).toEqual(COLUMN_IDS);
    expect(screen.getByTestId('column-todo').dataset.overscan).toBe('5');
  });

  it('culls the columns away from the viewport once a small board grows large', async () => {
    const { rerender } = renderBoard(scroller, groupResultOf(3));
    const drag = { instanceId: Symbol('board') } as unknown as BoardDragContextValue;

    rerender(
      <BoardDragContext.Provider value={drag}>
        <Columns
          fieldId='status'
          groupId='group'
          groupRowsReady
          columns={columns}
          groupResult={LARGE_BOARD}
          addCardBefore={() => undefined}
          scrollElement={scroller}
        />
      </BoardDragContext.Provider>
    );

    expect(onScreenColumns()).toEqual(['none', 'todo', 'doing']);
  });

  it('culls from the first render when the view holds a large board, before its rows are grouped', () => {
    const rowOrders = Y.Array.from(Array.from({ length: 2_000 }, (_, index) => ({ id: `row-${index}`, height: 36 })));

    mockView.set('row_orders', rowOrders);
    try {
      // Few rows are grouped yet: the view's 2,000 rows make it large all the same.
      renderBoard(scroller, groupResultOf(3));

      expect(onScreenColumns()).toEqual(['none', 'todo', 'doing']);
      expect(screen.getByTestId('column-todo').dataset.overscan).toBe('1');
    } finally {
      mockView.delete('row_orders');
    }
  });

  it('sizes the cards by the fields they show and overscans one card', () => {
    renderBoard(scroller);
    const column = screen.getByTestId('column-todo');

    // Every field but the group field ("status").
    expect(column.dataset.estimate).toBe(String(estimateCardHeight(FIELD_IDS.length - 1)));
    expect(column.dataset.overscan).toBe('1');
    expect(column.dataset.fields).toBe(FIELD_IDS.join(','));
  });

  it('mounts the cards of every column outside a dashboard widget, with the usual overscan', () => {
    mockIsDashboardWidget = false;
    renderBoard(scroller);

    expect(onScreenColumns()).toEqual(COLUMN_IDS);
    expect(screen.getByTestId('column-todo').dataset.overscan).toBe('5');
  });
});
