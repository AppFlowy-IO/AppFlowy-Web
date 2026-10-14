import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockData, BlockType } from '@/application/types';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/block-menu-chevron-right.svg';
import { ReactComponent as TurnIntoIcon } from '@/assets/icons/turn_into.svg';
import { Popover } from '@/components/_shared/popover';
import { DEFAULT_CALLOUT_DATA } from '@/components/editor/components/blocks/callout/callout.utils';
import { BlockNode, HeadingNode } from '@/components/editor/editor.type';
import { Button } from '@/components/ui/button';

const choices = [
  { key: 'text', type: BlockType.Paragraph, labelKey: 'editor.text', data: {} },
  { key: 'heading-1', type: BlockType.HeadingBlock, labelKey: 'document.slashMenu.name.heading1', data: { level: 1 } },
  { key: 'heading-2', type: BlockType.HeadingBlock, labelKey: 'document.slashMenu.name.heading2', data: { level: 2 } },
  { key: 'heading-3', type: BlockType.HeadingBlock, labelKey: 'document.slashMenu.name.heading3', data: { level: 3 } },
  { key: 'bulleted-list', type: BlockType.BulletedListBlock, labelKey: 'editor.bulletedListShortForm', data: {} },
  { key: 'numbered-list', type: BlockType.NumberedListBlock, labelKey: 'editor.numberedListShortForm', data: {} },
  { key: 'todo', type: BlockType.TodoListBlock, labelKey: 'editor.checkbox', data: { checked: false } },
  {
    key: 'toggle',
    type: BlockType.ToggleListBlock,
    labelKey: 'document.slashMenu.name.toggleList',
    data: { collapsed: false },
  },
  { key: 'quote', type: BlockType.QuoteBlock, labelKey: 'document.slashMenu.name.quote', data: {} },
  {
    key: 'callout',
    type: BlockType.CalloutBlock,
    labelKey: 'document.slashMenu.name.callout',
    data: DEFAULT_CALLOUT_DATA,
  },
  {
    key: 'code',
    type: BlockType.CodeBlock,
    labelKey: 'document.selectionMenu.codeBlock',
    data: { language: 'plaintext' },
  },
] as const;

const convertibleTypes = new Set<BlockType>(choices.map((choice) => choice.type));
const anchorOrigin = { vertical: 'top', horizontal: 'right' } as const;
const transformOrigin = { vertical: 'top', horizontal: 'left' } as const;

/** Shared text-block conversion menu; tables and media retain their specialized actions. */
export function BlockTurnInto({ node, onClose }: { node: BlockNode; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly();
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  if (readOnly || editor.isElementReadOnly(node) || !convertibleTypes.has(node.type)) return null;

  return (
    <>
      <Button ref={ref} variant='ghost' className='justify-start' onClick={() => setOpen(true)}>
        <TurnIntoIcon className='h-5 w-5' />
        {t('document.plugins.optionAction.turnInto')}
        <ChevronRightIcon className='ml-auto h-5 w-5 text-icon-tertiary [--stroke-0:currentColor]' />
      </Button>
      <Popover
        PaperProps={{ className: 'block-turn-into-paper' }}
        open={open}
        anchorEl={ref.current}
        onClose={() => setOpen(false)}
        anchorOrigin={anchorOrigin}
        transformOrigin={transformOrigin}
      >
        <div className='block-turn-into-menu flex w-[200px] flex-col p-2' data-testid='turn-into-menu'>
          {choices.map((choice) => {
            const current =
              choice.type === node.type &&
              (choice.type !== BlockType.HeadingBlock || (node as HeadingNode).data.level === choice.data.level);

            return (
              <Button
                key={choice.key}
                variant='ghost'
                className='justify-start'
                disabled={current}
                onClick={() => {
                  // Resolve by identity at click time: collaborators may move or remove the block.
                  const currentNode = findSlateEntryByBlockId(editor, node.blockId)?.[0];

                  if (
                    currentNode &&
                    convertibleTypes.has(currentNode.type as BlockType) &&
                    !editor.isElementReadOnly(currentNode)
                  ) {
                    CustomEditor.turnToBlock(editor, node.blockId, choice.type, choice.data as BlockData);
                  }

                  setOpen(false);
                  onClose();
                }}
              >
                {t(choice.labelKey)}
              </Button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
