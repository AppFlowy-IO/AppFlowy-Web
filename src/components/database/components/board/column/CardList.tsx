import { Row } from '@/application/database-yjs';
import { AFScroller } from '@/components/_shared/scroller';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, {
  useRef,
  memo,
} from 'react';
import Card from '@/components/database/components/board/card/Card';

function CardList ({
  data,
  fieldId,
}: {
  data: Row[];
  fieldId: string
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    paddingStart: 0,
    paddingEnd: 320,
  });
  const items = virtualizer.getVirtualItems();

  return (
    <AFScroller
      overflowXHidden
      ref={parentRef}
      className="w-full h-full"
      style={{
        overflowY: 'auto',
        contain: 'strict',
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {items.map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className={'py-[3px] px-2 w-full'}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transform: `translateY(${
                virtualRow.start - virtualizer.options.scrollMargin
              }px)`,
            }}
          >
            <Card
              rowId={data[virtualRow.index].id}
              groupFieldId={fieldId}
            />
          </div>
        ))}
      </div>
    </AFScroller>
  );
}

export default memo(CardList);