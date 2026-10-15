import { utf8ByteLength } from 'lib0/string';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { assertAtomicCreationAvailable, captureAtomicCreationOwner } from '@/application/atomic-creation/owner';
import { getMetaJSON } from '@/application/database-yjs/row_meta';
import type { DatabaseRowTemplate } from '@/application/database-yjs/template';
import {
  captureDatabaseStorageFence,
  matchesDatabaseStorageFence,
  publishWithDatabaseStorageFence,
} from '@/application/db';
import { isDatabaseStorageFenceCurrent, withDatabaseStorageFence } from '@/application/db/database-storage-fence';
import { ClientValidationError } from '@/application/errors/client-validation-error';
import { createRow as openCachedRow } from '@/application/services/js-services/cache';
import { atomicRead } from '@/application/services/js-services/http/atomic-creation-api';
import { postDefaultRowCreation } from '@/application/services/js-services/http/atomic-row-creation-api';
import { collabFullSyncBatch } from '@/application/services/js-services/http/collab-api';
import { Types, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';

import { decodeBase64Bytes, decodeCreatedRowCollab, encodeCreationCollab } from './encoded-collab';
import { recordCommittedRowCreation } from './row-creation-history';
import { CreatedRowReceipt, DefaultRowRequest, PreparedRowIntent } from './row-creation-types';
import { prepareTemplateRowGraph } from './row-template-graph';
import type { PreparedTemplateRowGraph } from './row-template-graph-types';
import {
  assertNotAborted,
  ORIGINAL_DATABASE_RESTORE_ID,
  readPersistedDatabaseSource,
  waitForDatabaseViewSource,
} from './source-readiness';
import { submitTemplateRow } from './submit-template-row';

export interface CloudRowCreationIntent extends PreparedRowIntent {
  workspaceId: string;
  databaseId: string;
  databaseDoc: YDoc;
  sourceViewId: string;
  rowKey: string;
  assertCurrent(): void;
  registerRow(): Promise<YDoc>;
  template?: DatabaseRowTemplate;
  documentState?: Uint8Array;
  /** Copies retain raw storage types, including cells awaiting a field conversion. */
  preserveCellStorage?: boolean;
  historyGroup?: object;
}

/** Freeze resolved cells, without uploading client-owned author, clock, or Row schema fields. */
export function prepareDefaultRowRequest(intent: CloudRowCreationIntent, requestId: string): DefaultRowRequest {
  const data = intent.rowDoc.getMap(YjsEditorKey.data_section);
  const row = data.get(YjsEditorKey.database_row);
  const meta = data.get(YjsEditorKey.meta);

  if (
    !(row instanceof Y.Map) ||
    row.get('id') !== intent.rowId ||
    row.get('database_id') !== intent.databaseId ||
    !(row.get('cells') instanceof Y.Map) ||
    !(meta instanceof Y.Map)
  )
    throw new Error('Prepared Row is incomplete');
  const presentation = getMetaJSON(intent.rowId, meta);

  if (presentation.isEmptyDocument === false && !intent.documentState)
    throw new Error('A nonempty template requires its complete creation graph');
  const cells = Object.fromEntries(
    Object.entries((row.get('cells') as Y.Map<Y.Map<unknown>>).toJSON()).map(([id, cell]) => [
      id,
      Object.fromEntries(Object.entries(cell as Record<string, unknown>).filter(([, value]) => value !== undefined)),
    ])
  ) as DefaultRowRequest['cells'];

  // JSON.stringify silently drops undefined/nonfinite values; reject them before freezing retries.
  const check = (value: unknown, depth = 0): void => {
    if (depth > 64) throw new Error('Row cells are nested too deeply');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      value.forEach((child) => check(child, depth + 1));
      return;
    }

    if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
      Object.values(value).forEach((child) => check(child, depth + 1));
      return;
    }

    throw new Error('Row cells contain unsupported values');
  };

  check(cells);
  const request: DefaultRowRequest = {
    schema_version: 'v1',
    request_id: requestId,
    row_id: intent.rowId,
    database_restore_id: intent.databaseDoc.databaseRestoreId ?? ORIGINAL_DATABASE_RESTORE_ID,
    source_view_id: intent.sourceViewId,
    cells,
    height: Number(row.get('height')),
    visibility: row.get('visibility') === true,
    position: intent.position,
    presentation: {
      icon_url: presentation.icon || null,
      cover: presentation.cover
        ? {
            data: presentation.cover.data,
            cover_type: presentation.cover.cover_type,
            upload_type: Number((presentation.cover as { upload_type?: number }).upload_type ?? 0),
            offset: presentation.cover.offset ?? 0,
          }
        : null,
    },
  };

  if (!Number.isInteger(request.height) || request.height <= 0) throw new Error('Prepared Row height is invalid');
  if (utf8ByteLength(JSON.stringify(request)) > 1024 * 1024) {
    throw new Error('Prepared Row exceeds the creation request size');
  }

  return request;
}

