import { ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Text } from 'slate';

import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { AppOutlineContext } from '@/components/app/contexts/AppOutlineContext';
import { LeafContext } from '@/components/editor/components/leaf/leaf.hooks';
import { EditorContextProvider } from '@/components/editor/EditorContext';

/**
 * Gives a Text cell's Slate editor the editor context the document's leaf
 * renderers, mention panel and toolbar buttons read, built from the database
 * context the cell lives in (app or publish mode alike).
 */
export function RichTextCellContext({
  rowId,
  readOnly,
  children,
}: {
  rowId: string;
  readOnly: boolean;
  children: ReactNode;
}) {
  const context = useDatabaseContextOptional();
  const getMentionUser = useContext(AppOutlineContext)?.getMentionUser;
  const viewId = context?.activeViewId ?? context?.databasePageId ?? '';

  const mentionContext = useMemo(
    () => ({
      ...context?.mentionContext,
      view_id: viewId,
      database_view_id: context?.mentionContext?.database_view_id ?? viewId,
      row_id: rowId,
    }),
    [context?.mentionContext, rowId, viewId]
  );

  const [linkOpen, setLinkOpen] = useState<Text | undefined>(undefined);
  const openLinkPopover = useCallback((text: Text) => setLinkOpen(text), []);
  const closeLinkPopover = useCallback(() => setLinkOpen(undefined), []);
  const leafContextValue = useMemo(
    () => ({ linkOpen, openLinkPopover, closeLinkPopover }),
    [linkOpen, openLinkPopover, closeLinkPopover]
  );

  return (
    <EditorContextProvider
      workspaceId={context?.workspaceId ?? ''}
      viewId={viewId}
      readOnly={readOnly}
      navigateToView={context?.navigateToView}
      loadViewMeta={context?.loadViewMeta}
      loadView={context?.loadView}
      openPageModal={context?.openPageModal}
      loadViews={context?.loadViews}
      addPage={context?.addPage}
      searchMentions={context?.searchMentions}
      mentionContext={mentionContext}
      getMentionUser={getMentionUser}
      getSubscriptions={context?.getSubscriptions}
      eventEmitter={context?.eventEmitter}
      getViewIdFromDatabaseId={context?.getViewIdFromDatabaseId}
      variant={context?.variant}
    >
      <LeafContext.Provider value={leafContextValue}>{children}</LeafContext.Provider>
    </EditorContextProvider>
  );
}

export default RichTextCellContext;
