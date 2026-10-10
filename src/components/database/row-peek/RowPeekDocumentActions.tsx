import { useCallback } from 'react';

import {
  useDatabase,
  useDatabaseContextOptional,
  usePrimaryFieldId,
  useRowDataSelector,
  useRowMetaSelector,
} from '@/application/database-yjs';
import {
  ensureRowDocumentView,
  rowDocumentIdFromRowId,
  syncRowDocumentViewName,
} from '@/application/row-document/lifecycle';
import { UIVariant, YjsDatabaseKey } from '@/application/types';
import { FavoriteButton } from '@/components/app/header/FavoriteButton';
import { Users } from '@/components/app/header/Users';
import { ShareButton } from '@/components/app/share/ShareButton';

import type { ReactNode } from 'react';

/** Row peeks do not change the route or the app header's active row page. */
export function RowPeekDocumentActions({
  rowId,
  prepare,
  shareUrl,
  children,
}: {
  rowId: string;
  prepare: () => Promise<boolean>;
  shareUrl?: string;
  children?: ReactNode;
}) {
  const context = useDatabaseContextOptional();

  if (!context?.workspaceId || !context.databasePageId || context.variant === UIVariant.Publish) return <>{children}</>;

  return (
    <DocumentActions
      key={rowId}
      rowId={rowId}
      workspaceId={context.workspaceId}
      databasePageId={context.databasePageId}
      databaseViewId={context.activeViewId}
      prepare={prepare}
      shareUrl={shareUrl}
    >
      {children}
    </DocumentActions>
  );
}

function DocumentActions({
  rowId,
  workspaceId,
  databasePageId,
  databaseViewId,
  prepare,
  shareUrl,
  children,
}: {
  rowId: string;
  workspaceId: string;
  databasePageId: string;
  databaseViewId: string;
  prepare: () => Promise<boolean>;
  shareUrl?: string;
  children?: ReactNode;
}) {
  const fieldId = usePrimaryFieldId() || '';
  const { row } = useRowDataSelector(rowId);
  const meta = useRowMetaSelector(rowId);
  const database = useDatabase();
  const databaseId = database?.get(YjsDatabaseKey.id) as string | undefined;
  const documentId = meta?.documentId || rowDocumentIdFromRowId(rowId);
  const beforeFavorite = useCallback(async () => {
    if (!databaseId || !documentId || !row || !fieldId || !(await prepare())) {
      throw new Error('Row is not ready to favorite');
    }

    const created = await ensureRowDocumentView(workspaceId, documentId, {
      database_id: databaseId,
      database_view_id: databaseViewId,
      row_id: rowId,
    });

    if (!created) throw new Error('Unable to prepare row document');
    // Read after the commit barrier so a focused title's final draft is used.
    const savedTitle = row?.get(YjsDatabaseKey.cells)?.get(fieldId)?.get(YjsDatabaseKey.data);
    const title = typeof savedTitle === 'string' ? savedTitle.trim() : '';

    if (title) await syncRowDocumentViewName(workspaceId, documentId, title);
  }, [databaseId, databaseViewId, documentId, fieldId, prepare, row, rowId, workspaceId]);

  return (
    <>
      {documentId ? <Users viewId={documentId} maxVisibleUsers={3} className='row-peek-collaborators' /> : null}
      {/* Access is inherited from the database; the copied link opens this row. */}
      <ShareButton
        viewId={databasePageId}
        hidePublish
        hideExport
        shareUrl={shareUrl}
        className='row-peek-share mx-0 ml-2 h-8 rounded-[6px] font-medium'
      />
      {children}
      {databaseId && documentId && row && fieldId ? (
        <FavoriteButton
          viewId={documentId}
          beforeToggle={beforeFavorite}
          className='row-peek-icon-button text-icon-primary'
        />
      ) : null}
    </>
  );
}
