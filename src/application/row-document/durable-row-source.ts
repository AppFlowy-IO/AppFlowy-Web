import * as Y from 'yjs';

import type { AtomicCreationOwner } from '@/application/atomic-creation/owner';
import { assertNotAborted } from '@/application/database-yjs/creation/source-readiness';
import { collabFullSyncBatch } from '@/application/services/js-services/http/collab-api';
import { Types, YjsEditorKey } from '@/application/types';

import { CollabState, decodeCurrentRowPageCollab, RowDocumentSourceIdentity } from './row-source-readiness';

/**
 * A normal Row can be readable from Redis before its first PostgreSQL snapshot exists.
 * Full-sync commits that initial base before acknowledging; an existing base is never replaced.
 * Send only the already accepted Row state, leaving ordinary row creation and local cell edits
 * with their existing sync owner. Atomic document creation can then fence this durable source.
 */
export async function ensureDurableRowSource(
  identity: RowDocumentSourceIdentity,
  source: CollabState,
  options: {
    owner: AtomicCreationOwner;
    restoreId: string;
    signal: AbortSignal;
    deadline: number;
  }
): Promise<void> {
  const assertCurrent = () => {
    assertNotAborted(options.signal);
    options.owner.assertCurrent();
    if (Date.now() >= options.deadline) throw new Error('Row source synchronization timed out.');
  };

  assertCurrent();
  const row = decodeCurrentRowPageCollab(source, identity.rowId, identity.rowVersion ?? null);
  let docState: Uint8Array;
  let stateVector: Uint8Array;

  try {
    const data = row.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);

    if (!(data instanceof Y.Map) || data.get('id') !== identity.rowId || data.get('database_id') !== identity.databaseId)
      throw new Error('The current source Row identity changed.');
    docState = Y.encodeStateAsUpdate(row);
    stateVector = Y.encodeStateVector(row);
  } finally {
    row.destroy();
  }

  assertCurrent();
  const results = await collabFullSyncBatch(
    options.owner.workspaceId,
    [
      {
        objectId: identity.rowId,
        collabType: Types.DatabaseRow,
        collabVersion: identity.rowVersion,
        databaseRestoreId: options.restoreId,
        docState,
        stateVector,
      },
    ],
    {
      atomicCreationOwner: options.owner,
      signal: options.signal,
      timeoutMs: Math.max(1, options.deadline - Date.now()),
    }
  );

  assertCurrent();
  const result = results[0];

  if (results.length !== 1 || result.objectId !== identity.rowId || result.collabType !== Types.DatabaseRow)
    throw new Error('Row source synchronization returned a different identity.');
  if (result.error) throw new Error(`Row source synchronization failed: ${result.error}`);
  if (result.collabVersion !== identity.rowVersion)
    throw new Error('The Row version changed while its source was synchronizing.');
}
