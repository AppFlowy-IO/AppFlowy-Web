import { v5 as uuidv5, validate as validateUuid } from 'uuid';
import * as Y from 'yjs';

import { FieldType, FilterType } from '../database.type';
import { RelationFilterCondition } from '../fields/relation/relation.type';
import { readTemplateRecords, writeTemplateRecords } from '../template/storage';

import type {
  TemplateDatabaseArchive,
  TemplateDatabaseView,
  TemplateJson,
  TemplateRecord,
} from './row-template-graph-types';

export const DATABASE_BLOCKS = new Set([
  'grid',
  'board',
  'calendar',
  'list',
  'gallery',
  'chart',
  'feed',
  'timeline',
  'dashboard',
]);
export const INLINE_LIMIT = 4 * 1024 * 1024;
export const GRAPH_LIMIT = 128 * 1024 * 1024;
export const FOLDER_LAYOUTS = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11];
const REFERENCE_KEYS = new Set([
  'database_id',
  'view_id',
  'row_id',
  'source_row_id',
  'target_row_id',
  'parent_id',
  'source_view_id',
  'responses_view_id',
  'viewId',
  'database_view_id',
]);

export function record(value: unknown, label: string): TemplateRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid template ${label}`);
  return value as TemplateRecord;
}

/** Yrs i64 values decode as bigint, which Yjs Map.set and JSON request bodies cannot accept.
 * Millisecond clocks fit safe JSON integers; large author identifiers retain their decimal form. */
export function templateJson(value: unknown, depth = 0): TemplateJson {
  if (depth > 64) throw new Error('Template source JSON exceeds its nesting limit');
  if (typeof value === 'bigint') {
    const number = Number(value);

    return Number.isSafeInteger(number) ? number : value.toString();
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => templateJson(item, depth + 1));
  if (typeof value === 'object' && value) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, templateJson(item, depth + 1)]));
  }

  throw new Error('Template source contains an unsupported JSON value');
}

export function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !validateUuid(value) || value === '00000000-0000-0000-0000-000000000000') {
    throw new Error(`Invalid template ${label} identity`);
  }

  return value;
}

export function detachedDocument(update: Uint8Array, id?: string): Y.Doc {
  if (!update.length || update.length > INLINE_LIMIT) throw new Error('Template document exceeds its size limit');
  const doc = new Y.Doc({ guid: id });

  try {
    Y.applyUpdate(doc, update);
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Template document history is incomplete');
    return doc;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

export function documentBlocks(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  const body = doc.getMap('data').get('document');
  const blocks = body instanceof Y.Map ? body.get('blocks') : undefined;

  if (!(body instanceof Y.Map) || !(blocks instanceof Y.Map) || !blocks.has(body.get('page_id'))) {
    throw new Error('Invalid template document tree');
  }

  return blocks;
}

export function blockData(block: Y.Map<unknown>): TemplateRecord {
  const value = block.get('data');

  return record(typeof value === 'string' ? JSON.parse(value) : value, 'block data');
}

export function blockViews(data: TemplateRecord): string[] {
  const singleView = data.view_id ?? data.viewId ?? data.database_view_id;
  const ids = Array.isArray(data.view_ids) && data.view_ids.length ? data.view_ids : singleView ? [singleView] : [];

  return [...new Set(ids.map((id) => uuid(id, 'database view')))];
}

export function parseArchive(raw: string, expectedDatabase?: string): TemplateDatabaseArchive {
  if (raw.length > 2 * 1024 * 1024) throw new Error('Template archive exceeds its size limit');
  const value = record(JSON.parse(raw), 'database archive');
  const databaseId = uuid(value.database_id, 'database');

  if (expectedDatabase && databaseId !== expectedDatabase) throw new Error('Template archive database identity changed');
  for (const name of ['views', 'fields', 'rows']) {
    if (!Array.isArray(value[name])) throw new Error(`Template archive has no ${name}`);
  }

  if ((value.views as unknown[]).length > 1024 || (value.rows as unknown[]).length > 4096) {
    throw new Error('Template archive exceeds its object limit');
  }

  const archive = value as unknown as TemplateDatabaseArchive;
  const identities = new Set<string>();

  for (const item of [...archive.views, ...archive.rows]) {
    const id = uuid(item.id, 'archive object');

    if (identities.has(id)) throw new Error('Template archive repeats an identity');
    identities.add(id);
    if (item.database_id && item.database_id !== databaseId)
      throw new Error('Template archive has a foreign database object');
  }

  return archive;
}

/** Canonical active membership owns the copied bodies; trash is never a creation seed. */
export function excludeInactiveRows(archive: TemplateDatabaseArchive): TemplateDatabaseArchive {
  const canonical = archive.views.find((view) => view.is_inline) ?? archive.views[0];
  const active = new Set(canonical.row_orders.filter((order) => !order.is_deleted).map((order) => order.id));

  return {
    ...archive,
    rows: archive.rows.filter((row) => active.has(String(row.id))),
    row_metas: archive.row_metas
      ? Object.fromEntries(Object.entries(archive.row_metas).filter(([id]) => active.has(id)))
      : undefined,
    views: archive.views.map((view) => ({
      ...view,
      row_orders: view.row_orders.filter((order) => !order.is_deleted && active.has(order.id)),
    })),
  };
}

/** Structural JSON values are copied; user-authored strings are never global search/replaced. */
export function remapReferences(value: TemplateJson, ids: ReadonlyMap<string, string>, key?: string): TemplateJson {
  if (typeof value === 'string') {
    if (key && REFERENCE_KEYS.has(key)) return ids.get(value) ?? value;
    return value;
  }

  if (Array.isArray(value)) return value.map((child) => remapReferences(child, ids, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => {
        const endpoints = key === 'dependency_links' ? childKey.split(':') : [];
        const mappedKey =
          endpoints.length === 2
            ? endpoints.map((id) => ids.get(id) ?? id).join(':')
            : ids.get(childKey) ?? childKey;

        return [mappedKey, remapReferences(child, ids, childKey)];
      })
    );
  }

  return value;
}

/** Relation filter content encodes row identities; other filter text remains user-authored. */
export function remapRelationFilters(
  filters: TemplateJson,
  fields: TemplateRecord[],
  ids: ReadonlyMap<string, string>
): TemplateJson {
  const relationFields = new Set(
    fields.filter((field) => Number(field.field_type) === FieldType.Relation).map((field) => String(field.id))
  );
  const remap = (value: TemplateJson): TemplateJson => {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== 'object') return value;
    const type = Number(value.filter_type);

    if (type === FilterType.And || type === FilterType.Or) {
      return Array.isArray(value.children) ? { ...value, children: value.children.map(remap) } : value;
    }

    if (
      !relationFields.has(String(value.field_id)) ||
      ![RelationFilterCondition.RelationContains, RelationFilterCondition.RelationDoesNotContain].includes(
        Number(value.condition)
      ) ||
      typeof value.content !== 'string'
    ) return value;
    try {
      const targets: unknown = JSON.parse(value.content);

      if (!Array.isArray(targets) || !targets.every((target) => typeof target === 'string')) return value;
      const mapped = targets.map((target: string) => ids.get(target) ?? target);

      return mapped.some((target, index) => target !== targets[index])
        ? { ...value, content: JSON.stringify(mapped) }
        : value;
    } catch {
      return value;
    }
  };

  return remap(filters);
}

function map(value: TemplateRecord): Y.Map<unknown> {
  return new Y.Map(
    Object.entries(value).map(([key, item]) => [
      key,
      item && !Array.isArray(item) && typeof item === 'object' ? map(item) : item,
    ])
  );
}

function array(value: TemplateJson[]): Y.Array<TemplateJson> {
  const result = new Y.Array<TemplateJson>();

  result.push(value);
  return result;
}

/** Editable setting records (including group columns and filter children) are shared types. */
function sharedSettings(value: TemplateJson): unknown {
  if (Array.isArray(value)) {
    const result = new Y.Array<unknown>();

    result.push(value.map(sharedSettings));
    return result;
  }

  if (value && typeof value === 'object') {
    return new Y.Map(Object.entries(value).map(([key, child]) => [key, sharedSettings(child)]));
  }

  return value;
}

export function normalizeView(source: TemplateDatabaseView, id: string, databaseId: string): TemplateDatabaseView {
  if (!Number.isInteger(source.layout) || !FOLDER_LAYOUTS[source.layout])
    throw new Error('Unsupported template database layout');
  return {
    id,
    database_id: databaseId,
    name: source.name ?? '',
    layout: source.layout,
    layout_settings: source.layout_settings ?? {},
    filters: source.filters ?? [],
    group_settings: source.group_settings ?? [],
    sorts: source.sorts ?? [],
    row_orders: source.row_orders ?? [],
    field_orders: source.field_orders ?? [],
    field_settings: source.field_settings ?? {},
    created_at: source.created_at ?? 0,
    modified_at: source.modified_at ?? 0,
    is_inline: false,
    embedded: true,
  };
}

export function databaseDocument(
  archive: TemplateDatabaseArchive,
  views: TemplateDatabaseView[],
  databaseId: string,
  ids: ReadonlyMap<string, string>
): Y.Doc {
  const doc = new Y.Doc({ guid: databaseId });
  const root = new Y.Map<unknown>();
  const fields = new Y.Map<unknown>();
  const viewMap = new Y.Map<unknown>();
  const inlineId = uuidv5('inline_view_id', databaseId);
  const canonical = normalizeView({ ...views[0], layout: 0 }, inlineId, databaseId);

  canonical.is_inline = true;
  canonical.embedded = false;
  canonical.row_orders = archive.rows.map((row) => ({ id: ids.get(String(row.id))!, height: Number(row.height ?? 60) }));
  const metas = new Y.Map<unknown>([['iid', inlineId]]);

  doc.getMap('data').set('database', root);
  root.set('id', databaseId);
  root.set('fields', fields);
  root.set('views', viewMap);
  root.set('metas', metas);

  // Frozen snapshots retain their source document ownership, including child-page parents.
  const oldMetas = archive.row_templates_meta;

  if (oldMetas) {
    // Use the shared projection reader: v2 entries and tombstones may be newer than the array.
    const source = new Y.Doc();
    const sourceMetas = source.getMap('metas');

    Object.entries(oldMetas).forEach(([key, value]) => sourceMetas.set(key, value));
    const records = readTemplateRecords(sourceMetas);

    source.destroy();
    const remapped = records.map((value) => {
      const template = record(value, 'nested row template');
      const id = String(template.template_id);

      if (template.is_document_empty === false && (!Array.isArray(template.doc_data) || !template.doc_data.length)) {
        throw new Error('Nested legacy template requires a document snapshot');
      }

      return {
        ...template,
        template_id: uuidv5(`template:${id}`, databaseId),
      };
    });

    writeTemplateRecords(metas, remapped);
    if (oldMetas.default_row_template && records.some((item) => item.template_id === oldMetas.default_row_template)) {
      metas.set('default_row_template', uuidv5(`template:${String(oldMetas.default_row_template)}`, databaseId));
    }
  }

  for (const field of archive.fields) {
    const data = remapReferences(field, ids) as TemplateRecord;

    fields.set(
      String(field.id),
      map({
        id: field.id,
        name: field.name ?? '',
        ty: field.field_type ?? 0,
        icon: field.icon ?? '',
        is_primary: field.is_primary ?? false,
        type_option: data.type_options ?? {},
      })
    );
  }

  const sourcesByTarget = new Map([...ids].map(([source, target]) => [target, source]));

  for (const view of [canonical, ...views]) {
    const value = new Y.Map<unknown>();

    viewMap.set(view.id, value);
    for (const [key, item] of Object.entries(view)) {
      const storedKey = key === 'group_settings' ? 'groups' : key;

      value.set(
        storedKey,
        ['group_settings', 'sorts', 'filters'].includes(key)
          ? sharedSettings(item)
          : Array.isArray(item)
          ? array(item)
          : item && typeof item === 'object'
          ? map(item)
          : item
      );
    }

    const sourceId = sourcesByTarget.get(view.id);

    value.set('form_field_settings', map(sourceId ? archive.form_field_settings?.[sourceId] ?? {} : {}));
    value.set('calculations', sharedSettings(sourceId ? archive.calculations?.[sourceId] ?? [] : []));
  }

  return doc;
}

export function archivedRowDocument(
  row: TemplateRecord,
  meta: TemplateRecord | undefined,
  rowId: string,
  databaseId: string,
  ids: ReadonlyMap<string, string>,
  fields: TemplateRecord[]
): Y.Doc {
  const doc = new Y.Doc({ guid: rowId });
  const data = new Y.Map<unknown>();
  const cells = new Y.Map<unknown>();
  const metas = new Y.Map<unknown>();

  doc.getMap('data').set('data', data);
  doc.getMap('data').set('meta', metas);
  Object.entries({
    id: rowId,
    database_id: databaseId,
    height: row.height ?? 60,
    visibility: row.visibility ?? true,
    created_at: String(row.created_at ?? 0),
    last_modified: String(row.modified_at ?? row.last_modified ?? 0),
    ...(row.created_by === null || row.created_by === undefined ? {} : { created_by: String(row.created_by) }),
    ...(row.last_edited_by === null || row.last_edited_by === undefined
      ? {}
      : { last_edited_by: String(row.last_edited_by) }),
  }).forEach(([key, value]) => data.set(key, value));
  data.set('cells', cells);
  const fieldById = new Map(fields.map((field) => [String(field.id), field]));

  for (const [id, original] of Object.entries(record(row.cells ?? {}, 'row cells'))) {
    const cell = { ...record(original, 'cell') };

    const storedType = Number(cell.source_field_type ?? cell.field_type ?? fieldById.get(id)?.field_type);

    if (storedType === FieldType.Relation) {
      if (Array.isArray(cell.data)) {
        cell.data = cell.data.map((related) => (typeof related === 'string' ? ids.get(related) ?? related : related));
      } else if (typeof cell.data === 'string') {
        cell.data = cell.data
          .split(',')
          .map((related) => ids.get(related.trim()) ?? related)
          .join(',');
      }
    }

    const stored = map(cell);

    // Media entries and relation targets are shared arrays in the cell schema.
    // Use the storage type so a lazily converted cell retains its original encoding.
    if ((storedType === FieldType.Media || storedType === FieldType.Relation) && Array.isArray(cell.data)) {
      stored.set('data', array(cell.data));
    }

    cells.set(id, stored);
  }

  metas.set(uuidv5('is_document_empty', rowId), meta?.is_document_empty !== false);
  metas.set(uuidv5('attachment_count', rowId), meta?.attachment_count ?? 0);
  if (meta?.icon_url) metas.set(uuidv5('icon_id', rowId), meta.icon_url);
  if (meta?.cover) metas.set(uuidv5('cover_id', rowId), JSON.stringify(meta.cover));
  return doc;
}
