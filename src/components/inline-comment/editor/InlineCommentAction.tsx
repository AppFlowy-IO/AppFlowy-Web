import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { ReactComponent as AddCommentIcon } from '@/assets/icons/toolbar_add_comment.svg';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useInlineCommentComposeOptional } from '@/components/inline-comment/InlineCommentContext';

function useInlineCommentActionState() {
  const editor = useSlate() as YjsEditor;
  const { canComment } = useEditorContext();
  const inlineComments = useInlineCommentComposeOptional();

  return {
    canComment: Boolean(canComment),
    editor,
    inlineComments,
    enabled: Boolean(inlineComments?.active && inlineComments.isEditorRegistered(editor)),
  };
}

/**
 * Whether the selection toolbar should show the comment entry point. Exposed so
 * the toolbar can drop the surrounding divider when the action is hidden.
 */
export function useInlineCommentActionEnabled(): boolean {
  return useInlineCommentActionState().enabled;
}

export function InlineCommentAction({ selectionSupported = true }: { selectionSupported?: boolean }) {
  const { t } = useTranslation();
  const { canComment, editor, enabled, inlineComments } = useInlineCommentActionState();
  const { forceShow } = useSelectionToolbarContext();
  const unavailableMessage = !canComment
    ? t('inlineComment.permissionDenied')
    : !selectionSupported
    ? t('inlineComment.unsupportedSelection')
    : null;

  const handleClick = useCallback(() => {
    if (unavailableMessage) {
      toast.error(unavailableMessage);
      return;
    }

    if (inlineComments?.startComment(editor)) {
      forceShow(false);
    } else {
      toast.error(t('inlineComment.unsupportedSelection'));
    }
  }, [editor, forceShow, inlineComments, t, unavailableMessage]);

  if (!enabled) return null;

  return (
    <ActionButton
      aria-label={unavailableMessage ?? t('inlineComment.addComment')}
      data-testid={'inline-comment-toolbar-action'}
      tooltip={unavailableMessage ?? t('inlineComment.addComment')}
      onClick={handleClick}
    >
      {/* Desktop tints the toolbar comment icon with commentColorScheme.icon. */}
      <AddCommentIcon className={'h-5 w-5 text-comment-icon'} />
    </ActionButton>
  );
}
