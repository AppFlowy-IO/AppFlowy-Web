import { useEffect } from 'react';

import { YjsEditor } from '@/application/slate-yjs';

interface InlineCommentRegistrationOptions {
  canComment: boolean;
  canWrite: boolean;
  readOnly: boolean;
  viewId: string;
}

interface InlineCommentRegistrationBridge {
  registerEditor: (editor: YjsEditor, options: InlineCommentRegistrationOptions) => () => void;
}

/**
 * Own comment registration separately from the Yjs connection lifecycle.
 * The provider bridge changes identity when modal scope changes, even though
 * the routed page editor remains mounted throughout.
 */
export function useInlineCommentEditorRegistration(
  editor: YjsEditor | null | undefined,
  bridge: InlineCommentRegistrationBridge | null,
  options: InlineCommentRegistrationOptions
) {
  useEffect(() => {
    if (!editor) return;

    return bridge?.registerEditor(editor, options);
    // Permission changes use the provider's updateEditorAccess path; this
    // effect owns editor/provider scope only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, editor, options.viewId]);
}
