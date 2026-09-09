import * as Y from 'yjs';

import { YDatabase, YDatabaseMetas, YjsDatabaseKey } from '@/application/types';

import { sanitizeTemplateCells } from './cell';
import { parseDatabaseRowTemplate, parseDatabaseRowTemplateState, serializeDatabaseRowTemplate } from './codec';
import { readTemplateRecords, repairTemplateProjection, writeTemplateRecords } from './storage';
import {
  DATABASE_DEFAULT_ROW_TEMPLATE_KEY,
  DatabaseRowTemplate,
  DatabaseRowTemplateState,
} from './types';

function sanitizeEmbeddedDatabases(
  snapshots: DatabaseRowTemplate['embeddedDatabases']
): DatabaseRowTemplate['embeddedDatabases'] {
  const seen = new Set<string>();

  return snapshots.filter((snapshot) => {
    if (!snapshot.sourceViewId.trim() || !snapshot.rawData.trim() || seen.has(snapshot.sourceViewId)) return false;
    seen.add(snapshot.sourceViewId);
    return true;
  });
}

function ensureMetas(database: YDatabase): YDatabaseMetas {
  let metas = database.get(YjsDatabaseKey.metas);

  if (!metas) {
    metas = new Y.Map() as YDatabaseMetas;
    database.set(YjsDatabaseKey.metas, metas);
  }

  return metas;
}

function transact(database: YDatabase, operation: () => void) {
  const doc = database.doc;

  if (doc) {
    doc.transact(operation, 'database-row-template');
  } else {
    operation();
  }
}

function parseSnapshotState(snapshot: string): [unknown, unknown] | undefined {
  try {
    const value: unknown = JSON.parse(snapshot);

    if (Array.isArray(value)) return [value[0], value[1]];
  } catch {
    // Fall back to the live Yjs values if a caller supplies a stale or invalid snapshot.
  }

  return undefined;
}

export function readDatabaseRowTemplateState(database?: YDatabase | null, snapshot?: string): DatabaseRowTemplateState {
  const metas = database?.get(YjsDatabaseKey.metas);
  const snapshotState = snapshot === undefined ? undefined : parseSnapshotState(snapshot);
  const state = parseDatabaseRowTemplateState(
    snapshotState?.[0] ?? JSON.stringify(readTemplateRecords(metas)),
    snapshotState?.[1] ?? metas?.get(DATABASE_DEFAULT_ROW_TEMPLATE_KEY)
  );

  if (!database) return state;

  return {
    ...state,
    templates: state.templates.map((template) => ({
      ...template,
      embeddedDatabases: sanitizeEmbeddedDatabases(template.embeddedDatabases),
      defaultCells: sanitizeTemplateCells(database, template.defaultCells),
    })),
  };
}

export function getDatabaseRowTemplateSnapshot(database?: YDatabase | null): string {
  const metas = database?.get(YjsDatabaseKey.metas);
  const templates = JSON.stringify(readTemplateRecords(metas));
  const defaultId = metas?.get(DATABASE_DEFAULT_ROW_TEMPLATE_KEY);
  const fields = database?.get(YjsDatabaseKey.fields);
  const fieldSchema: Array<[string, string, string]> = [];

  fields?.forEach((field, fieldId) => {
    const rawType = field.get(YjsDatabaseKey.type);
    const fieldType = rawType === undefined || rawType === null ? '' : String(rawType);
    const rawTypeOptionContent = field.get(YjsDatabaseKey.type_option)?.get(fieldType)?.get(YjsDatabaseKey.content);
    const typeOptionContent =
      rawTypeOptionContent === undefined || rawTypeOptionContent === null ? '' : String(rawTypeOptionContent);

    fieldSchema.push([fieldId, fieldType, typeOptionContent]);
  });

  return JSON.stringify([
    templates,
    typeof defaultId === 'string' ? defaultId : '',
    fieldSchema,
  ]);
}

export function subscribeDatabaseRowTemplates(database: YDatabase, onStoreChange: () => void): () => void {
  let metas = database.get(YjsDatabaseKey.metas);
  let fields = database.get(YjsDatabaseKey.fields);

  const onMetasChange = () => onStoreChange();
  const onFieldsChange = () => onStoreChange();
  const onDatabaseChange = () => {
    const nextMetas = database.get(YjsDatabaseKey.metas);
    const nextFields = database.get(YjsDatabaseKey.fields);

    if (nextMetas !== metas) {
      metas?.unobserve(onMetasChange);
      metas = nextMetas;
      metas?.observe(onMetasChange);
      onStoreChange();
    }

    if (nextFields !== fields) {
      fields?.unobserveDeep(onFieldsChange);
      fields = nextFields;
      fields?.observeDeep(onFieldsChange);
      onStoreChange();
    }
  };

  metas?.observe(onMetasChange);
  fields?.observeDeep(onFieldsChange);
  database.observe(onDatabaseChange);

  return () => {
    metas?.unobserve(onMetasChange);
    fields?.unobserveDeep(onFieldsChange);
    database.unobserve(onDatabaseChange);
  };
}

