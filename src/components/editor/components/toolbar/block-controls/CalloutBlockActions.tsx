import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Node, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockData, BlockType } from '@/application/types';
import { ReactComponent as AIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CommentIcon } from '@/assets/icons/toolbar_add_comment.svg';
import { ReactComponent as TurnIntoIcon } from '@/assets/icons/turn_into.svg';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import { AIAssistantType, AIWriterMenu } from '@/components/chat';
import { CalloutNode } from '@/components/editor/editor.type';
import { useEditorContext, useEditorLocalState } from '@/components/editor/EditorContext';
import { useInlineCommentComposeOptional } from '@/components/inline-comment/InlineCommentContext';
import { Button } from '@/components/ui/button';

export function CalloutTurnInto({ node, onClose }: { node: CalloutNode; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const choices = [
    { type: BlockType.Paragraph, label: t('editor.text'), data: {} },
    ...[1, 2, 3].map((level) => ({
      type: BlockType.HeadingBlock,
      label: t('editor.heading', { defaultValue: 'Heading' }) + ` ${level}`,
      data: { level },
    })),
    { type: BlockType.BulletedListBlock, label: t('editor.bulletedListShortForm'), data: {} },
    { type: BlockType.NumberedListBlock, label: t('editor.numberedListShortForm'), data: {} },
    { type: BlockType.TodoListBlock, label: t('editor.checkbox'), data: { checked: false } },
    { type: BlockType.ToggleListBlock, label: t('document.slashMenu.name.toggleList'), data: { collapsed: false } },
    { type: BlockType.QuoteBlock, label: t('document.slashMenu.name.quote'), data: {} },
    { type: BlockType.CodeBlock, label: t('document.selectionMenu.codeBlock'), data: { language: 'plaintext' } },
  ];

  return (
    <>
      <Button ref={ref} variant='ghost' className='justify-start' onClick={() => setOpen(true)}>
        <TurnIntoIcon className='h-5 w-5' />
        {t('document.plugins.optionAction.turnInto')}
        <ChevronRightIcon className='ml-auto h-5 w-5 text-icon-tertiary' />
      </Button>
      <Popover
        PaperProps={{ className: 'callout-menu-paper' }}
        open={open}
        anchorEl={ref.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <div className='callout-block-menu flex w-[200px] flex-col p-2'>
          {choices.map((choice) => (
            <Button
              key={`${choice.type}-${choice.label}`}
              variant='ghost'
              className='justify-start'
              onClick={() => {
                CustomEditor.turnToBlock(editor, node.blockId, choice.type, choice.data as BlockData);
                setOpen(false);
                onClose();
              }}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function CalloutWritingActions({ node, onClose }: { node: CalloutNode; onClose: () => void }) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { canComment } = useEditorContext();
  const { addDecorate } = useEditorLocalState();
  const comments = useInlineCommentComposeOptional();
  const aiEnabled = useAIEnabled();
  const [open, setOpen] = useState(false);
  const commentEnabled = canComment && comments?.active && comments.isEditorRegistered(editor);
  const hasText = !!node.children[0] && !!Node.string(node.children[0]).trim();
  const selectContent = (includeChildren = false) => {
    const path = ReactEditor.findPath(editor, node);

    Transforms.select(editor, Editor.range(editor, includeChildren ? path : [...path, 0]));
  };

  if (!commentEnabled && !aiEnabled) return null;

  return (
    <>
      <div className='my-2 border-t border-border-primary' />
      {commentEnabled && (
        <Button
          variant='ghost'
          className='justify-start'
          disabled={!hasText}
          onClick={() => {
            selectContent();
            comments?.startComment(editor);
            onClose();
          }}
        >
          <CommentIcon className='h-5 w-5' />
          {t('document.plugins.optionAction.comment', { defaultValue: 'Comment' })}
        </Button>
      )}
      {aiEnabled && (
        <AIWriterMenu
          open={open}
          onOpenChange={setOpen}
          input={Node.string(node)}
          isFilterOut={(type) => type === AIAssistantType.ContinueWriting}
          onItemClicked={(type) => {
            if (editor.selection) {
              const replace = [
                AIAssistantType.ImproveWriting,
                AIAssistantType.FixSpelling,
                AIAssistantType.MakeLonger,
                AIAssistantType.MakeShorter,
              ].includes(type);

              addDecorate?.(
                editor.selection,
                replace ? 'line-through text-text-secondary' : 'bg-fill-theme-select',
                'ai-writer'
              );
            }

            ReactEditor.blur(editor);
            onClose();
          }}
        >
          <Button
            variant='ghost'
            className='justify-start text-ai-primary'
            disabled={!hasText}
            onClick={() => {
              selectContent(true);
              setOpen(true);
            }}
          >
            <AIIcon className='h-5 w-5' />
            {t('editor.askAI')}
          </Button>
        </AIWriterMenu>
      )}
    </>
  );
}
