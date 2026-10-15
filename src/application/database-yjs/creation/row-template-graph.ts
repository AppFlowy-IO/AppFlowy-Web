import { fromBase64 } from 'lib0/buffer';
import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { Types } from '@/application/types';

import { encodeCreationCollab } from './encoded-collab';
import { LegacyTemplateSnapshots } from './legacy-template-snapshots';
import {
  archivedRowDocument,
  blockData,
  blockViews,
  databaseDocument,
  DATABASE_BLOCKS,
  detachedDocument,
  documentBlocks,
  excludeInactiveRows,
  FOLDER_LAYOUTS,
  GRAPH_LIMIT,
  INLINE_LIMIT,
  normalizeView,
  parseArchive,
  record,
  remapReferences,
  remapRelationFilters,
  uuid,
} from './row-template-graph-data';
import { TemplateSources } from './row-template-graph-sources';

import type {
  ClaimCompoundCreationRequest,
  CompoundDatabaseExtension,
  CompoundFolderView,
  PreparedTemplateRowGraph,
  TemplateDatabaseArchive,
  TemplateDatabaseView,
  TemplateRecord,
  TemplateRowGraphInput,
} from './row-template-graph-types';

export type {
  ClaimCompoundCreationRequest,
  CreateDatabaseRowRequest,
  PreparedTemplateRowGraph,
  TemplateRowGraphInput,
} from './row-template-graph-types';

interface Mount {
  sourceId: string;
  databaseId: string;
  parentDocument: string;
  primary: string;
  linked: boolean;
}
interface OwnedDocument {
  sourceId: string;
  targetId: string;
  doc: Y.Doc;
  parentDocument?: string;
  name?: string;
  row?: { id: string; databaseId: string };
}

