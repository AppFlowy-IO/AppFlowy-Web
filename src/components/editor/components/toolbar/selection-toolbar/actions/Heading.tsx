import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType, HeadingBlockData } from '@/application/types';
import { ReactComponent as Heading1 } from '@/assets/icons/h1.svg';
import { ReactComponent as Heading2 } from '@/assets/icons/h2.svg';
import { ReactComponent as Heading3 } from '@/assets/icons/h3.svg';
import { ReactComponent as ParagraphSvg } from '@/assets/icons/text.svg';
import { ReactComponent as TextFormatSvg } from '@/assets/icons/text_format.svg';
import { ReactComponent as DownArrow } from '@/assets/icons/triangle_down.svg';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

import ActionButton from './ActionButton';
import { MenuButton } from './MenuButton';

// Define allowed translation keys for heading options
const headingLabelKeys = [
  'editor.text',
  'document.slashMenu.name.heading1',
  'document.slashMenu.name.heading2',
  'document.slashMenu.name.heading3',
] as const;

type HeadingLabelKey = typeof headingLabelKeys[number];

const headingOptions = [
  {
    icon: <ParagraphSvg className="h-5 w-5" />,
    labelKey: 'editor.text' as HeadingLabelKey,
    isActive: (isParagraph: () => boolean, _isActivated: (level: number) => boolean) => isParagraph(),
    onClick: (toParagraph: () => void, _toHeading: (level: number) => () => void, setOpen: (v: boolean) => void) => () => { toParagraph(); setOpen(false); },
  },
  {
    icon: <Heading1 className="h-5 w-5" />,
    labelKey: 'document.slashMenu.name.heading1' as HeadingLabelKey,
    isActive: (_isParagraph: () => boolean, isActivated: (level: number) => boolean) => isActivated(1),
    onClick: (_toParagraph: () => void, toHeading: (level: number) => () => void, setOpen: (v: boolean) => void) => () => { toHeading(1)(); setOpen(false); },
  },
  {
    icon: <Heading2 className="h-5 w-5" />,
    labelKey: 'document.slashMenu.name.heading2' as HeadingLabelKey,
    isActive: (_isParagraph: () => boolean, isActivated: (level: number) => boolean) => isActivated(2),
    onClick: (_toParagraph: () => void, toHeading: (level: number) => () => void, setOpen: (v: boolean) => void) => () => { toHeading(2)(); setOpen(false); },
  },
  {
    icon: <Heading3 className="h-5 w-5" />,
    labelKey: 'document.slashMenu.name.heading3' as HeadingLabelKey,
    isActive: (_isParagraph: () => boolean, isActivated: (level: number) => boolean) => isActivated(3),
    onClick: (_toParagraph: () => void, toHeading: (level: number) => () => void, setOpen: (v: boolean) => void) => () => { toHeading(3)(); setOpen(false); },
  },
];

export function Heading() {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { visible: toolbarVisible, forceShow } = useSelectionToolbarContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  const toHeading = useCallback(
    (level: number) => {
      return () => {
        try {
          const [node] = getBlockEntry(editor);

          if (!node) return;

          if (node.type === BlockType.HeadingBlock && (node.data as HeadingBlockData).level === level) {
            CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.Paragraph, {});
            return;
          }

          CustomEditor.turnToBlock<HeadingBlockData>(editor, node.blockId as string, BlockType.HeadingBlock, { level });
        } catch (e) {
          return;
        }
      };
    },
    [editor]
  );

  const isActivated = useCallback(
    (level: number) => {
      try {
        const [node] = getBlockEntry(editor);

        const isBlock = CustomEditor.isBlockActive(editor, BlockType.HeadingBlock);

        return isBlock && (node.data as HeadingBlockData).level === level;
      } catch (e) {
        return false;
      }
    },
    [editor]
  );

  const isParagraph = useCallback(() => {
    try {
      const [node] = getBlockEntry(editor);

      return node && node.type === BlockType.Paragraph;
    } catch (e) {
      return false;
    }
  }, [editor]);

  const toParagraph = useCallback(() => {
    try {
      const [node] = getBlockEntry(editor);

      if (!node) return;
      CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.Paragraph, {});
    } catch (e) {
      return;
    }
  }, [editor]);

  const { getButtonProps, selectedIndex } = useKeyboardNavigation({
    itemCount: 4,
    isOpen: open,
    onSelect: (index) => {
      if (index === 0) {
        toParagraph();
      } else {
        toHeading(index)();
      }
    },
    onClose: () => {
      setOpen(false);
    }
  });

  useEffect(() => {
    if (!toolbarVisible) {
      setOpen(false);
    }
  }, [toolbarVisible]);

  return (
    <div className={'flex items-center justify-center'}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div>
            <ActionButton
              ref={ref}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(true);
                forceShow(true);
              }}
              tooltip={t('editor.text')}
            >
              <div className={'flex items-center justify-center gap-1'}>
                <TextFormatSvg className='h-5 w-5' />
                <DownArrow className={'h-5 w-3 text-icon-tertiary'} />
              </div>
            </ActionButton>
          </div>
        </PopoverTrigger>
        {toolbarVisible && (
          <PopoverContent className="w-[200px] p-2" align="start" sideOffset={5}>
            <div className="flex flex-col gap-1">
              {headingOptions.map((opt, idx) => (
                <MenuButton
                  key={opt.labelKey}
                  icon={opt.icon}
                  label={t(opt.labelKey)}
                  isActive={opt.isActive(isParagraph, isActivated)}
                  onClick={() => opt.onClick(toParagraph, toHeading, setOpen)}
                  selected={selectedIndex === idx}
                  buttonProps={getButtonProps(idx)}
                />
              ))}
            </div>
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}

export default Heading;

