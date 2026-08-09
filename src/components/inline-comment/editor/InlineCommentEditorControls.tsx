import { Portal } from '@mui/material';
import { MessageSquarePlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * A read-only editor is not focusable, so slate-react never mirrors the browser
 * selection into `editor.selection`. Resolve the Slate range from the DOM
 * selection instead — that is the only way a Read-and-comment (or locked) page
 * can start a comment, which desktop allows.
 */
function getReadOnlyRange(editor: YjsEditor): Range | null {
  const domSelection = window.getSelection();

  if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) return null;

  try {
    const range = ReactEditor.toSlateRange(editor, domSelection, {
      exactMatch: false,
      suppressThrow: true,
    });

    return range && Range.isExpanded(range) ? range : null;
  } catch {
    return null;
  }
}

function getTriggerPosition(editor: YjsEditor, range: Range): TriggerPosition | null {
  const selection = getInlineCommentSelection(editor, range);

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
  const rangeRef = useRef<Range | null>(null);

  const updatePosition = useCallback(() => {
    if (!readOnly || !inlineComments?.active) {
      rangeRef.current = null;
      setPosition(null);
      return;
    }

    const range = getReadOnlyRange(editor) ?? (editor.selection && Range.isExpanded(editor.selection) ? editor.selection : null);

    if (!range) {
      rangeRef.current = null;
      setPosition(null);
      return;
    }

    rangeRef.current = range;
    setPosition(getTriggerPosition(editor, range));
  }, [editor, inlineComments?.active, readOnly]);

  const startComment = useCallback(() => {
    if (!inlineComments) return;

    const range = rangeRef.current ?? getReadOnlyRange(editor) ?? undefined;

    if (inlineComments.startComment(editor, range)) {
      rangeRef.current = null;
      setPosition(null);
    }
  }, [editor, inlineComments]);

  useEffect(() => {
    updatePosition();
    document.addEventListener('selectionchange', updatePosition);
    window.addEventListener('resize', updatePosition, { passive: true });
    // Capture phase to follow scrolling containers; passive because the trigger
    // only repositions itself and never cancels the scroll.
    window.addEventListener('scroll', updatePosition, { capture: true, passive: true });

    return () => {
      document.removeEventListener('selectionchange', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, { capture: true });
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
        if (inlineComments.startComment(editor, rangeRef.current ?? undefined)) {
          event.preventDefault();
          event.stopPropagation();
          rangeRef.current = null;
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
              onClick={startComment}
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
