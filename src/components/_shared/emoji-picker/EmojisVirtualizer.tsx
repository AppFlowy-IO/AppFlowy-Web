import EmojiItem from '@/components/_shared/emoji-picker/EmojiItem';
import { Emoji } from '@/components/_shared/emoji-picker/EmojiPicker.hooks';

import React, { useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';

function EmojisVirtualizer ({
  onSelected,
  data,
}: {
  data: {
    id: string
    type: 'category' | 'emojis'
    emojis?: Emoji[] | undefined
    category?: string | undefined
  }[];
  onSelected: (emoji: string) => void;
}) {
  const { t } = useTranslation();
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 5,
  });

  const getCategoryName = useCallback(
    (id: string) => {
      const i18nName: Record<string, string> = {
        frequent: t('emoji.categories.frequentlyUsed'),
        people: t('emoji.categories.people'),
        nature: t('emoji.categories.nature'),
        foods: t('emoji.categories.food'),
        activity: t('emoji.categories.activities'),
        places: t('emoji.categories.places'),
        objects: t('emoji.categories.objects'),
        symbols: t('emoji.categories.symbols'),
        flags: t('emoji.categories.flags'),
      };

      return i18nName[id];
    },
    [t],
  );

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
                  {getCategoryName(
                    data[virtualRow.index].id,
                  )}
                </div>
              ) : (
                data[virtualRow.index].emojis?.map((emoji) => (
                  <EmojiItem
                    key={emoji.id}
                    isFlag={data[virtualRow.index].category === 'flags'}
                    emoji={emoji}
                    onClick={() => {
                      onSelected(emoji.native);
                    }}
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

export default EmojisVirtualizer;