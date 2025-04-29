import { PADDING_END } from '@/application/database-yjs';
import { getScrollParent } from '@/components/global-comment/utils';
import { cn } from '@/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, {
  useRef,
  memo, useState,
} from 'react';
import { Card } from '@/components/database/components/board/card';

export enum CardType {

  CARD = 'card',
  NEW_CARD = 'new_card',
}

export interface RenderCard {
  type: CardType;
  id: string;
}

function CardList ({
  data,
  fieldId,
  columnId,
  setScrollElement,
}: {
  columnId: string;
  data: RenderCard[];
  fieldId: string;
  setScrollElement?: (element: HTMLDivElement | null) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const parentOffsetRef = React.useRef(0);
  const [isCreating, setIsCreating] = useState(false);

  React.useLayoutEffect(() => {
    parentOffsetRef.current = parentRef.current?.getBoundingClientRect()?.top ?? 0;
  }, []);

  const virtualizer = useVirtualizer({
    count: data.length,
    scrollMargin: parentOffsetRef.current,
    getScrollElement: () => {
      if (!parentRef.current) return null;
      const el = (parentRef.current.closest('.appflowy-scroll-container') || getScrollParent(parentRef.current)) as HTMLDivElement;

      if (setScrollElement) {
        setScrollElement(el);
      }

      return el;
    },
    estimateSize: () => 36,
    paddingStart: 0,
    paddingEnd: PADDING_END,
    getItemKey: (index) => data[index].id || String(index),
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="w-full appflowy-custom-scroller"
      style={{
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
              className={cn('py-[3px] px-2 w-full', isCreating && 'transform transition-all duration-150 ease-in-out')}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translateY(${
                  virtualRow.start - virtualizer.options.scrollMargin
                }px)`,
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