export class DatabaseRowTemplateStore {
  constructor(private readonly database: YDatabase) {}

  read(): DatabaseRowTemplateState {
    return readDatabaseRowTemplateState(this.database);
  }

  prepareForRowCreation(templateId: string): DatabaseRowTemplate | undefined {
    const template = this.read().templates.find((item) => item.templateId === templateId);

    if (template) {
      // The duplication API flushes this database before the server reads its
      // legacy array. Keep this write out of React's pure snapshot getter.
      transact(this.database, () => repairTemplateProjection(ensureMetas(this.database)));
    }

    return template;
  }

  upsert(template: DatabaseRowTemplate): DatabaseRowTemplate {
    const records = readTemplateRecords(this.database.get(YjsDatabaseKey.metas));
    const index = records.findIndex((record) => record.template_id === template.templateId);
    const existing = index < 0 ? undefined : parseDatabaseRowTemplate(records[index]);
    const updated = {
      ...template,
      embeddedDatabases: sanitizeEmbeddedDatabases(template.embeddedDatabases),
      defaultCells: sanitizeTemplateCells(this.database, template.defaultCells),
      createdAtMs: existing?.createdAtMs ?? template.createdAtMs,
      icon: template.icon ?? existing?.icon,
      cover: template.cover ?? existing?.cover,
      updatedAtMs: Date.now(),
    };
    // Preserve unknown fields and untouched legacy records. Normalizing the
    // whole list would turn a local edit into writes to unrelated templates.
    const record = { ...records[index], ...serializeDatabaseRowTemplate(updated) };

    if (index < 0) records.push(record);
    else records[index] = record;

    transact(this.database, () => {
      writeTemplateRecords(ensureMetas(this.database), records);
    });

    return updated;
  }

  delete(templateId: string): boolean {
    const state = this.read();

    if (!state.templates.some((template) => template.templateId === templateId)) return false;
    const records = readTemplateRecords(this.database.get(YjsDatabaseKey.metas)).filter(
      (record) => record.template_id !== templateId
    );

    transact(this.database, () => {
      const metas = ensureMetas(this.database);

      writeTemplateRecords(metas, records);
      if (state.defaultTemplateId === templateId) metas.set(DATABASE_DEFAULT_ROW_TEMPLATE_KEY, '');
    });

    return true;
  }

  setDefault(templateId?: string): boolean {
    const state = this.read();
    const nextId = templateId?.trim() ?? '';

    if (nextId && !state.templates.some((template) => template.templateId === nextId)) return false;

    transact(this.database, () => {
      ensureMetas(this.database).set(DATABASE_DEFAULT_ROW_TEMPLATE_KEY, nextId);
    });

    return true;
  }

  move(fromTemplateId: string, toTemplateId: string): boolean {
    if (fromTemplateId === toTemplateId) return true;

    const records = readTemplateRecords(this.database.get(YjsDatabaseKey.metas));
    const fromIndex = records.findIndex((record) => record.template_id === fromTemplateId && record.name !== '');
    const toIndex = records.findIndex((record) => record.template_id === toTemplateId && record.name !== '');

    if (fromIndex < 0 || toIndex < 0) return false;

    const [moved] = records.splice(fromIndex, 1);

    records.splice(toIndex, 0, moved);

    transact(this.database, () => {
      writeTemplateRecords(ensureMetas(this.database), records);
    });

    return true;
  }

  /**
   * Publishes a server-only source while a Desktop snapshot is converted to a
   * live row document. An empty name keeps the record out of both Web and
   * Flutter template lists without changing Desktop's persisted field shape.
   */
  upsertTransientMigrationSource(template: DatabaseRowTemplate): DatabaseRowTemplate {
    const updated: DatabaseRowTemplate = {
      ...template,
      name: '',
      embeddedDatabases: sanitizeEmbeddedDatabases(template.embeddedDatabases),
      defaultCells: sanitizeTemplateCells(this.database, template.defaultCells),
      updatedAtMs: Date.now(),
    };
    const records = readTemplateRecords(this.database.get(YjsDatabaseKey.metas)).filter(
      (record) => record.template_id !== updated.templateId
    );

    records.push({ ...serializeDatabaseRowTemplate(updated) });
    transact(this.database, () => {
      writeTemplateRecords(ensureMetas(this.database), records);
    });

    return updated;
  }

  deleteTransientMigrationSource(templateId: string): boolean {
    const records = readTemplateRecords(this.database.get(YjsDatabaseKey.metas));
    const remaining = records.filter((record) => record.template_id !== templateId);

    if (remaining.length === records.length) return false;

    transact(this.database, () => {
      writeTemplateRecords(ensureMetas(this.database), remaining);
    });

    return true;
  }
}