function assertRow(doc: Y.Doc, rowId: string, databaseId: string): void {
  const row = doc.getMap('data').get('data');

  if (
    doc.store.pendingDs ||
    doc.store.pendingStructs ||
    !(row instanceof Y.Map) ||
    row.get('id') !== rowId ||
    row.get('database_id') !== databaseId ||
    !(row.get('cells') instanceof Y.Map)
  ) {
    throw new Error('Created Row identity or history differs');
  }
}

function assertMembership(doc: Y.Doc, databaseId: string, viewId: string, rowId: string): void {
  const database = doc.getMap('data').get('database');
  const views = database instanceof Y.Map ? database.get('views') : undefined;
  const view = views instanceof Y.Map ? views.get(viewId) : undefined;
  const orders = view instanceof Y.Map ? view.get('row_orders') : undefined;

  if (
    doc.store.pendingDs ||
    doc.store.pendingStructs ||
    !(database instanceof Y.Map) ||
    database.get('id') !== databaseId ||
    !(orders instanceof Y.Array) ||
    !orders.toArray().some((order: { id?: string }) => order.id === rowId)
  ) {
    throw new Error('Created Row membership is incomplete');
  }
}

function validateReceipt(receipt: CreatedRowReceipt, request: DefaultRowRequest, databaseId: string, version?: string) {
  if (
    !receipt ||
    receipt.request_id !== request.request_id ||
    !['applied', 'already_applied'].includes(receipt.outcome) ||
    receipt.result?.row_id !== request.row_id ||
    receipt.result.database_id !== databaseId ||
    receipt.result.database_restore_id !== request.database_restore_id ||
    (receipt.result.database_version ?? undefined) !== version ||
    !receipt.result.update_batch_id
  ) {
    throw new Error('Created Row receipt does not match its command');
  }
}

/** A confirmed commit is never described as a failed create or queued for a later gesture. */
export class CommittedRowActivationError extends ClientValidationError {
  constructor(readonly rowId: string, readonly cause: unknown) {
    super('ATOMIC_ROW_CREATED_RELOAD');
    this.name = 'CommittedRowActivationError';
  }
}

