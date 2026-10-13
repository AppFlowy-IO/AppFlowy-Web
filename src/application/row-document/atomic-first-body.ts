import { v4 as uuidv4 } from 'uuid';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import {
  assertAtomicCreationAvailable,
  AtomicCreationOwner,
  AtomicCreationRecord,
  AtomicCreationReceipt,
  atomicRead,
  captureAtomicCreationOwner,
  findPendingAtomicCreation,
  PublishRowDocumentRequest,
  recoverAtomicCreation,
  runAtomicCreation,
} from '@/application/atomic-creation';
import { assertNotAborted } from '@/application/database-yjs/creation/source-readiness';
import { getMetaJSON } from '@/application/database-yjs/row_meta';
import {
  captureDatabaseStorageFence,
  db,
  getCachedProviderDoc,
  matchesDatabaseStorageFence,
  openCollabDBWithProvider,
  openRowCollabDBWithProvider,
} from '@/application/db';
import {
  DatabaseStorageFence,
  isDatabaseStorageFenceCurrent,
  withDatabaseStorageFence,
} from '@/application/db/database-storage-fence';
import { getOrCreateRowSubDoc } from '@/application/services/js-services/cache';
import { awaitAtomicRequest } from '@/application/services/js-services/http/atomic-creation-api';
import { CollabOrigin, RowDocumentSourcePayload, Types, YDoc, YDocWithMeta, YjsEditorKey } from '@/application/types';
import { determineErrorType, ErrorType } from '@/application/utils/error-utils';

import { FirstBodyContribution } from './first-body-actions';
import { persistStagedBodyCheckpoint } from './first-body-checkpoint';
import { applyFirstBodyStaging } from './first-body-staging';
import { CollabState, decodeCurrentRowPageCollab, hasCurrentRowDocumentSource, waitForRowDocumentSource } from './row-source-readiness';

export { decodeCurrentRowPageCollab } from './row-source-readiness';

const NIL = '00000000-0000-0000-0000-000000000000';
// A side peek and a full page can open the same row concurrently. Share only
// their active initialization; durable retries remain owned by the journal.
const openingRowDocuments = new Map<string, Promise<YDoc>>();

interface RestoreState {
  database_restore_id: string | null;
  version: string | null;
}
function requireMap(value: unknown): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) throw new Error('The current row-page state is incomplete.');
  return value;
}

function validateCurrentDocument(doc: Y.Doc): void {
  const body = requireMap(doc.getMap(YjsEditorKey.data_section).get('document'));
  const blocks = requireMap(body.get('blocks'));
  const metadata = requireMap(body.get('meta'));
  const children = requireMap(metadata.get('children_map'));
  const texts = requireMap(metadata.get('text_map'));
  const pageId = body.get('page_id');

  if (typeof pageId !== 'string' || requireMap(blocks.get(pageId)).get('ty') !== 'page')
    throw new Error('The current row-page root is incomplete.');
  const visited = new Set<string>();
  const stack = [{ id: pageId, parent: '' }];

  while (stack.length) {
    const { id, parent } = stack.pop()!;

    if (visited.has(id)) throw new Error('The current row-page tree contains a cycle or duplicate edge.');
    visited.add(id);
    const block = requireMap(blocks.get(id));

    if (block.get('id') !== id || (parent && block.get('parent') !== parent))
      throw new Error('The current row-page tree is incomplete.');
    if (block.get('external_type') === 'text' && !(texts.get(block.get('external_id') as string) instanceof Y.Text))
      throw new Error('The current row-page text is incomplete.');
    const listId = block.get('children');
    const list = children.get(listId as string);

    if (list !== undefined && !(list instanceof Y.Array))
      throw new Error('The current row-page children are malformed.');
    if (list === undefined && listId) throw new Error('The current row-page children are missing.');
    if (list instanceof Y.Array)
      for (const child of list.toArray()) {
        if (typeof child !== 'string') throw new Error('The current row-page child identity is malformed.');
        stack.push({ id: child, parent: id });
      }
  }
}

function orderedJson(value: unknown): string {
  const order = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(order);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, order(val)])
      );
    return input;
  };

  return JSON.stringify(order(value));
}

