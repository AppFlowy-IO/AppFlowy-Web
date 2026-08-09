import { MessageSquarePlus } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useInlineCommentContextOptional } from '@/components/inline-comment/InlineCommentContext';

export function InlineCommentAction() {
  const { t } = useTranslation();
  const editor = useSlate() as YjsEditor;
  const { canComment } = useEditorContext();
  const inlineComments = useInlineCommentContextOptional();
  const { forceShow } = useSelectionToolbarContext();

  const handleClick = useCallback(() => {
    if (inlineComments?.startComment(editor)) {
      forceShow(false);
    }
  }, [editor, forceShow, inlineComments]);

  if (!canComment || !inlineComments?.active) return null;

  return (
    <ActionButton
      aria-label={t('inlineComment.addComment')}
      data-testid={'inline-comment-toolbar-action'}
      tooltip={t('inlineComment.addCommentShortcut')}
      onClick={handleClick}
    >
      <MessageSquarePlus size={18} />
    </ActionButton>
  );
}
