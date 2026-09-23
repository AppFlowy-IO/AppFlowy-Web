import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { setSyncAlias, setSyncParent } from './store';

/** Reads identities from an already open collab. No row enumeration or document encoding. */
export function bindSyncStatus(doc: YDoc, collabType: Types) {
  const viewId = (doc as YDoc & { view_id?: string }).view_id;

  if (viewId) setSyncAlias(viewId, doc.guid);
  if (collabType !== Types.DatabaseRow) return;
  const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
  const databaseId = row?.get(YjsDatabaseKey.database_id);

  if (typeof databaseId === 'string') setSyncParent(doc.guid, databaseId);
  const documentId = getMetaIdMap(doc.guid).get(RowMetaKey.DocumentId);

  if (documentId) setSyncParent(documentId, doc.guid);
}
