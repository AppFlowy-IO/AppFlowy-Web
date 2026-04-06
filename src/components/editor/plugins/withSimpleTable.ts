import { ReactEditor } from 'slate-react';

/**
 * Slate plugin for SimpleTable.
 * Currently a no-op — cell structure is managed at the Yjs level.
 *
 * Note: We intentionally do NOT normalize empty cells here because
 * Slate normalization runs before Yjs data syncs to the Slate tree,
 * causing double-paragraph insertions in newly created cells.
 */
export const withSimpleTable = (editor: ReactEditor) => {
  return editor;
};
