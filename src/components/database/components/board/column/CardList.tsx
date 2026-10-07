import { useVirtualizer } from '@tanstack/react-virtual';
import { createContext, memo, useCallback, useContext, useMemo, useRef } from 'react';

import { PADDING_END } from '@/application/database-yjs';
import { useBoardActions, useBoardSelection } from '@/components/database/board/BoardProvider';
import { Card } from '@/components/database/components/board/card';
import { cn } from '@/lib/utils';

export enum CardType {
  CARD = 'card',
  NEW_CARD = 'new_card',
}

export interface RenderCard {
  type: CardType;
  id: string;
}

const CARD_LIST_MAX_HEIGHT = 2000;

/** The estimate of a card nothing tells more about, and of the "New" row. */
const DEFAULT_CARD_HEIGHT = 72;
/** A card's slot: 3px above and below, plus the card's own 8px above and below. */
const CARD_CHROME_HEIGHT = 2 * 3 + 2 * 8;
/** A field line of a card is at least 20px, with 8px between two fields. */
const CARD_FIELD_HEIGHT = 20;
const CARD_FIELD_GAP = 8;

/**
 * The height of a card showing `fieldCount` fields, before it is measured: a
 * card with 19 fields is about 550px, not 72px, and a column that guessed 72
 * mounted a dozen cards to trim them to two (W5).
 */
export function estimateCardHeight(fieldCount: number): number {
  if (fieldCount <= 0) return DEFAULT_CARD_HEIGHT;
  return CARD_CHROME_HEIGHT + fieldCount * CARD_FIELD_HEIGHT + (fieldCount - 1) * CARD_FIELD_GAP;
}

export interface CardListSizing {
  /** The height of a card before it is measured. */
  estimatedCardHeight: number;
  /** Cards mounted beyond each edge of a column's viewport. */
  overscan: number;
}

export const DEFAULT_CARD_LIST_SIZING: CardListSizing = Object.freeze({
  estimatedCardHeight: DEFAULT_CARD_HEIGHT,
  overscan: 5,
});

/** How the board's columns size and overscan their cards; set once per board. */
export const CardListSizingContext = createContext<CardListSizing>(DEFAULT_CARD_LIST_SIZING);

/**
 * False for a column of a large dashboard widget board that is away from the
 * board's horizontal viewport (more than one column off it): the column keeps
 * its header and its size, and mounts no card until it scrolls near (W5).
 */
export const ColumnOnScreenContext = createContext(true);

const CARD_LIST_STYLE = {
  maxHeight: CARD_LIST_MAX_HEIGHT,
  overflowY: 'auto',
} as const;

const NO_ITEMS: ReturnType<ReturnType<typeof useVirtualizer>['getVirtualItems']> = [];

function CardList({
  data,
  fieldId,
  columnId,
  setScrollElement: _setScrollElement,
}: {
  columnId: string;
  data: RenderCard[];
  fieldId: string;
  setScrollElement?: (element: HTMLDivElement | null) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { estimatedCardHeight, overscan } = useContext(CardListSizingContext);
  const onScreen = useContext(ColumnOnScreenContext);
  const { creatingColumnId } = useBoardSelection();
  const { setCreatingColumnId } = useBoardActions();

  const isCreating = useMemo(() => {
    return creatingColumnId === columnId;
  }, [creatingColumnId, columnId]);

  const setIsCreating = useCallback(
    (isCreating: boolean) => {
      if (isCreating) {
        setCreatingColumnId(columnId);
      } else {
        setCreatingColumnId(null);
      }
    },
    [columnId, setCreatingColumnId]
  );

  const getScrollElement = useCallback(() => {
    if (!parentRef.current) return null;
    // Board cards scroll within their local column container, not the document
    // Return the parent div itself as the scroll container
    return parentRef.current;
  }, []);

  const virtualizer = useVirtualizer({
    count: data.length,
    scrollMargin: 0, // Always 0 for Board - items are positioned relative to column top
    overscan,
    getScrollElement,
    estimateSize: (index) => (data[index]?.type === CardType.CARD ? estimatedCardHeight : DEFAULT_CARD_HEIGHT),
    paddingStart: 0,
    paddingEnd: PADDING_END,
    getItemKey: (index) => data[index].id || String(index),
  });

  // TanStack Virtual already applies viewport bounds and overscan using the
  // measured card heights. A second fixed-height cap could discard valid
  // virtual items and remount a card during a pointer gesture.
  const virtualItems = virtualizer.getVirtualItems();
  const items = onScreen ? virtualItems : NO_ITEMS;

  return (
    <div
      ref={parentRef}
      className='appflowy-custom-scroller w-full min-h-0 flex-1'
      style={CARD_LIST_STYLE}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {items.map((virtualRow) => {
          const row = data[virtualRow.index];
          const { id, type } = row;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={cn('w-full px-2 py-[3px]', isCreating && 'transform transition-all duration-150 ease-in-out')}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                paddingTop: virtualRow.index === 0 ? 10 : undefined,
              }}
            >
              <Card
                type={type}
                rowId={id}
                groupFieldId={fieldId}
                setIsCreating={setIsCreating}
                isCreating={isCreating}
                columnId={columnId}
                beforeId={data[virtualRow.index - 1]?.id}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(CardList);
