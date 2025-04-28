import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { getRangeRect } from '@/components/editor/components/toolbar/selection-toolbar/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ReactEditor, useSlateStatic } from 'slate-react';
import { MentionPanel } from './mention-panel';
import { SlashPanel } from './slash-panel';

function Panels () {
  const [emojiPosition, setEmojiPosition] = React.useState<{
    top: number;
    left: number
  } | null>(null);
  const editor = useSlateStatic();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (createHotkey(HOT_KEY_NAME.POP_EMOJI_PICKER)(e)) {
        e.preventDefault();
        const rect = getRangeRect();

        if (!rect) return;
        setEmojiPosition({
          top: rect.top,
          left: rect.left,
        });
      }
    };

    const editorDom = ReactEditor.toDOMNode(editor, editor);

    editorDom.addEventListener('keydown', handleKeyDown);
    return () => {
      editorDom.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor]);

  return (
    <>
      <MentionPanel />
      <SlashPanel setEmojiPosition={setEmojiPosition} />
      {createPortal(<CustomIconPopover
        onOpenChange={open => {
          setEmojiPosition(open ? emojiPosition : null);
        }}
        open={Boolean(emojiPosition)}
        onSelectIcon={({ value }) => {
          editor.insertText(value);
          setEmojiPosition(null);
          ReactEditor.focus(editor);
        }}
        hideRemove
      >
        <div
          style={{
            width: '5px',
            height: '5px',
            position: 'fixed',
            pointerEvents: emojiPosition ? 'auto' : 'none',
            top: emojiPosition ? emojiPosition.top + 24 : 0,
            left: emojiPosition ? emojiPosition.left : 0,
            zIndex: emojiPosition ? 9999 : -1,
          }}
        />
      </CustomIconPopover>, document.body)}
    </>
  );
}

export default Panels;