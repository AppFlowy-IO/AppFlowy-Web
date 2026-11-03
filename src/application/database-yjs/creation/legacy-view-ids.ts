import { NIL, validate as isUuid } from 'uuid';
import * as Y from 'yjs';

import type { AtomicCreationOwner } from '@/application/atomic-creation/owner';
import { collabFullSyncBatch, CollabFullSyncBatchResult } from '@/application/services/js-services/http/collab-api';
import { Types, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  assertNotAborted,
  DatabaseViewSourceRequirements,
  remoteDatabaseCoversSource,
  waitForDatabaseViewSource,
} from './source-readiness';

function databaseViews(doc: Y.Doc, databaseId: string): Y.Map<unknown> {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
  const views = database instanceof Y.Map ? database.get(YjsDatabaseKey.views) : undefined;

  if (!(database instanceof Y.Map) || database.get(YjsDatabaseKey.id) !== databaseId || !(views instanceof Y.Map))
    throw new Error('Database view identities are incomplete');
  return views;
}

/** Only the legacy missing-id shape is repairable; conflicting identities are never overwritten. */
function missingViewIds(views: Y.Map<unknown>, databaseId: string): string[] {
  const missing: string[] = [];

  views.forEach((view, key) => {
    if (!(view instanceof Y.Map)) throw new Error('Database view is incomplete');
    if (view.has(YjsDatabaseKey.id)) return;
    const layout = view.get(YjsDatabaseKey.layout);

    if (
      !isUuid(key) ||
      key === NIL ||
      view.get(YjsDatabaseKey.database_id) !== databaseId ||
      typeof view.get(YjsDatabaseKey.name) !== 'string' ||
      !((typeof layout === 'number' && Number.isSafeInteger(layout)) || typeof layout === 'bigint') ||
      !(view.get(YjsDatabaseKey.row_orders) instanceof Y.Array) ||
      !(view.get(YjsDatabaseKey.field_orders) instanceof Y.Array)
    ) {
      throw new Error('Database view cannot be repaired from its identity');
    }

    missing.push(key);
  });
  return missing;
}

/**
 * Old Web clients keyed views by UUID but omitted the same UUID inside the view map.
 * Repair an independently verified server snapshot, preserving every other field and CRDT history.
 * Full-sync acknowledges publication; a separate read must prove the repair reached the source
 * before a row command can depend on it. Healthy databases remain read-only here.
 */
export async function repairLegacyDatabaseViewIds(
  requirements: DatabaseViewSourceRequirements,
  source: CollabFullSyncBatchResult,
  options: {
    owner: AtomicCreationOwner;
    signal: AbortSignal;
    deadline: number;
    assertCurrent: () => void;
    read: (signal: AbortSignal, remainingMs: number) => Promise<CollabFullSyncBatchResult>;
  }
): Promise<CollabFullSyncBatchResult | undefined> {
  const assertCurrent = () => {
    assertNotAborted(options.signal);
    options.owner.assertCurrent();
    options.assertCurrent();
    if (Date.now() >= options.deadline) throw new Error('Database view repair timed out');
  };

  assertCurrent();
  if (!remoteDatabaseCoversSource(requirements, source)) throw new Error('Database source is not ready for repair');
  const repaired = new Y.Doc();

  try {
    Y.applyUpdate(repaired, source.missingUpdate);
    const views = databaseViews(repaired, requirements.databaseId);
    const missing = missingViewIds(views, requirements.databaseId);

    if (!missing.length) return undefined;
    repaired.transact(() => {
      missing.forEach((key) => (views.get(key) as Y.Map<unknown>).set(YjsDatabaseKey.id, key));
    });
    const docState = Y.encodeStateAsUpdate(repaired);

    assertCurrent();
    const results = await collabFullSyncBatch(
      options.owner.workspaceId,
      [
        {
          objectId: requirements.databaseId,
          collabType: Types.Database,
          collabVersion: requirements.version,
          databaseRestoreId: requirements.restoreId,
          docState,
          stateVector: Y.encodeStateVector(repaired),
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

    if (
      results.length !== 1 ||
      result.objectId !== requirements.databaseId ||
      result.collabType !== Types.Database ||
      result.collabVersion !== requirements.version ||
      result.error
    ) {
      throw new Error('Database view repair was not acknowledged for the current source');
    }

    const confirmed = await waitForDatabaseViewSource(
      { ...requirements, live: docState },
      { ...options, assertCurrent }
    );
    const current = new Y.Doc();

    try {
      Y.applyUpdate(current, confirmed.missingUpdate);
      const currentViews = databaseViews(current, requirements.databaseId);

      if (
        missingViewIds(currentViews, requirements.databaseId).length ||
        missing.some((key) => {
          const view = currentViews.get(key);

          return !(view instanceof Y.Map) || view.get(YjsDatabaseKey.id) !== key;
        })
      )
        throw new Error('Database views changed during repair');
    } finally {
      current.destroy();
    }

    assertCurrent();
    return confirmed;
  } finally {
    repaired.destroy();
  }
}
