import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { atomicRead } from '@/application/atomic-creation';
import { collabFullSyncBatch } from '@/application/services/js-services/http/collab-api';
import { Types, View } from '@/application/types';
import { isEmbeddedDatabaseViewWithoutChildren } from '@/application/view-utils';

import { detachedDocument, excludeInactiveRows, GRAPH_LIMIT, record, templateJson, uuid } from './row-template-graph-data';
import { ORIGINAL_DATABASE_RESTORE_ID } from './source-readiness';

import type {
  TemplateDatabaseArchive,
  TemplateDatabaseView,
  TemplateRecord,
  TemplateRowGraphInput,
} from './row-template-graph-types';

interface SourceDatabase {
  archive: TemplateDatabaseArchive;
  restoreId: string;
}

/** Read-only authoritative sources. No provider, IndexedDB namespace or source mutation is created. */
export class TemplateSources {
  private databases = new Map<string, Promise<SourceDatabase>>();
  private views = new Map<string, Promise<View>>();
  private completeDatabases = new Map<string, Promise<TemplateDatabaseArchive>>();
  private decodedBytes = 0;

  constructor(private input: TemplateRowGraphInput, private check: () => void) {}

  view(id: string): Promise<View> {
    let pending = this.views.get(id);

    if (!pending) {
      this.check();
      pending = atomicRead<View>(
        this.input.owner,
        `/api/workspace/${this.input.owner.workspaceId}/view/${id}?depth=1`,
        undefined,
        this.input.signal
      );
      this.views.set(id, pending);
    }

    return pending.then((view) => {
      this.check();
      if (view.view_id !== id) throw new Error('Template view identity changed');
      return view;
    });
  }

  database(id: string): Promise<SourceDatabase> {
    let pending = this.databases.get(id);

    if (!pending) {
      if (this.databases.size >= 8) throw new Error('Template has too many existing database sources');
      pending = this.readDatabase(id);
      this.databases.set(id, pending);
    }

    return pending;
  }

  /** Distinguish an owned container from a direct document-mounted linked tab. */
  async mounts(
    id: string,
    parentDocument: string,
    databaseIdHint?: unknown
  ): Promise<Array<{ viewId: string; databaseId: string; linked: boolean }>> {
    const mount = await this.view(id);
    const databaseId = uuid(mount.extra?.database_id ?? databaseIdHint, 'mounted database');

    if (mount.extra?.is_database_container && !isEmbeddedDatabaseViewWithoutChildren(mount)) {
      const children = mount.children.filter((child) => child.extra?.database_id === databaseId);

      if (!children.length) throw new Error('Template database container has no child views');
      return children.map((child) => ({
        viewId: uuid(child.view_id, 'database view'),
        databaseId,
        linked: databaseId === this.input.databaseId || mount.parent_view_id !== parentDocument,
      }));
    }

    let linked = true;

    if (databaseId !== this.input.databaseId && mount.parent_view_id && mount.parent_view_id !== parentDocument) {
      const parent = await this.view(mount.parent_view_id);

      if (
        parent.extra?.is_database_container &&
        !isEmbeddedDatabaseViewWithoutChildren(parent) &&
        parent.parent_view_id === parentDocument &&
        parent.extra.database_id === databaseId
      )
        linked = false;
    }

    return [{ viewId: id, databaseId, linked }];
  }

  /** Materialize rows only for owned backings; linked views need no row-body fan-out. */
  completeDatabase(id: string): Promise<TemplateDatabaseArchive> {
    let pending = this.completeDatabases.get(id);

    if (!pending) {
      pending = this.readCompleteDatabase(id);
      this.completeDatabases.set(id, pending);
    }

    return pending;
  }

  private async readCompleteDatabase(id: string): Promise<TemplateDatabaseArchive> {
    const source = await this.database(id);
    const archive = excludeInactiveRows(source.archive);
    const canonical = archive.views.find((view) => view.is_inline) ?? archive.views[0];
    const rowIds = [...new Set(canonical.row_orders.map((order) => uuid(order.id, 'row')))];

    if (rowIds.length > 4096) throw new Error('Template graph exceeds its object limit');
    const rows = await this.documents(rowIds, Types.DatabaseRow, source.restoreId);

    try {
      const rowMetas: Record<string, TemplateRecord> = {};
      const values = rows.map((doc) => {
        const root = doc.getMap('data').get('data');
        const meta = doc.getMap('data').get('meta');

        if (!(root instanceof Y.Map) || root.get('id') !== doc.guid || root.get('database_id') !== id)
          throw new Error('Template row belongs to another database');
        rowMetas[doc.guid] = {
          is_document_empty: !(meta instanceof Y.Map) || meta.get(uuidv5('is_document_empty', doc.guid)) !== false,
          icon_url: meta instanceof Y.Map ? meta.get(uuidv5('icon_id', doc.guid)) ?? null : null,
          cover:
            meta instanceof Y.Map && meta.get(uuidv5('cover_id', doc.guid))
              ? JSON.parse(String(meta.get(uuidv5('cover_id', doc.guid))))
              : null,
        };
        return record(templateJson(root.toJSON()), 'row');
      });

      return { ...archive, rows: values, row_metas: rowMetas };
    } finally {
      rows.forEach((doc) => doc.destroy());
    }
  }

