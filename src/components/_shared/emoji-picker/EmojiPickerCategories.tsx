import { useMemo } from 'react';

import { PER_ROW_EMOJI_COUNT } from '@/components/_shared/emoji-picker/const';
import EmojisVirtualizer from '@/components/_shared/emoji-picker/EmojisVirtualizer';

import { EmojiCategory, getRowsWithCategories } from './EmojiPicker.hooks';

function EmojiPickerCategories ({
  emojiCategories,
  onEmojiSelect,
}: {
  emojiCategories: EmojiCategory[];
  onEmojiSelect: (emoji: string) => void;
}) {
  const rows = useMemo(() => {
    return getRowsWithCategories(emojiCategories, PER_ROW_EMOJI_COUNT);
  }, [emojiCategories]);

  return (
    <div
      className={'w-full h-full'}
    >
      <EmojisVirtualizer
        data={rows}
        onSelected={onEmojiSelect}
      />
    </div>
  );
}

export default EmojiPickerCategories;