/** Freeze a complete template graph without making its rows, views or documents locally visible. */
export async function prepareTemplateRowGraph(input: TemplateRowGraphInput): Promise<PreparedTemplateRowGraph> {
  const check = () => {
    input.owner.assertCurrent();
    input.assertCurrent();
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Template creation cancelled');
    if (Date.now() >= input.deadline) throw new Error('Template creation preparation expired');
  };

  check();
  for (const id of [input.databaseId, input.sourceViewId, input.requestId, input.rowId]) uuid(id, 'creation');
  const identity = (kind: string, source: string) => uuidv5(`${kind}:${source}`, input.requestId);
  const documentId = uuidv5('document_id', input.rowId);
  const owned: Y.Doc[] = [];
  const seedKinds = new Map<string, 'document' | 'database' | 'database_row'>();
  const seeds = new Map<string, string>();
  let totalBytes = 0;
  const addSeed = (id: string, kind: 'document' | 'database' | 'database_row', doc: Y.Doc) => {
    check();
    if (seeds.has(id)) throw new Error('Template graph repeats a creation identity');
    const seed = encodeCreationCollab(doc);
    const length = fromBase64(seed).length;

    totalBytes += length;
    if (length > INLINE_LIMIT || totalBytes > GRAPH_LIMIT || seeds.size >= 4096)
      throw new Error('Template graph exceeds its size limit');
    seeds.set(id, seed);
    seedKinds.set(id, kind);
  };

  try {
    const row = detachedDocument(Y.encodeStateAsUpdate(input.rowDoc), input.rowId);

    owned.push(row);
    const rowRoot = row.getMap('data').get('data');
    const rowMeta = row.getMap('data').get('meta');

    if (
      !(rowRoot instanceof Y.Map) ||
      rowRoot.get('id') !== input.rowId ||
      rowRoot.get('database_id') !== input.databaseId ||
      !(rowMeta instanceof Y.Map)
    )
      throw new Error('Prepared template row identity changed');
    rowMeta.set(uuidv5('is_document_empty', input.rowId), false);
    const document = detachedDocument(input.documentState, documentId);

    owned.push(document);
    documentBlocks(document);
    const documents: OwnedDocument[] = [{ sourceId: input.template.docViewId, targetId: documentId, doc: document }];
    const archives = new Map<string, TemplateDatabaseArchive>();
    const mounts = new Map<string, Mount>();
    const snapshots = new Map(input.template.embeddedDatabases.map((snapshot) => [snapshot.sourceViewId, snapshot]));

    if (snapshots.size !== input.template.embeddedDatabases.length)
      throw new Error('Template repeats a database snapshot');
    if (snapshots.size > 64) throw new Error('Template has too many database snapshots');
    const parsedArchives = new Map<string, TemplateDatabaseArchive>();
    const sources = new TemplateSources(input, check);
    const legacyTemplates = new LegacyTemplateSnapshots(sources, check);
    const ids = new Map<string, string>();
    const copiedDatabases = new Set<string>();
    const copiedRows = new Set<string>();
    const discoveredArchives = new Set<string>();
    const frozenArchives = new Map<string, TemplateDatabaseArchive>();
    const resolvedBlocks = new Map<Y.Map<unknown>, string[]>();
    const containerAliases = new Map<string, string>();

    for (let cursor = 0; cursor < documents.length; cursor++) {
      const current = documents[cursor];
      const blocks = [...documentBlocks(current.doc).values()];
      const childIds: string[] = [];
      const discoveredDocuments = new Set(documents.map((item) => item.sourceId));

      for (const block of blocks) {
        if (!(block instanceof Y.Map)) throw new Error('Invalid template document block');
        if (block.get('ty') === 'sub_page') {
          const sourceId = uuid(blockData(block).viewId, 'child document');

          if (discoveredDocuments.has(sourceId))
            throw new Error('Template child document has duplicate ownership');
          discoveredDocuments.add(sourceId);
          childIds.push(sourceId);
        }
      }

      // Siblings are independent. Bound metadata fan-out and batch their bodies
      // after ownership validation, instead of paying two round trips per child.
      for (let start = 0; start < childIds.length; start += 8) {
        const chunk = childIds.slice(start, start + 8);
        const views = await Promise.all(chunk.map((sourceId) => sources.view(sourceId)));

        for (const source of views) {
          if (source.parent_view_id !== current.sourceId || source.layout !== 0)
            throw new Error('Template child document ownership changed');
        }

        const childDocs = await sources.documents(chunk, Types.Document);

        owned.push(...childDocs);
        childDocs.forEach((doc, index) => {
          const sourceId = chunk[index];
          const targetId = identity('document', sourceId);

          ids.set(sourceId, targetId);
          documents.push({ sourceId, targetId, doc, name: views[index].name, parentDocument: current.targetId });
        });
      }

      for (const block of blocks) {
        if (!DATABASE_BLOCKS.has(String(block.get('ty')))) continue;
        const data = blockData(block);
        const originalViews = blockViews(data);
        const viewIds: string[] = [];
        const legacyOwnership = new Map<string, boolean>();

        // Older documents mount a Folder wrapper instead of its tabs. Expand the actual child
        // mounts from the Folder response, not every unrelated view of the shared backing.
        for (const sourceId of originalViews) {
          if (snapshots.has(sourceId) || (cursor === 0 && input.template.documentData?.length)) {
            viewIds.push(sourceId);
            continue;
          }

          const resolved = await sources.mounts(sourceId, current.sourceId, data.database_id);

          for (const mount of resolved) {
            viewIds.push(mount.viewId);
            legacyOwnership.set(mount.viewId, mount.linked);
          }

          if (resolved[0].viewId !== sourceId) containerAliases.set(sourceId, resolved[0].viewId);
        }

        resolvedBlocks.set(block, viewIds);

        if (!viewIds.length) throw new Error('Template database block has no view');
        const explicitLinked = viewIds.map((id) => snapshots.get(id)?.isLinked).find((value) => value !== undefined);

        for (const sourceId of viewIds) {
          check();
          const snapshot = snapshots.get(sourceId);
          let archive: TemplateDatabaseArchive;
          let linked = explicitLinked ?? false;

          if (snapshot) {
            const cached = parsedArchives.get(snapshot.rawData);

            archive = cached ?? parseArchive(snapshot.rawData, snapshot.sourceDatabaseId || undefined);
            if (snapshot.sourceDatabaseId && snapshot.sourceDatabaseId !== archive.database_id)
              throw new Error('Template archive database identity changed');
            // Compare original snapshots, not the active-only archive prepared for copying.
            const previous = frozenArchives.get(archive.database_id) ?? archives.get(archive.database_id);

            if (previous && previous !== archive && JSON.stringify(previous) !== JSON.stringify(archive))
              throw new Error('Template database has conflicting archived snapshots');
            parsedArchives.set(snapshot.rawData, archive);
            frozenArchives.set(archive.database_id, archive);
          } else {
            // A Desktop frozen snapshot must be complete. Only legacy live templates may discover
            // dependencies through their authoritative Folder mounts.
            if (cursor === 0 && input.template.documentData?.length)
              throw new Error('Template database snapshot is missing');
            const view = await sources.view(sourceId);
            const databaseId = uuid(view.extra?.database_id ?? data.database_id, 'mounted database');
            const source = await sources.database(databaseId);

            archive = source.archive;
            linked = legacyOwnership.get(sourceId) ?? view.parent_view_id !== current.sourceId;
          }

          if (!archive.views.some((view) => view.id === sourceId && !view.is_inline)) {
            throw new Error('Template snapshot view is missing');
          }

          // A row template can reference its own database, but can never own it.
          if (archive.database_id === input.databaseId) linked = true;
          const previous = mounts.get(sourceId);
          const mount: Mount = {
            sourceId,
            databaseId: archive.database_id,
            parentDocument: current.targetId,
            primary: viewIds[0],
            linked,
          };

          if (
            previous &&
            (previous.parentDocument !== mount.parentDocument ||
              previous.primary !== mount.primary ||
              previous.databaseId !== mount.databaseId)
          )
            throw new Error('Template view has conflicting block owners');
          mounts.set(sourceId, mount);
          ids.set(sourceId, identity('view', sourceId));
          if (!linked) copiedDatabases.add(archive.database_id);
          const prior = archives.get(archive.database_id);

          if (!prior || (snapshot && !discoveredArchives.has(archive.database_id)))
            archives.set(archive.database_id, archive);
        }
      }

      // Discover every owned archive before walking its row documents. A link back to a copied
      // database joins that one backing instead of accidentally modifying its live source.
      for (const databaseId of copiedDatabases) {
        if (discoveredArchives.has(databaseId)) continue;
        discoveredArchives.add(databaseId);
        ids.set(databaseId, identity('database', databaseId));
        let archive = archives.get(databaseId)!;

        if (!frozenArchives.has(databaseId)) {
          archive = await sources.completeDatabase(databaseId);
        }

        archive = excludeInactiveRows(archive);
        archives.set(databaseId, archive);
        for (const sourceRow of archive.rows) {
          const rowId = uuid(sourceRow.id, 'row');

          if (copiedRows.has(rowId)) throw new Error('Template row is owned by multiple databases');
          copiedRows.add(rowId);
          ids.set(rowId, identity('row', rowId));
        }

        const nonempty = archive.rows.filter(
          (sourceRow) => archive.row_metas?.[String(sourceRow.id)]?.is_document_empty === false
        );
        const sourceDocs = await sources.documents(
          nonempty.map((sourceRow) => uuidv5('document_id', String(sourceRow.id))),
          Types.Document
        );

        owned.push(...sourceDocs);
        for (let index = 0; index < sourceDocs.length; index++) {
          const sourceRowId = String(nonempty[index].id);
          const targetRowId = ids.get(sourceRowId)!;
          const targetId = uuidv5('document_id', targetRowId);

          ids.set(sourceDocs[index].guid, targetId);
          documents.push({
            sourceId: sourceDocs[index].guid,
            targetId,
            doc: sourceDocs[index],
            row: { id: targetRowId, databaseId },
          });
        }
      }

      if (mounts.size + documents.length > 1024 || copiedRows.size + documents.length + copiedDatabases.size > 4096) {
        throw new Error('Template graph exceeds its object limit');
      }
    }

    for (const [container, child] of containerAliases) ids.set(container, ids.get(child)!);

    if (!mounts.size && documents.length === 1) {
      addSeed(input.rowId, 'database_row', row);
      addSeed(documentId, 'document', document);
      return {
        kind: 'seeded',
        request: {
          request_id: input.requestId,
          database_restore_id: input.restoreId,
          source_view_id: input.sourceViewId,
          row: { row_id: input.rowId, collab: seeds.get(input.rowId)!, document: seeds.get(documentId)! },
          position: input.position,
          position_view_ids: input.positionViewIds,
          document_name: input.template.name,
        },
      };
    }

    const views: CompoundFolderView[] = documents.map((item) => ({
      view_id: item.targetId,
      parent_view_id: item.parentDocument ?? item.targetId,
      name: item === documents[0] ? input.template.name : item.name ?? '',
      content: item.parentDocument
        ? { kind: 'document' }
        : item.row
        ? {
            kind: 'row_document',
            database_id: ids.get(item.row.databaseId)!,
            source_view_id: ids.get(
              [...mounts.values()].find((mount) => mount.databaseId === item.row!.databaseId)!.sourceId
            )!,
            row_id: item.row.id,
          }
        : {
            kind: 'row_document',
            database_id: input.databaseId,
            source_view_id: input.sourceViewId,
            row_id: input.rowId,
          },
    }));
    const extensions = new Map<string, CompoundDatabaseExtension>();

    for (const databaseId of archives.keys()) {
      const selected = [...mounts.values()].filter((mount) => mount.databaseId === databaseId);

      if (!selected.length) continue;
      const archive = archives.get(databaseId)!;
      const copied = copiedDatabases.has(databaseId);
      const targetDatabase = copied ? ids.get(databaseId)! : databaseId;
      const container = copied ? identity('container', databaseId) : undefined;
      const settings = new Map(archive.views.map((view) => [view.id, view]));
      const preparedViews: TemplateDatabaseView[] = [];

      if (copied)
        views.push({
          view_id: container!,
          parent_view_id: selected[0].parentDocument,
          name: snapshots.get(selected[0].sourceId)?.name ?? settings.get(selected[0].sourceId)?.name ?? '',
          content: {
            kind: 'database_container',
            database_id: targetDatabase,
            primary_view_id: ids.get(selected[0].sourceId)!,
            is_embedded: true,
          },
        });
      let extension: CompoundDatabaseExtension | undefined;
      let currentSource: TemplateDatabaseArchive | undefined;

      if (!copied) {
        const source = await sources.database(databaseId);

        currentSource = source.archive;

        extension = {
          database_id: databaseId,
          database_restore_id: source.restoreId,
          source_view_id: databaseId === input.databaseId ? input.sourceViewId : selected[0].sourceId,
          views: [],
          dependency_fields: [],
        };
        extensions.set(databaseId, extension);
      }

      for (const mount of selected) {
        const source = settings.get(mount.sourceId)!;
        const target = ids.get(mount.sourceId)!;
        const view = normalizeView(remapReferences(source, ids) as TemplateDatabaseView, target, targetDatabase);

        if (copied) {
          view.row_orders = source.row_orders.map((order) => ({ ...order, id: ids.get(order.id)! }));
          view.filters = remapRelationFilters(view.filters, archive.fields, ids);
        } else {
          const internal = currentSource!.views.find((candidate) => candidate.is_inline);

          if (!internal) throw new Error('Template source database has no canonical membership');
          const present = new Map(currentSource!.fields.map((field) => [String(field.id), field]));
          const archived = new Map(archive.fields.map((field) => [String(field.id), field]));
          const referenced = new Set([
            ...view.field_orders.map((field) => field.id),
            ...Object.keys(record(view.field_settings, 'field settings')),
          ]);

          for (const field of referenced) {
            if (!present.has(field) || present.get(field)!.field_type !== archived.get(field)?.field_type) {
              throw new Error('Template linked view references a missing or changed field');
            }
          }

          const liveRows = new Map(
            internal.row_orders
              .filter((order) => !(order as { is_deleted?: boolean }).is_deleted)
              .map((order) => [order.id, order])
          );
          const selectedRows = new Set<string>();

          view.row_orders = source.row_orders.flatMap((order) => {
            if (!liveRows.has(order.id) || selectedRows.has(order.id)) return [];
            selectedRows.add(order.id);
            return [liveRows.get(order.id)!];
          });
          view.row_orders.push(...[...liveRows.values()].filter((order) => !selectedRows.has(order.id)));
          const fieldIds = new Set(view.field_orders.map((field) => field.id));

          view.field_orders = [
            ...view.field_orders,
            ...internal.field_orders.filter((field) => !fieldIds.has(field.id)),
          ];
        }

        if (view.row_orders.some((order) => !order.id)) throw new Error('Template view references a missing row');
        preparedViews.push(view);
        const parent = copied
          ? mount.parentDocument === selected[0].parentDocument
            ? container!
            : mount.parentDocument
          : mount.sourceId === mount.primary
          ? mount.parentDocument
          : ids.get(mount.primary)!;
        const responseId = view.layout === 7 ? identity('responses', mount.sourceId) : undefined;

        views.push({
          view_id: target,
          parent_view_id: parent,
          name: source.name,
          content: {
            kind: 'database_view',
            database_id: targetDatabase,
            layout: FOLDER_LAYOUTS[view.layout],
            is_embedded: true,
            ...(responseId ? { responses_view_id: responseId } : {}),
          },
        });
        extension?.views.push({
          view,
          form_field_settings: archive.form_field_settings?.[mount.sourceId] ?? {},
          calculations: archive.calculations?.[mount.sourceId] ?? [],
          ...(responseId ? { responses_view_id: responseId } : {}),
        });
        if (responseId) {
          const responses = normalizeView(
            { ...view, layout: 0, name: 'Responses', filters: [], group_settings: [], sorts: [] },
            responseId,
            targetDatabase
          );

          preparedViews.push(responses);
          views.push({
            view_id: responseId,
            parent_view_id: parent,
            name: 'Responses',
            content: { kind: 'database_view', database_id: targetDatabase, layout: 1, is_embedded: true },
          });
          extension?.views.push({ view: responses, form_field_settings: {}, calculations: [] });
        }
      }

      if (copied) {
        const frozen = await legacyTemplates.freeze(archive);
        const database = databaseDocument(frozen, preparedViews, targetDatabase, ids);

        owned.push(database);
        addSeed(targetDatabase, 'database', database);
        for (const source of archive.rows) {
          const target = ids.get(String(source.id))!;
          const rowDoc = archivedRowDocument(
            source,
            archive.row_metas?.[String(source.id)],
            target,
            targetDatabase,
            ids,
            archive.fields
          );

          owned.push(rowDoc);
          addSeed(target, 'database_row', rowDoc);
        }
      }
    }

    for (const item of documents) {
      for (const block of documentBlocks(item.doc).values()) {
        if (block.get('ty') === 'sub_page') {
          block.set('data', JSON.stringify(remapReferences(blockData(block), ids)));
          continue;
        }

        if (!DATABASE_BLOCKS.has(String(block.get('ty')))) continue;
        const data = blockData(block);
        const mapped = (resolvedBlocks.get(block) ?? blockViews(data)).map((id) => {
          const target = ids.get(id);

          if (!target) throw new Error('Template database dependency was not prepared');
          return target;
        });

        block.set(
          'data',
          JSON.stringify({
            ...(remapReferences(data, ids) as TemplateRecord),
            view_ids: mapped,
            view_id: mapped[0],
            parent_id: item.targetId,
          })
        );
      }

      addSeed(item.targetId, 'document', item.doc);
    }

    addSeed(input.rowId, 'database_row', row);
    const sorted: CompoundFolderView[] = [];
    const remaining = new Map(views.map((view) => [view.view_id, view]));
    const emitted = new Set<string>();

    if (remaining.size !== views.length || views.length > 1024)
      throw new Error('Template graph repeats a Folder identity');
    while (remaining.size) {
      let progress = false;

      for (const [id, view] of remaining) {
        if (view.parent_view_id !== id && !emitted.has(view.parent_view_id)) continue;
        sorted.push(view);
        emitted.add(id);
        remaining.delete(id);
        progress = true;
      }

      if (!progress) throw new Error('Template graph contains a Folder cycle');
    }

    const objects: ClaimCompoundCreationRequest['objects'] = [];

    for (const [id, seed] of seeds) {
      check();
      const bytes = fromBase64(seed);
      const digest = await crypto.subtle.digest('SHA-256', bytes);

      objects.push({
        object_id: id,
        kind: seedKinds.get(id)!,
        byte_length: bytes.length,
        sha256: Array.from(new Uint8Array(digest)),
      });
    }

    check();
    return {
      kind: 'compound',
      seeds,
      manifest: {
        request_id: input.requestId,
        target: {
          kind: 'row',
          row_id: input.rowId,
          database_id: input.databaseId,
          database_restore_id: input.restoreId,
          source_view_id: input.sourceViewId,
          position: input.position,
          position_view_ids: input.positionViewIds,
        },
        objects,
        views: sorted,
        database_extensions: [...extensions.values()],
      },
    };
  } finally {
    owned.forEach((doc) => doc.destroy());
  }
}
