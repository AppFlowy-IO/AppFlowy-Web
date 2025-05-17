import Button from '@mui/material/Button';
import { PopoverProps } from '@mui/material/Popover';
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
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as DownArrow } from '@/assets/icons/triangle_down.svg';
import { Popover } from '@/components/_shared/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

import ActionButton from './ActionButton';

const popoverProps: Partial<PopoverProps> = {
  anchorOrigin: {
    vertical: 'bottom',
    horizontal: 'center',
  },
  transformOrigin: {
    vertical: 'top',
    horizontal: 'center',
  },
  slotProps: {
    paper: {
      className: 'bg-[var(--surface-primary)] rounded-[8px]',
      style: { marginTop: '6px' }
    },
  },
};

const headingOptions = [
  {
    icon: <ParagraphSvg className="h-5 w-5" />,
    labelKey: 'editor.text',
    isActive: (isParagraph: () => boolean, _isActivated: (level: number) => boolean) => isParagraph(),
    onClick: (toParagraph: () => void, _toHeading: (level: number) => () => void, setOpen: (v: boolean) => void) => () => { toParagraph(); setOpen(false); },
  },
  {
    icon: <Heading1 className="h-5 w-5" />,
    labelKey: 'document.slashMenu.name.heading1',
    isActive: (_isParagraph: () => boolean, isActivated: (level: number) => boolean) => isActivated(1),
    onClick: (_toParagraph: () => void, toHeading: (level: number) => () => void, setOpen: (v: boolean) => void) => () => { toHeading(1)(); setOpen(false); },
  },
  {
    icon: <Heading2 className="h-5 w-5" />,
    labelKey: 'document.slashMenu.name.heading2',
    isActive: (_isParagraph: () => boolean, isActivated: (level: number) => boolean) => isActivated(2),
    onClick: (_toParagraph: () => void, toHeading: (level: number) => () => void, setOpen: (v: boolean) => void) => () => { toHeading(2)(); setOpen(false); },
  },
  {
    icon: <Heading3 className="h-5 w-5" />,
    labelKey: 'document.slashMenu.name.heading3',
    isActive: (_isParagraph: () => boolean, isActivated: (level: number) => boolean) => isActivated(3),
    onClick: (_toParagraph: () => void, toHeading: (level: number) => () => void, setOpen: (v: boolean) => void) => () => { toHeading(3)(); setOpen(false); },
  },
];

export function Heading() {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { visible: toolbarVisible } = useSelectionToolbarContext();
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

      <ActionButton
        ref={ref}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        tooltip={t('editor.text')}
      >
        <div className={'flex items-center justify-center gap-1'}>
          <TextFormatSvg className='h-5 w-5' />
          <DownArrow className={'h-5 w-3 text-icon-primary'} />
        </div>
      </ActionButton>
      {toolbarVisible && (
        <Popover
          disableAutoFocus={true}
          disableEnforceFocus={true}
          disableRestoreFocus={true}
          onClose={() => {
            setOpen(false);
          }}
          open={open}
          anchorEl={ref.current}
          {...popoverProps}
        >
          <div className="flex flex-col w-[200px] rounded-[12px]" style={{ padding: 'var(--spacing-spacing-m)' }}>
            {headingOptions.map((opt, idx) => (
              <Button
                key={opt.labelKey}
                {...getButtonProps(idx)}
                startIcon={opt.icon}
                color="inherit"
                onClick={opt.onClick(toParagraph, toHeading, setOpen)}
                disableRipple
                className="text-text-primary"
                sx={{
                  '.MuiButton-startIcon': {
                    margin: 0,
                    marginRight: 'var(--spacing-spacing-m)'
                  },
                  padding: '0 var(--spacing-spacing-m)',
                  height: '32px',
                  minHeight: '32px',
                  borderRadius: '8px',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  fontSize: '14px',
                  fontStyle: 'normal',
                  fontWeight: 400,
                  lineHeight: '20px',
                  ...(selectedIndex === idx && {
                    backgroundColor: 'var(--fill-list-hover)'
                  })
                }}
              >
                {String(t(opt.labelKey as any))}
                {opt.isActive(isParagraph, isActivated) && (
                  <span className="ml-auto flex items-center">
                    <TickIcon className="h-5 w-5 text-icon-primary" />
                  </span>
                )}
              </Button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

export default Heading;
