import { useCallback } from 'react';
import { Editor } from 'slate';
import { useSlateSelector } from 'slate-react';

import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockNode } from '@/components/editor/editor.type';

export function useBlockMenuNode(blockId?: string) {
  // The editor object is mutable and stable. Subscribe to the selected node rather
  // than memoizing a snapshot by editor identity or rerendering on every selection.
  return useSlateSelector(
    useCallback(
      (editor: Editor) =>
        blockId ? (findSlateEntryByBlockId(editor, blockId)?.[0] as BlockNode | undefined) ?? null : null,
      [blockId]
    )
  );
}
