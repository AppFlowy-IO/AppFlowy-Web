import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Node, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { ReactComponent as AIIcon } from '@/assets/icons/block-menu-ai.svg';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/block-menu-chevron-right.svg';
import { ReactComponent as CommentIcon } from '@/assets/icons/toolbar_add_comment.svg';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import { AiWriterMenuContent } from '@/components/chat/components/ai-writer/ai-writer-menu-content';
import { AIAssistantType } from '@/components/chat/types/writer';
import { CalloutNode } from '@/components/editor/editor.type';
import { useEditorContext, useEditorLocalState } from '@/components/editor/EditorContext';
import { useInlineCommentComposeOptional } from '@/components/inline-comment/InlineCommentContext';
import { Button } from '@/components/ui/button';

const anchorOrigin = { vertical: 'top', horizontal: 'right' } as const;
const transformOrigin = { vertical: 'top', horizontal: 'left' } as const;

export function CalloutWritingActions({ node, onClose }: { node: CalloutNode; onClose: () => void }) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { canComment } = useEditorContext();
  const { addDecorate } = useEditorLocalState();
  const comments = useInlineCommentComposeOptional();
  const aiEnabled = useAIEnabled();
  const [open, setOpen] = useState(false);
  const aiButtonRef = useRef<HTMLButtonElement>(null);
  const commentEnabled = canComment && comments?.active && comments.isEditorRegistered(editor);
  const hasCommentText = !!node.children[0] && !!Node.string(node.children[0]).trim();
  const input = useMemo(() => node.children.map(Node.string).join('\n'), [node]);
  const selectContent = (includeChildren = false) => {
    const entry = findSlateEntryByBlockId(editor, node.blockId);

    if (!entry) return false;
    const path = entry[1];

    Transforms.select(editor, Editor.range(editor, includeChildren ? path : [...path, 0]));
    return true;
  };

  if (!commentEnabled && !aiEnabled) return null;

  return (
    <>
      <div className='my-2 border-t border-border-primary' />
      {commentEnabled && (
        <Button
          variant='ghost'
          className='justify-start'
          disabled={!hasCommentText}
          onClick={() => {
            if (selectContent()) comments?.startComment(editor);
            onClose();
          }}
        >
          <CommentIcon className='h-5 w-5' />
          {t('document.plugins.optionAction.comment', { defaultValue: 'Comment' })}
        </Button>
      )}
      {aiEnabled && (
        <>
          <Button
            ref={aiButtonRef}
            variant='ghost'
            className='justify-start'
            disabled={!input.trim()}
            aria-haspopup='dialog'
            aria-expanded={open}
            onClick={() => {
              if (selectContent(true)) setOpen(true);
            }}
          >
            <AIIcon className='h-5 w-5 [&_path[fill]]:fill-current [&_path[stroke]]:stroke-current' />
            {t('document.plugins.optionAction.askAI', { defaultValue: 'Ask AI' })}
            <ChevronRightIcon className='ml-auto h-5 w-5 shrink-0 text-icon-tertiary [&_path]:stroke-current' />
          </Button>
          <Popover
            open={open}
            anchorEl={aiButtonRef.current}
            onClose={() => setOpen(false)}
            anchorOrigin={anchorOrigin}
            transformOrigin={transformOrigin}
            PaperProps={{
              className: 'callout-menu-paper',
              role: 'dialog',
              'aria-label': t('document.plugins.optionAction.askAI', { defaultValue: 'Ask AI' }),
            }}
          >
            <div className='w-[240px] p-2'>
              <AiWriterMenuContent
                input={input}
                isFilterOut={(type) => type === AIAssistantType.ContinueWriting}
                onClicked={(type) => {
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
                  setOpen(false);
                  onClose();
                }}
              />
            </div>
          </Popover>
        </>
      )}
    </>
  );
}
