import IconItem from '@/components/_shared/icon-picker/IconItem';

import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

function IconsVirtualizer ({
  onSelected,
  data,
  enableColor = true,
  container,
}: {
  container?: HTMLDivElement;
  enableColor?: boolean,
  data: Array<{
    type: 'category' | 'icons';
    category?: string;
    icons?: Array<{
      id: string;
      name: string;
      content: string;
      keywords: string[];
      cleanSvg: string;
    }>;
  }>;
  onSelected: (icon: { value: string; color: string; content: string }) => void;
}) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 5,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="List"
      style={{
        height: '100%',
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
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${items[0]?.start ?? 0}px)`,
          }}
        >
          {items.map((virtualRow) => (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={
                'flex gap-2 w-full pb-2'
              }
            >
              {data[virtualRow.index].type === 'category' ? (
                <div className="text-text-secondary font-medium">
                  {data[virtualRow.index].category}
                </div>
              ) : (
                data[virtualRow.index].icons?.map((icon) => (
                  <IconItem
                    key={icon.id}
                    icon={icon}
                    onSelect={onSelected}
                    enableColor={enableColor}
                    container={container}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default IconsVirtualizer;