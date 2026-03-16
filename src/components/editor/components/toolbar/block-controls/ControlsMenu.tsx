import { Button, Divider } from '@mui/material';
import { PopoverProps } from '@mui/material/Popover';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as CopyLinkIcon } from '@/assets/icons/link.svg';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import CalloutTextColor from '@/components/editor/components/toolbar/block-controls/CalloutTextColor';
import {
  OutlineCollapseControl,
  OutlineDepthControl,
} from '@/components/editor/components/toolbar/block-controls/OutlineControls';
import { BlockNode, CalloutNode, OutlineNode } from '@/components/editor/editor.type';
import { useEditorLocalState } from '@/components/editor/EditorContext';
import { copyTextToClipboard } from '@/utils/copy';

import CalloutIconControl from './CalloutIconControl';
import CalloutQuickStyleControl from './CalloutQuickStyleControl';
import Color from './Color';

const popoverProps: Partial<PopoverProps> = {
  transformOrigin: {
    vertical: 'center',
    horizontal: 'right',
  },
  anchorOrigin: {
    vertical: 'center',
    horizontal: 'left',
  },
  keepMounted: false,
  disableRestoreFocus: true,
  disableEnforceFocus: true,
};

function ControlsMenu({
  open,
  onClose,
  anchorEl,
}: {
  open: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
}) {
  const { selectedBlockIds } = useEditorLocalState();
  const editor = useSlateStatic() as YjsEditor;
  const onlySingleBlockSelected = selectedBlockIds?.length === 1;
  const node = useMemo(() => {
    const blockId = selectedBlockIds?.[0];

    if (!blockId) return null;

    return findSlateEntryByBlockId(editor, blockId);
  }, [selectedBlockIds, editor]);

  const { t } = useTranslation();
  const options = useMemo(() => {
    return [
      {
        key: 'delete',
        content: t('button.delete'),
        icon: <DeleteIcon />,
        onClick: () => {
          selectedBlockIds?.forEach((blockId) => {
            CustomEditor.deleteBlock(editor, blockId);
          });
        },
      },
      {
        key: 'duplicate',
        content: t('button.duplicate'),
        icon: <DuplicateIcon />,
        onClick: () => {
          const newBlockIds: string[] = [];
          const prevId = selectedBlockIds?.[selectedBlockIds.length - 1];

          selectedBlockIds?.forEach((blockId, index) => {
            const newBlockId = CustomEditor.duplicateBlock(
              editor,
              blockId,
              index === 0 ? prevId : newBlockIds[index - 1]
            );

            newBlockId && newBlockIds.push(newBlockId);
          });

          ReactEditor.focus(editor);
          const entry = findSlateEntryByBlockId(editor, newBlockIds[0]);

          if (!entry) return;

          const [, path] = entry;

          editor.select(editor.start(path));
        },
      },
      onlySingleBlockSelected && {
        key: 'copyLinkToBlock',
        content: t('document.plugins.optionAction.copyLinkToBlock'),
        icon: <CopyLinkIcon />,
        onClick: async () => {
          const blockId = selectedBlockIds?.[0];

          const url = new URL(window.location.href);

          url.searchParams.set('blockId', blockId);

          await copyTextToClipboard(url.toString());
          notify.success(t('shareAction.copyLinkToBlockSuccess'));
        },
      },
    ].filter(Boolean) as {
      key: string;
      content: string;
      icon: JSX.Element;
      onClick: () => void;
    }[];
  }, [t, selectedBlockIds, editor, onlySingleBlockSelected]);

  return (
    <Popover
      anchorEl={anchorEl}
      onClose={() => {
        const path = node?.[1];

        if (path) {
          window.getSelection()?.removeAllRanges();
          ReactEditor.focus(editor);
          editor.select(editor.start(path));
        }

        onClose();
      }}
      open={open}
      {...popoverProps}
    >
      <div data-testid={'controls-menu'} className={'flex w-[240px] flex-col p-2'}>
        {options.map((option) => {
          return (
            <Button
              data-testid={option.key}
              key={option.key}
              startIcon={option.icon}
              size={'small'}
              color={'inherit'}
              className={'justify-start'}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                option.onClick();
                onClose();
              }}
            >
              {option.content}
            </Button>
          );
        })}

        {node?.[0]?.type &&
          [
            BlockType.Paragraph,
            BlockType.HeadingBlock,
            BlockType.BulletedListBlock,
            BlockType.NumberedListBlock,
            BlockType.QuoteBlock,
            BlockType.TodoListBlock,
            BlockType.ToggleListBlock,
          ].includes(node?.[0]?.type as BlockType) && (
            <>
              <Divider className='my-2' />
              <Color node={node[0] as BlockNode} onSelectColor={onClose} />
            </>
          )}

        {node?.[0]?.type === BlockType.OutlineBlock && onlySingleBlockSelected && (
          <>
            <Divider className='my-2' />
            <OutlineCollapseControl node={node[0] as OutlineNode} onToggle={onClose} />
            <OutlineDepthControl node={node[0] as OutlineNode} onClose={onClose} />
            <Color node={node[0] as BlockNode} onSelectColor={onClose} />
          </>
        )}

        {node?.[0]?.type === BlockType.CalloutBlock && (
          <>
            <Divider className='my-2' />
            <CalloutQuickStyleControl node={node[0] as CalloutNode} onSelectStyle={onClose} />
            <CalloutIconControl node={node[0] as CalloutNode} onSelectIcon={onClose} />
            <Color node={node[0] as BlockNode} onSelectColor={onClose} />
            <CalloutTextColor node={node[0] as CalloutNode} onSelectColor={onClose} />
          </>
        )}
      </div>
    </Popover>
  );
}

export default ControlsMenu;
