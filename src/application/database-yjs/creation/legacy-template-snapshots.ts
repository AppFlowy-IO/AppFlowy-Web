import * as Y from 'yjs';

import { encodeTemplateDocumentSnapshot } from '@/application/database-yjs/template/document';
import { readTemplateRecords, writeTemplateRecords } from '@/application/database-yjs/template/storage';
import type { PersistedTemplateEmbeddedDatabaseSnapshot } from '@/application/database-yjs/template/types';
import { Types } from '@/application/types';

import {
  blockData,
  blockViews,
  DATABASE_BLOCKS,
  FOLDER_LAYOUTS,
  documentBlocks,
  parseArchive,
  record,
  uuid,
} from './row-template-graph-data';
import { TemplateSources } from './row-template-graph-sources';

import type { TemplateDatabaseArchive } from './row-template-graph-types';

type Snapshot = { doc_data: number[]; embedded_databases: PersistedTemplateEmbeddedDatabaseSnapshot[] };

/**
 * Old Web templates store a live orphan document instead of a frozen Desktop snapshot.
 * Freeze only the missing bodies before their backing is copied. Empty/frozen templates
 * need no reads; all fetched sources are detached and never enter the live document cache.
 */
export class LegacyTemplateSnapshots {
  private snapshots = new Map<string, Snapshot>();

  constructor(private sources: TemplateSources, private check: () => void) {}

  async freeze(archive: TemplateDatabaseArchive, ancestors = new Set<string>()): Promise<TemplateDatabaseArchive> {
    if (!archive.row_templates_meta) return archive;
    if (ancestors.has(archive.database_id) || ancestors.size >= 8)
      throw new Error('Nested template database ownership is cyclic or too deep');
    const nextAncestors = new Set([...ancestors, archive.database_id]);
    const metadata = new Y.Doc();
    const metas = metadata.getMap<unknown>('metas');

    try {
      Object.entries(archive.row_templates_meta).forEach(([key, value]) => metas.set(key, value));
      const records = readTemplateRecords(metas);
      const missing = records.filter(
        (item) => item.is_document_empty === false && (!Array.isArray(item.doc_data) || !item.doc_data.length)
      );

      if (!missing.length) return archive;
      const ids = [...new Set(missing.map((item) => uuid(item.doc_view_id, 'nested template document')))];

      if (ids.length > 1024) throw new Error('Template has too many legacy document snapshots');
      const fresh = ids.filter((id) => !this.snapshots.has(`${archive.database_id}:${id}`));
      const docs = await this.sources.documents(fresh, Types.Document);

      try {
        // Fetch once in bounded batches, then freeze dependencies without retaining live Yjs objects.
        for (const doc of docs) {
          const snapshot = await this.freezeDocument(doc, archive.database_id, nextAncestors);

          this.snapshots.set(`${archive.database_id}:${doc.guid}`, snapshot);
        }
      } finally {
        docs.forEach((doc) => doc.destroy());
      }

      const missingRecords = new Set(missing);
      const frozen = records.map((item) => {
        if (!missingRecords.has(item)) return item;
        const snapshot = this.snapshots.get(`${archive.database_id}:${String(item.doc_view_id)}`)!;

        this.check();
        return { ...item, ...snapshot };
      });

      writeTemplateRecords(metas, frozen);
      return { ...archive, row_templates_meta: record(metas.toJSON(), 'frozen template metadata') };
    } finally {
      metadata.destroy();
    }
  }

  private async freezeDocument(doc: Y.Doc, ownerDatabaseId: string, ancestors: Set<string>): Promise<Snapshot> {
    this.check();
    const snapshots = new Map<string, PersistedTemplateEmbeddedDatabaseSnapshot>();

    for (const block of documentBlocks(doc).values()) {
      if (!(block instanceof Y.Map)) throw new Error('Invalid nested template block');
      if (!DATABASE_BLOCKS.has(String(block.get('ty')))) continue;
      const data = blockData(block);
      const expanded: string[] = [];

      for (const id of blockViews(data)) {
        for (const mount of await this.sources.mounts(id, doc.guid, data.database_id)) {
          const linked = mount.linked || mount.databaseId === ownerDatabaseId;
          const source = linked
            ? (await this.sources.database(mount.databaseId)).archive
            : await this.freeze(await this.sources.completeDatabase(mount.databaseId), ancestors);
          const view = source.views.find((view) => view.id === mount.viewId && !view.is_inline);

          if (!view) throw new Error('Nested template database view is missing');
          // A link captures view settings, not the source's templates or row bodies.
          const snapshot = linked
            ? { ...source, rows: [], row_metas: undefined, row_templates_meta: undefined }
            : source;
          const rawData = JSON.stringify(snapshot);

          parseArchive(rawData, mount.databaseId);
          snapshots.set(mount.viewId, {
            source_view_id: mount.viewId,
            source_database_id: mount.databaseId,
            layout_type: FOLDER_LAYOUTS[view.layout],
            name: view.name,
            raw_data: rawData,
            is_linked: linked,
          });
          if (snapshots.size > 64) throw new Error('Nested template has too many database snapshots');
          expanded.push(mount.viewId);
        }
      }

      if (!expanded.length) throw new Error('Nested template database block has no view');
      block.set('data', JSON.stringify({ ...data, view_ids: expanded, view_id: expanded[0] }));
    }

    this.check();
    return { doc_data: encodeTemplateDocumentSnapshot(doc), embedded_databases: [...snapshots.values()] };
  }
}
