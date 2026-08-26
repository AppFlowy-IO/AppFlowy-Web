import * as Y from 'yjs';

import { waitForDatabaseHydration } from '@/application/database-yjs/database.hydration';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { getInlineViewRowOrders } from '@/application/database-yjs/row-order-visibility';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { getPrimaryFieldId } from '@/application/database-yjs/selector';
import { rowDocumentIdFromRowId } from '@/application/row-document/lifecycle';
import { CollabService } from '@/application/services/domains';
import { getCachedRowDoc } from '@/application/services/js-services/cache';
import { getDatabaseIdFromWorkspaceCatalog } from '@/application/services/js-services/workspace-database-catalog';
import {
  LoadView,
  Mention,
  MentionType,
  Types,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
import { AppFlowyPageLink } from '@/utils/url';

export interface DatabaseRowMentionResolverDependencies {
  getDatabaseId: (workspaceId: string, viewId: string) => Promise<string | null>;
  getCachedRow: (rowKey: string) => YDoc | undefined;
  getRowCollab: (workspaceId: string, rowId: string) => Promise<{ data: Uint8Array }>;
  createRowDoc: (rowId: string) => YDoc;
  applyRowUpdate: (doc: YDoc, update: Uint8Array) => void;
}

const defaultDependencies: DatabaseRowMentionResolverDependencies = {
  getDatabaseId: getDatabaseIdFromWorkspaceCatalog,
  getCachedRow: getCachedRowDoc,
  getRowCollab: (workspaceId, rowId) => CollabService.get(workspaceId, rowId, Types.DatabaseRow),
  createRowDoc: (rowId) => new Y.Doc({ guid: rowId }) as YDoc,
  applyRowUpdate: applyYDoc,
};

function getValidatedRow(rowDoc: YDoc, rowId: string, databaseId: string): YDatabaseRow | null {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

  if (!row) return null;
  if (row.get(YjsDatabaseKey.id) !== rowId) return null;
  if (row.get(YjsDatabaseKey.database_id) !== databaseId) return null;

  return row;
}

async function resolveDatabaseTarget(
  workspaceId: string,
  link: AppFlowyPageLink,
  getDatabaseId: DatabaseRowMentionResolverDependencies['getDatabaseId']
) {
  if (!link.databaseViewId || link.databaseViewId === link.viewId) {
    const databaseId = await getDatabaseId(workspaceId, link.viewId);

    return databaseId ? { databaseId, databaseViewId: link.databaseViewId || link.viewId } : null;
  }

  const [routeDatabaseId, selectedDatabaseId] = await Promise.all([
    getDatabaseId(workspaceId, link.viewId),
    getDatabaseId(workspaceId, link.databaseViewId),
  ]);

  if (!selectedDatabaseId || selectedDatabaseId !== routeDatabaseId) return null;

  return { databaseId: selectedDatabaseId, databaseViewId: link.databaseViewId };
}

export async function resolveDatabaseRowPageMention(
  workspaceId: string,
  link: AppFlowyPageLink,
  loadView: LoadView,
  dependencies: DatabaseRowMentionResolverDependencies = defaultDependencies
): Promise<Mention | null> {
  if (!link.rowId) return null;

  const target = await resolveDatabaseTarget(workspaceId, link, dependencies.getDatabaseId);

  if (!target) return null;

  const rowKey = getRowKey(target.databaseId, link.rowId);
  const cachedRowDoc = dependencies.getCachedRow(rowKey);
  let row = cachedRowDoc ? getValidatedRow(cachedRowDoc, link.rowId, target.databaseId) : null;
  const databasePromise = loadView(target.databaseViewId, false, false, {
    databaseId: target.databaseId,
    databaseMetadataOnly: true,
  }).then(waitForDatabaseHydration);
  const rowUpdatePromise = row
    ? Promise.resolve<Uint8Array | null>(null)
    : dependencies.getRowCollab(workspaceId, link.rowId).then(({ data }) => data);
  const [database, rowUpdate] = await Promise.all([databasePromise, rowUpdatePromise]);

  if (!database || database.get(YjsDatabaseKey.id) !== target.databaseId) return null;

  const rowOrder = getInlineViewRowOrders(database)
    ?.toArray()
    .find(({ id }) => id === link.rowId);

  if (!rowOrder || rowOrder.is_deleted) return null;

  const primaryFieldId = getPrimaryFieldId(database);
  const primaryField = primaryFieldId ? database.get(YjsDatabaseKey.fields).get(primaryFieldId) : undefined;

  if (!primaryFieldId || !primaryField) return null;

  let transientRowDoc: YDoc | undefined;

  try {
    if (!row && rowUpdate) {
      transientRowDoc = dependencies.createRowDoc(link.rowId);
      dependencies.applyRowUpdate(transientRowDoc, rowUpdate);
      row = getValidatedRow(transientRowDoc, link.rowId, target.databaseId);
    }

    if (!row) return null;

    const cell = row.get(YjsDatabaseKey.cells).get(primaryFieldId);
    const title = cell ? decodeCellToText(cell, primaryField).trim() : '';

    return {
      type: MentionType.PageRef,
      page_id: target.databaseViewId,
      block_id: link.rowId,
      row_id: link.rowId,
      database_id: target.databaseId,
      database_view_id: target.databaseViewId,
      database_row_id: link.rowId,
      row_document_id: rowDocumentIdFromRowId(link.rowId),
      data: { title: title || 'Untitled' },
    };
  } finally {
    transientRowDoc?.destroy();
  }
}
