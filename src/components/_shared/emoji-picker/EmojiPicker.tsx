import emptyImageSrc from '@/assets/images/empty.png';
import { Progress } from '@/components/ui/progress';

import { useLoadEmojiData } from './EmojiPicker.hooks';
import EmojiPickerCategories from './EmojiPickerCategories';
import EmojiPickerHeader from './EmojiPickerHeader';

interface Props {
  onEmojiSelect: (emoji: string) => void;
  size?: [number, number];
}

export function EmojiPicker ({ size, ...props }: Props) {
  const { skin, onSkinChange, emojiCategories, setSearchValue, searchValue, onSelect, loading, isEmpty } =
    useLoadEmojiData(props);

  return (
    <div
      style={{
        width: size ? size[0] : undefined,
        height: size ? size[1] : undefined,
      }}
      tabIndex={0}
      className={'emoji-picker flex h-[360px] max-h-[70vh] flex-col gap-3 px-3'}
    >
      <EmojiPickerHeader
        onEmojiSelect={onSelect}
        skin={skin}
        onSkinSelect={onSkinChange}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />
      {loading ? (
        <div className={'flex h-full items-center justify-center'}>
          <Progress variant={'primary'} />
        </div>
      ) : isEmpty ? (
        <img
          src={emptyImageSrc}
          alt={'No data found'}
          className={'mx-auto h-[200px]'}
        />
      ) : (
        <EmojiPickerCategories
          onEmojiSelect={onSelect}
          emojiCategories={emojiCategories}
        />
      )}
    </div>
  );
}

export default EmojiPicker;