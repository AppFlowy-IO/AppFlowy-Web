import { Row } from '@/application/database-yjs';
import { getScrollParent } from '@/components/global-comment/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, {
  useRef,
  memo,
} from 'react';
import { Card } from '@/components/database/components/board/card';

function CardList ({
  data,
  fieldId,
  setScrollElement,
}: {
  data: Row[];
  fieldId: string;
  setScrollElement?: (element: HTMLDivElement | null) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const parentOffsetRef = React.useRef(0);

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
    estimateSize: () => 150,
    paddingStart: 0,
    paddingEnd: 320,
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
              paddingTop: virtualRow.index === 0 ? 10 : undefined,
            }}
          >
            <Card
              rowId={data[virtualRow.index].id}
              groupFieldId={fieldId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(CardList);