export async function prepareAtomicRowFirstBody(input: {
  workspaceId: string;
  documentId: string;
  source: RowDocumentSourcePayload;
  databaseDoc: YDoc;
  rowDoc: YDoc;
  name: string;
  assertWritable: () => void;
}) {
  const { workspaceId, documentId, source, databaseDoc, rowDoc } = input;
  const databaseVersion = databaseDoc.version;
  const localRestore = databaseDoc.databaseRestoreId ?? NIL;
  const rowVersion = rowDoc.version;
  let retired = false;
  const onDestroy = () => {
    retired = true;
  };

  databaseDoc.on('destroy', onDestroy);
  rowDoc.on('destroy', onDestroy);
  const dispose = () => {
    databaseDoc.off('destroy', onDestroy);
    rowDoc.off('destroy', onDestroy);
  };

  let fence: DatabaseStorageFence | undefined;

  try {
    const owner = captureAtomicCreationOwner(workspaceId, () => {
      input.assertWritable();
      if (
        retired ||
        databaseDoc.version !== databaseVersion ||
        rowDoc.version !== rowVersion ||
        (databaseDoc.databaseRestoreId ?? NIL) !== localRestore ||
        (fence && !isDatabaseStorageFenceCurrent(fence))
      ) {
        throw new Error('The row-page source or restore generation changed.');
      }
    });
    const restorePath = `/api/workspace/${workspaceId}/database/${source.database_id}/restore-state`;
    const readRestore = (currentOwner = owner, signal?: AbortSignal) =>
      atomicRead<RestoreState>(currentOwner, restorePath, undefined, signal);

    fence = await captureDatabaseStorageFence(source.database_id, { required: true });
    owner.assertCurrent();
    const before = await readRestore();
    const restoreId = before.database_restore_id ?? NIL;

    if (
      restoreId !== localRestore ||
      (before.version ?? undefined) !== databaseVersion ||
      (fence.epoch !== null && fence.epoch !== restoreId)
    )
      throw new Error('Reopen the database after its restore completes.');

    let preparedRecord: AtomicCreationRecord<'row-document'> | undefined;
    let request: PublishRowDocumentRequest | undefined;
    let stagingJson: string | undefined;
    let stagingWrites = Promise.resolve();
    let finishLiveStaging: ((doc: YDoc, assertCurrent: () => void, signal?: AbortSignal) => Promise<void>) | undefined;
    const saveStaging = (json: string): Promise<void> => {
      owner.assertCurrent();
      stagingJson = json;
      const record = preparedRecord;

      if (!record) return stagingWrites;
      stagingWrites = stagingWrites.then(() =>
        db.transaction('rw', db.atomic_creation, async () => {
          owner.assertCurrent();
          const current = await db.atomic_creation.get(record.id);

          owner.assertCurrent();
          if (!current || current.requestJson !== record.requestJson) throw new Error('The row-page journal changed.');
          await db.atomic_creation.put({ ...current, rowDocumentStagingJson: json });
        })
      );
      return stagingWrites;
    };

    const hydrate = async (
      receipt: AtomicCreationReceipt<'row-document'>,
      currentOwner: AtomicCreationOwner,
      signal: AbortSignal
    ): Promise<YDoc> => {
      if (receipt.result.database_restore_id !== restoreId)
        throw new Error('The row-page receipt belongs to another restore generation.');
      const start = await readRestore(currentOwner, signal);

      if ((start.database_restore_id ?? NIL) !== restoreId || (start.version ?? undefined) !== databaseVersion)
        throw new Error('The database was restored before row-page activation.');
      const readCollab = (objectId: string, collabType: Types) =>
        atomicRead<CollabState>(
          currentOwner,
          `/api/workspace/v1/${workspaceId}/collab/${objectId}`,
          {
            collab_type: collabType,
            ...(collabType === Types.Document
              ? { database_id: source.database_id, row_id: source.row_id, row_document_id: documentId }
              : {}),
          },
          signal
        );
      const [databaseState, rowState, documentState] = await Promise.all([
        readCollab(source.database_id, Types.Database),
        readCollab(source.row_id, Types.DatabaseRow),
        readCollab(documentId, Types.Document),
      ]);
      const temporary: Y.Doc[] = [];

      try {
        const database = decodeCurrentRowPageCollab(databaseState, source.database_id, databaseVersion ?? null);

        temporary.push(database);
        const row = decodeCurrentRowPageCollab(rowState, source.row_id, receipt.result.row_version);

        temporary.push(row);
        if ((rowDoc.version ?? null) !== (row.version ?? null)) {
          throw new Error('The live row belongs to another version; reopen it before activation.');
        }

        const document = decodeCurrentRowPageCollab(documentState, documentId, receipt.result.document_version);

        temporary.push(document);
        validateCurrentDocument(document);
        const root = requireMap(database.getMap(YjsEditorKey.data_section).get('database'));

        if (
          root.get('id') !== source.database_id ||
          !hasCurrentRowDocumentSource(root, source.database_view_id, source.row_id)
        )
          throw new Error('The row no longer belongs to its source view.');
        const rowRoot = requireMap(row.getMap(YjsEditorKey.data_section).get('data'));
        const meta = requireMap(row.getMap(YjsEditorKey.data_section).get('meta'));
        const contentFlag = getMetaJSON(source.row_id, meta).isEmptyDocument;
        // Rust RowMeta treats an absent flag as empty. Initial rows created by
        // Desktop/server can omit the key; do not publish a new Row mutation.
        const isEmptyDocument = contentFlag ?? true;
        // Schema initialization does not imply authored content. A concurrent
        // creator may also have filled the document already; retain that body.
        const createsEmptySchema = request?.contribution.kind === 'default_schema';

        if (
          rowRoot.get('id') !== source.row_id ||
          rowRoot.get('database_id') !== source.database_id ||
          (createsEmptySchema
            ? contentFlag !== undefined && typeof contentFlag !== 'boolean'
            : contentFlag !== false)
        )
          throw new Error('The current row has not activated this body.');
        const end = await readRestore(currentOwner, signal);

        if (
          (end.database_restore_id ?? NIL) !== restoreId ||
          (end.version ?? undefined) !== databaseVersion ||
          !(await matchesDatabaseStorageFence(fence!))
        )
          throw new Error('The database changed during row-page activation.');
        currentOwner.assertCurrent();
        // Opening the normal cache happens only after the durable ACK and independent
        // current-state validation. The detached draft update is never imported.
        const canonical = await getOrCreateRowSubDoc(documentId);

        currentOwner.assertCurrent();
        if (
          (canonical.version ?? null) !== (document.version ?? null) &&
          (canonical.version !== undefined || canonical.getMap(YjsEditorKey.data_section).has('document'))
        )
          throw new Error('The cached row-page belongs to another version.');
        const [documentEntry, rowEntry] = await Promise.all([
          openCollabDBWithProvider(documentId, { awaitSync: true }),
          openRowCollabDBWithProvider(source.row_id, { awaitSync: true }),
        ]);
        const assertProviders = async () => {
          currentOwner.assertCurrent();
          if (
            documentEntry.doc !== canonical ||
            rowEntry.doc !== rowDoc ||
            getCachedProviderDoc(documentId) !== canonical ||
            getCachedProviderDoc(source.row_id) !== rowDoc ||
            !(await matchesDatabaseStorageFence(fence!))
          ) {
            throw new Error('The row-page cache provider changed before activation.');
          }

          currentOwner.assertCurrent();
        };

        // The existing providers own their storage lifetimes. Persist only a
        // matching current version; never force-reset old or unversioned edits.
        await assertProviders();
        await Promise.all(
          [
            { ...documentEntry, remote: document },
            { ...rowEntry, remote: row },
          ].map(async ({ doc, provider, remote }) => {
            const key = `${doc.guid}/version`;
            const stored = await provider.get(key);

            await assertProviders();
            if (stored !== undefined && stored !== null && stored !== remote.version)
              throw new Error('The persisted row-page cache belongs to another version.');
            if (remote.version !== undefined && stored !== remote.version) {
              await provider.set(key, remote.version);
              await assertProviders();
              if ((await provider.get(key)) !== remote.version)
                throw new Error('The row-page version was not persisted.');
              await assertProviders();
            }
          })
        );
        const afterMetadata = await readRestore(currentOwner, signal);

        if (
          (afterMetadata.database_restore_id ?? NIL) !== restoreId ||
          (afterMetadata.version ?? undefined) !== databaseVersion
        )
          throw new Error('The database changed while persisting row-page metadata.');
        await assertProviders();
        withDatabaseStorageFence(canonical, fence, () =>
          Y.applyUpdate(canonical, Y.encodeStateAsUpdate(document), CollabOrigin.Remote)
        );
        if (
          !stagingJson &&
          orderedJson(canonical.getMap(YjsEditorKey.data_section).toJSON()) !==
            orderedJson(document.getMap(YjsEditorKey.data_section).toJSON())
        )
          throw new Error('The row-page cache is not current yet.');
        currentOwner.assertCurrent();
        withDatabaseStorageFence(rowDoc, fence, () =>
          Y.applyUpdate(rowDoc, Y.encodeStateAsUpdate(row), CollabOrigin.Remote)
        );
        if (
          (getMetaJSON(source.row_id, requireMap(rowDoc.getMap(YjsEditorKey.data_section).get('meta')))
            .isEmptyDocument ?? true) !== isEmptyDocument
        )
          throw new Error('The live row metadata has not activated.');
        if (!('whenPersisted' in rowEntry.provider)) throw new Error('The row metadata provider cannot confirm persistence.');
        await rowEntry.provider.whenPersisted();
        await assertProviders();
        canonical.version = document.version;
        canonical.databaseRestoreId = restoreId;
        Object.assign(canonical as YDocWithMeta, {
          object_id: documentId,
          view_id: documentId,
          _collabType: Types.Document,
          _syncBound: false,
        });
        return canonical;
      } finally {
        temporary.forEach((doc) => doc.destroy());
      }
    };

    const pending = await findPendingAtomicCreation(owner, 'row-document', documentId);

    const runAttempt = async (record?: AtomicCreationRecord<'row-document'>): Promise<YDoc> => {
      // Start the budget when a completed command/recovery is accepted, not
      // while a user is still editing an empty card or uploading its first file.
      const controller = new AbortController();
      const deadline = Date.now() + 30_000;
      const timer = setTimeout(() => controller.abort(new Error('Row-page creation timed out.')), 30_000);
      const currentOwner: AtomicCreationOwner = {
        ...owner,
        assertCurrent: () => {
          assertNotAborted(controller.signal);
          owner.assertCurrent();
        },
      };
      const readSource = async (signal: AbortSignal) => {
        const read = (id: string, type: Types) =>
          atomicRead<CollabState>(
            currentOwner,
            `/api/workspace/v1/${workspaceId}/collab/${id}`,
            { collab_type: type },
            signal
          );
        const [database, row, restore] = await Promise.all([
          read(source.database_id, Types.Database),
          read(source.row_id, Types.DatabaseRow).catch((error) => {
            if (determineErrorType(error).type === ErrorType.PageNotFound) return undefined;
            throw error;
          }),
          readRestore(currentOwner, signal),
        ]);

        currentOwner.assertCurrent();
        if (
          (restore.database_restore_id ?? NIL) !== restoreId ||
          (restore.version ?? undefined) !== databaseVersion ||
          !(await matchesDatabaseStorageFence(fence!))
        ) {
          throw new Error('The row source changed while normal sync was completing.');
        }

        currentOwner.assertCurrent();
        return { database, row };
      };

      const beforeSubmit = async () => {
        await waitForRowDocumentSource(
          {
            databaseId: source.database_id,
            sourceViewId: source.database_view_id,
            rowId: source.row_id,
            databaseVersion,
            rowVersion,
          },
          {
            read: readSource,
            assertCurrent: currentOwner.assertCurrent,
            signal: controller.signal,
            deadline,
          }
        );
      };

      try {
        return await awaitAtomicRequest(
          (async () => {
            const current = record ?? (await findPendingAtomicCreation(currentOwner, 'row-document', documentId));
            const options = {
              owner: currentOwner,
              beforeSubmit,
              signal: controller.signal,
              onPrepared: async (record: AtomicCreationRecord<'row-document'>) => {
                preparedRecord = record;
                // Recovery must validate the original recipe, even if opening
                // this page now requested an empty schema instead.
                request = JSON.parse(record.requestJson) as PublishRowDocumentRequest;
                stagingJson ??= record.rowDocumentStagingJson;
                // A deliberate retry may repair a transient IndexedDB failure.
                stagingWrites = stagingWrites.catch(() => undefined);
                if (stagingJson) await saveStaging(stagingJson);
              },
              hydrate: async (receipt: AtomicCreationReceipt<'row-document'>, hydratedOwner: AtomicCreationOwner) => {
                const canonical = await hydrate(receipt, hydratedOwner, controller.signal);

                hydratedOwner.assertCurrent();
                if (finishLiveStaging) await finishLiveStaging(canonical, hydratedOwner.assertCurrent, controller.signal);
                else if (stagingJson) {
                  const entry = await openCollabDBWithProvider(documentId, { awaitSync: true });
                  const checkpoint = await entry.provider.get(`${documentId}/first-body-stage`);

                  hydratedOwner.assertCurrent();
                  if (entry.doc !== canonical || !(await matchesDatabaseStorageFence(fence!)))
                    throw new Error('The row-page cache changed while recovering your edits.');
                  hydratedOwner.assertCurrent();
                  if (checkpoint !== stagingJson) applyFirstBodyStaging(canonical, stagingJson);
                }

                await stagingWrites;
                hydratedOwner.assertCurrent();
                if (stagingJson) {
                  const entry = await openCollabDBWithProvider(documentId, { awaitSync: true });

                  hydratedOwner.assertCurrent();
                  if (entry.doc !== canonical || !(await matchesDatabaseStorageFence(fence!)))
                    throw new Error('The row-page storage changed before saving your edits.');
                  hydratedOwner.assertCurrent();
                  if (!(entry.provider instanceof IndexeddbPersistence)) throw new Error('The row-page provider cannot checkpoint staged edits.');
                  await persistStagedBodyCheckpoint(canonical, entry.provider, stagingJson, {
                    signal: controller.signal,
                    assertCurrent: () => {
                      hydratedOwner.assertCurrent();
                      if (getCachedProviderDoc(documentId) !== canonical) throw new Error('The row-page provider was replaced.');
                    },
                  });
                  hydratedOwner.assertCurrent();
                }

                return canonical;
              },
            };

            if (current) return await recoverAtomicCreation({ ...options, record: current });
            if (!request) throw new Error('The row-page command has not been prepared.');
            return await runAtomicCreation({ ...options, kind: 'row-document', request, logicalTarget: documentId });
          })(),
          controller.signal
        );
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    };

    let activeAttempt: Promise<YDoc> | undefined;
    const attempt = (record?: AtomicCreationRecord<'row-document'>): Promise<YDoc> => {
      activeAttempt ??= runAttempt(record).finally(() => { activeAttempt = undefined; });
      return activeAttempt;
    };

    const prepareRequest = (contribution: PublishRowDocumentRequest['contribution']) => {
      request ??= {
        request_id: uuidv4(),
        database_id: source.database_id,
        database_restore_id: restoreId,
        row_id: source.row_id,
        source_view_id: source.database_view_id,
        name: input.name,
        contribution,
      };
    };

    return {
      owner,
      dispose,
      pending: pending ? () => attempt(pending) : undefined,
      admit: () => assertAtomicCreationAvailable(owner),
      saveStaging,
      createEmpty: async (): Promise<YDoc> => {
        owner.assertCurrent();
        const key = JSON.stringify([
          owner.serverUrl, owner.userId, owner.workspaceId, documentId,
          restoreId, databaseVersion, rowVersion,
        ]);
        let opening = openingRowDocuments.get(key);

        if (!opening) {
          // Never create a client-side blank draft or mark its Row nonempty.
          // Existing authored commands take precedence inside attempt().
          prepareRequest({ kind: 'default_schema', schema_version: 'v1' });
          opening = attempt(pending).finally(() => { openingRowDocuments.delete(key); });
          openingRowDocuments.set(key, opening);
        }

        const canonical = await opening;

        owner.assertCurrent();
        if (getCachedProviderDoc(documentId) !== canonical || getCachedProviderDoc(source.row_id) !== rowDoc)
          throw new Error('The row-page cache provider changed before activation.');
        return canonical;
      },
      publish: async (
        contribution: FirstBodyContribution,
        finish?: (doc: YDoc, assertCurrent: () => void, signal?: AbortSignal) => Promise<void>
      ) => {
        finishLiveStaging = finish;
        prepareRequest(contribution);
        return attempt();
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function hasPendingAtomicRowFirstBody(workspaceId: string, documentId: string): Promise<boolean> {
  const owner = captureAtomicCreationOwner(workspaceId);

  return Boolean(await findPendingAtomicCreation(owner, 'row-document', documentId));
}
