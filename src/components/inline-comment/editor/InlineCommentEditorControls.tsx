import { Portal } from '@mui/material';
import { MessageSquarePlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Range } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useInlineCommentContextOptional } from '../InlineCommentContext';
import { getInlineCommentSelection } from './anchors';

interface TriggerPosition {
  left: number;
  top: number;
}

function getTriggerPosition(editor: YjsEditor): TriggerPosition | null {
  const selection = getInlineCommentSelection(editor);

  if (!selection) return null;

  try {
    const rect = ReactEditor.toDOMRange(editor, selection.range).getBoundingClientRect();

    if (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0) return null;

    return {
      left: Math.min(Math.max(8, rect.left), window.innerWidth - 48),
      top: Math.max(8, rect.top - 40),
    };
  } catch {
    return null;
  }
}

export function InlineCommentEditorControls({ readOnly }: { readOnly: boolean }) {
  const { t } = useTranslation();
  const editor = useSlate() as YjsEditor;
  const inlineComments = useInlineCommentContextOptional();
  const [position, setPosition] = useState<TriggerPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (!readOnly || !inlineComments?.active || !editor.selection || !Range.isExpanded(editor.selection)) {
      setPosition(null);
      return;
    }

    if (window.getSelection()?.isCollapsed) {
      setPosition(null);
      return;
    }

    setPosition(getTriggerPosition(editor));
  }, [editor, inlineComments?.active, readOnly]);

  useEffect(() => {
    updatePosition();
    document.addEventListener('selectionchange', updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      document.removeEventListener('selectionchange', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition]);

  useEffect(() => {
    if (!inlineComments?.active) return;

    let editorDom: HTMLElement;

    try {
      editorDom = ReactEditor.toDOMNode(editor, editor);
    } catch {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'm') {
        if (inlineComments.startComment(editor)) {
          event.preventDefault();
          event.stopPropagation();
          setPosition(null);
        }
      }
    };

    editorDom.addEventListener('keydown', handleKeyDown);
    return () => editorDom.removeEventListener('keydown', handleKeyDown);
  }, [editor, inlineComments]);

  if (!readOnly || !position || !inlineComments?.active) return null;

  return (
    <Portal>
      <div
        data-testid={'inline-comment-readonly-trigger'}
        className={'fixed z-[1200] rounded-lg bg-[var(--fill-toolbar)] p-1 shadow-lg'}
        style={position}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t('inlineComment.addComment')}
              className={'rounded p-1.5 text-icon-on-toolbar hover:text-text-action'}
              onClick={() => {
                if (inlineComments.startComment(editor)) setPosition(null);
              }}
            >
              <MessageSquarePlus size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent side={'top'}>{t('inlineComment.addCommentShortcut')}</TooltipContent>
        </Tooltip>
      </div>
    </Portal>
  );
}