  async documents(ids: string[], type: Types, restoreId?: string, version?: string | null): Promise<Y.Doc[]> {
    const docs: Y.Doc[] = [];

    try {
      // Bound decoded responses and request fan-out even for large archived databases.
      for (let start = 0; start < ids.length; start += 32) {
        this.check();
        const chunk = ids.slice(start, start + 32);
        const responses = await collabFullSyncBatch(
          this.input.owner.workspaceId,
          chunk.map((objectId) => ({
            objectId,
            collabType: type,
            stateVector: new Uint8Array([0]),
            docState: new Uint8Array(),
            databaseRestoreId: restoreId,
            ...(version ? { collabVersion: version } : {}),
          })),
          {
            atomicCreationOwner: this.input.owner,
            signal: this.input.signal,
            timeoutMs: Math.max(1, this.input.deadline - Date.now()),
          }
        );

        this.check();
        const byId = new Map(responses.map((response) => [response.objectId, response]));

        if (byId.size !== chunk.length || responses.length !== chunk.length)
          throw new Error('Template source response is incomplete');
        for (const id of chunk) {
          const response = byId.get(id);

          if (
            !response ||
            response.error ||
            response.collabType !== type ||
            (version !== undefined && (response.collabVersion ?? null) !== version)
          )
            throw new Error('Template source could not be read');
          this.decodedBytes += response.missingUpdate.length;
          if (this.decodedBytes > GRAPH_LIMIT) throw new Error('Template source graph exceeds its size limit');
          const doc = detachedDocument(response.missingUpdate, id);

          docs.push(doc);
          const actual = Y.decodeStateVector(Y.encodeStateVector(doc));
          const expected = Y.decodeStateVector(response.serverStateVector);

          if (actual.size !== expected.size || [...expected].some(([client, clock]) => actual.get(client) !== clock)) {
            throw new Error('Template source history is incomplete');
          }
        }
      }

      return docs;
    } catch (error) {
      docs.forEach((doc) => doc.destroy());
      throw error;
    }
  }

  private async readDatabase(id: string): Promise<SourceDatabase> {
    const state = await this.restore(id);
    const [doc] = await this.documents(
      [id],
      Types.Database,
      state.database_restore_id ?? ORIGINAL_DATABASE_RESTORE_ID,
      state.version
    );

    try {
      const root = doc.getMap('data').get('database');

      if (!(root instanceof Y.Map) || root.get('id') !== id) throw new Error('Template database identity changed');
      const value = record(templateJson(root.toJSON()), 'database');
      const views = Object.values(record(value.views, 'database views')).map((view): TemplateDatabaseView => {
        const source = record(view, 'database view');

        return {
          ...source,
          id: uuid(source.id, 'database view'),
          database_id: id,
          name: String(source.name ?? ''),
          layout: Number(source.layout),
          row_orders: source.row_orders as TemplateDatabaseView['row_orders'],
          field_orders: source.field_orders as TemplateDatabaseView['field_orders'],
          group_settings: source.groups ?? [],
        };
      });
      const fields = Object.values(record(value.fields, 'database fields')).map((field) => {
        const source = record(field, 'database field');

        return {
          id: source.id,
          name: source.name ?? '',
          icon: source.icon ?? '',
          is_primary: source.is_primary ?? false,
          field_type: source.ty,
          type_options: source.type_option ?? {},
        };
      });
      const after = await this.restore(id);

      if (JSON.stringify(state) !== JSON.stringify(after))
        throw new Error('Template database restore generation changed');
      return {
        archive: {
          database_id: id,
          views,
          fields,
          rows: [],
          form_field_settings: Object.fromEntries(
            views.map((view) => [view.id, record(view.form_field_settings ?? {}, 'Form settings')])
          ),
          calculations: Object.fromEntries(
            views.map((view) => [view.id, (view.calculations ?? []) as TemplateRecord[]])
          ),
          row_templates_meta: record(value.metas ?? {}, 'database metadata'),
        },
        restoreId: state.database_restore_id ?? ORIGINAL_DATABASE_RESTORE_ID,
      };
    } finally {
      doc.destroy();
    }
  }

  private async restore(id: string) {
    this.check();
    const state = await atomicRead<{ database_restore_id: string | null; version: string | null }>(
      this.input.owner,
      `/api/workspace/${this.input.owner.workspaceId}/database/${id}/restore-state`,
      undefined,
      this.input.signal
    );

    this.check();
    if (
      id === this.input.databaseId &&
      (state.database_restore_id ?? ORIGINAL_DATABASE_RESTORE_ID) !== this.input.restoreId
    ) {
      throw new Error('Template source database restore generation changed');
    }

    return state;
  }
}
