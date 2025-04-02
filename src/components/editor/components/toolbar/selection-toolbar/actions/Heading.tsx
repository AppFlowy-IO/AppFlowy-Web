import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType, HeadingBlockData } from '@/application/types';
import { Popover } from '@/components/_shared/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { PopoverProps } from '@mui/material/Popover';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ActionButton from './ActionButton';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';
import { ReactComponent as Heading1 } from '@/assets/icons/h1.svg';
import { ReactComponent as Heading2 } from '@/assets/icons/h2.svg';
import { ReactComponent as Heading3 } from '@/assets/icons/h3.svg';
import { ReactComponent as DownArrow } from '@/assets/icons/triangle_down.svg';

const popoverProps: Partial<PopoverProps> = {
  anchorOrigin: {
    vertical: 'bottom',
    horizontal: 'center',
  },
  transformOrigin: {
    vertical: -8,
    horizontal: 'center',
  },
  slotProps: {
    paper: {
      className: 'bg-[var(--fill-toolbar)] rounded-[6px]',
    },
  },
};

export function Heading() {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { visible: toolbarVisible } = useSelectionToolbarContext();
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

  const getActiveButton = useCallback(() => {
    if (isActivated(1)) {
      return <Heading1 className={'text-fill-default'} />;
    }

    if (isActivated(2)) {
      return <Heading2 className={'text-fill-default'} />;
    }

    if (isActivated(3)) {
      return <Heading3 className={'text-fill-default'} />;
    }

    return <Heading3 />;
  }, [isActivated]);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

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
        tooltip={'Heading'}
      >
        <div className={'flex items-center justify-center'}>
          {getActiveButton()}
          <DownArrow className={'w-3 h-5 text-icon-on-toolbar'} />
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
          <div className={'flex h-[32px] items-center justify-center px-2'}>
            <ActionButton active={isActivated(1)} tooltip={t('editor.heading1')} onClick={toHeading(1)}>
              <Heading1 />
            </ActionButton>
            <ActionButton active={isActivated(2)} tooltip={t('editor.heading2')} onClick={toHeading(2)}>
              <Heading2 />
            </ActionButton>
            <ActionButton active={isActivated(3)} tooltip={t('editor.heading3')} onClick={toHeading(3)}>
              <Heading3 />
            </ActionButton>
          </div>
        </Popover>
      )}
    </div>
  );
}

export default Heading;