/** The server publishes Row + membership; the client only activates the committed graph. */
export async function createCloudRow(intent: CloudRowCreationIntent): Promise<string> {
  let destroyed = false;
  let committed = false;
  const onDestroy = () => {
    destroyed = true;
  };

  const { databaseDoc, databaseId, workspaceId, rowId, sourceViewId } = intent;
  const version = databaseDoc.version;
  const restoreId = databaseDoc.databaseRestoreId ?? ORIGINAL_DATABASE_RESTORE_ID;
  let fence: Awaited<ReturnType<typeof captureDatabaseStorageFence>> | undefined;
  const controller = new AbortController();
  const deadline = Date.now() + 30_000;
  const owner = captureAtomicCreationOwner(workspaceId, () => {
    assertNotAborted(controller.signal);
    intent.assertCurrent();
    if (
      destroyed ||
      databaseDoc.version !== version ||
      (databaseDoc.databaseRestoreId ?? ORIGINAL_DATABASE_RESTORE_ID) !== restoreId ||
      (fence && !isDatabaseStorageFenceCurrent(fence))
    )
      throw new Error('Row creation owner changed');
  });
  const timeout = setTimeout(() => controller.abort(new Error('Row creation timed out')), 30_000);

  databaseDoc.on('destroy', onDestroy);
  try {
    assertAtomicCreationAvailable(owner);
    const request = prepareDefaultRowRequest(intent, uuidv4());
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const anchor = 'row_id' in intent.position ? intent.position.row_id : undefined;
    // The seeded contract appends in unselected views. Preserve placement wherever
    // the anchor is active, and let views without it receive the normal append.
    const positionViewIds: string[] = [];

    database.get(YjsDatabaseKey.views).forEach((view, id) => {
      if (
        id === sourceViewId ||
        !anchor ||
        view.get(YjsDatabaseKey.row_orders).toArray().some((row) => row.id === anchor && !row.is_deleted)
      )
        positionViewIds.push(id);
    });
    const graph: PreparedTemplateRowGraph | undefined =
      intent.documentState && intent.template
        ? await prepareTemplateRowGraph({
            owner,
            databaseId,
            restoreId,
            sourceViewId,
            requestId: request.request_id,
            rowId,
            position: intent.position,
            positionViewIds,
            rowDoc: intent.rowDoc,
            template: intent.template,
            documentState: intent.documentState,
            signal: controller.signal,
            deadline,
            assertCurrent: () => owner.assertCurrent(),
          })
        : intent.preserveCellStorage
        ? {
            kind: 'seeded',
            request: {
              request_id: request.request_id,
              database_restore_id: restoreId,
              source_view_id: sourceViewId,
              row: { row_id: rowId, collab: encodeCreationCollab(intent.rowDoc) },
              position: intent.position,
              position_view_ids: positionViewIds,
            },
          }
        : undefined;

    fence = await captureDatabaseStorageFence(databaseId, { required: true });
    const capturedFence = fence;
    const assertCurrent = () => owner.assertCurrent();
    const checkRestore = async () => {
      const restore = await atomicRead<{ database_restore_id: string | null; version: string | null }>(
        owner,
        `/api/workspace/${workspaceId}/database/${databaseId}/restore-state`,
        undefined,
        controller.signal
      );

      assertCurrent();
      if (
        (restore.database_restore_id ?? ORIGINAL_DATABASE_RESTORE_ID) !== restoreId ||
        (restore.version ?? undefined) !== version ||
        !(await matchesDatabaseStorageFence(capturedFence))
      ) {
        throw new Error('Row creation source was restored');
      }

      assertCurrent();
    };

    const read = async (ids: { objectId: string; collabType: Types }[]) => {
      const result = await collabFullSyncBatch(
        workspaceId,
        ids.map((identity) => ({
          ...identity,
          stateVector: new Uint8Array([0]),
          docState: new Uint8Array(),
          collabVersion: identity.collabType === Types.Database ? version : undefined,
          databaseRestoreId: restoreId,
        })),
        { atomicCreationOwner: owner, signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()) }
      );

      assertCurrent();
      return result;
    };

    // Newly added fields and deletion-only edits must reach the source before the command.
    const requirements = {
      databaseId,
      restoreId,
      version,
      live: Y.encodeStateAsUpdate(databaseDoc),
      persisted: await readPersistedDatabaseSource(databaseDoc, controller.signal, capturedFence),
    };

    await checkRestore();
    await waitForDatabaseViewSource(requirements, {
      read: async () => {
        const result = await read([{ objectId: databaseId, collabType: Types.Database }]);

        if (result.length !== 1) throw new Error('Database source response is ambiguous');
        return result[0];
      },
      assertCurrent,
      signal: controller.signal,
      deadline,
    });
    assertCurrent();
    const receipt = graph
      ? await submitTemplateRow(owner, databaseId, graph, version, controller.signal, deadline)
      : await postDefaultRowCreation(owner, databaseId, request, controller.signal, deadline);

    assertCurrent();
    validateReceipt(receipt, request, databaseId, version);
    committed = true;
    // Validate the restore boundary once immediately before publication below.
    // An extra read here adds a network round trip without protecting a later boundary.
    let rowState: Uint8Array | undefined;
    let databaseUpdate: Uint8Array | undefined;

    if (receipt.outcome === 'applied' && receipt.activation) {
      const row = new Y.Doc();
      const candidate = new Y.Doc();

      try {
        const hint = decodeCreatedRowCollab(receipt.activation.row_encoded_collab_v1);

        if (hint.encoder === 1) Y.applyUpdate(row, hint.state);
        else Y.applyUpdateV2(row, hint.state);
        assertRow(row, rowId, databaseId);
        const update = decodeBase64Bytes(receipt.result.database_update_v1, 1024 * 1024);

        Y.applyUpdate(candidate, Y.encodeStateAsUpdate(databaseDoc));
        Y.applyUpdate(candidate, update);
        assertMembership(candidate, databaseId, sourceViewId, rowId);
        rowState = Y.encodeStateAsUpdate(row);
        databaseUpdate = update;
      } catch {
        // Hints are optional. A malformed or causally incomplete hint must use current authority.
      } finally {
        row.destroy();
        candidate.destroy();
      }
    }

    if (!rowState || !databaseUpdate) {
      const results = await read([
        { objectId: databaseId, collabType: Types.Database },
        { objectId: rowId, collabType: Types.DatabaseRow },
      ]);
      const decode = (id: string, type: Types) => {
        const result = results.find((item) => item.objectId === id && item.collabType === type);

        if (!result || result.error || result.collabVersion !== (type === Types.Database ? version : undefined)) {
          throw new Error('Created Row is no longer readable');
        }

        return result;
      };

      const currentDatabase = decode(databaseId, Types.Database);
      const currentRow = decode(rowId, Types.DatabaseRow);
      const row = new Y.Doc();
      const current = new Y.Doc();

      try {
        Y.applyUpdate(row, currentRow.missingUpdate);
        Y.applyUpdate(current, currentDatabase.missingUpdate);
        assertRow(row, rowId, databaseId);
        assertMembership(current, databaseId, sourceViewId, rowId);
        rowState = currentRow.missingUpdate;
        databaseUpdate = currentDatabase.missingUpdate;
      } finally {
        row.destroy();
        current.destroy();
      }
    }

    await checkRestore();
    const localRow = await openCachedRow(intent.rowKey);

    assertCurrent();
    const published = await publishWithDatabaseStorageFence(capturedFence, () => {
      assertCurrent();
      withDatabaseStorageFence(localRow, capturedFence, () => applyYDoc(localRow, rowState!));
      withDatabaseStorageFence(databaseDoc, capturedFence, () => applyYDoc(databaseDoc, databaseUpdate!));
    });

    if (!published) throw new Error('Database storage changed before Row activation');
    assertCurrent();
    const registered = await intent.registerRow();

    if (registered !== localRow) throw new Error('Created Row provider did not bind its activated cache');
    assertCurrent();
    recordCommittedRowCreation(databaseDoc, rowId, intent.historyGroup);
    return rowId;
  } catch (error) {
    if (committed) throw new CommittedRowActivationError(rowId, error);
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    databaseDoc.off('destroy', onDestroy);
  }
}
