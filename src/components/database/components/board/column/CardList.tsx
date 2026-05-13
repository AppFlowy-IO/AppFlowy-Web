import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';

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
  const parentOffsetRef = useRef(0);
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

  // Board columns have local scroll, so scrollMargin should always be 0
  // No need for RAF measurement like Grid - layout is stable within the column
  useLayoutEffect(() => {
    parentOffsetRef.current = 0;
  }, []);

  const virtualizer = useVirtualizer({
    count: data.length,
    scrollMargin: 0, // Always 0 for Board - items are positioned relative to column top
    overscan: 5,
    getScrollElement,
    estimateSize: () => 36,
    paddingStart: 0,
    paddingEnd: PADDING_END,
    getItemKey: (index) => data[index].id || String(index),
  });

  const virtualItems = virtualizer.getVirtualItems();
  const viewportHeight = Math.min(
    parentRef.current?.clientHeight || CARD_LIST_MAX_HEIGHT,
    CARD_LIST_MAX_HEIGHT
  );
  const scrollTop = parentRef.current?.scrollTop ?? 0;
  const renderStart = Math.max(0, scrollTop - 5 * 36);
  const renderEnd = scrollTop + viewportHeight + 5 * 36;
  const maxRenderedItems = Math.ceil(viewportHeight / 36) + 12;
  const items = virtualItems.length > maxRenderedItems
    ? virtualItems
      .filter((item) => item.end >= renderStart && item.start <= renderEnd)
      .slice(0, maxRenderedItems)
    : virtualItems;

  return (
    <div
      ref={parentRef}
      className='appflowy-custom-scroller w-full shrink-0'
      style={{
        height: CARD_LIST_MAX_HEIGHT,
        maxHeight: CARD_LIST_MAX_HEIGHT,
        overflowY: 'auto',
      }}
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
