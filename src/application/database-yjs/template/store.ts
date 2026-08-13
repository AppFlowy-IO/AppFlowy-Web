import * as Y from 'yjs';

import { YDatabase, YDatabaseMetas, YjsDatabaseKey } from '@/application/types';

import { sanitizeTemplateCells } from './cell';
import { parseDatabaseRowTemplateState, serializeDatabaseRowTemplate } from './codec';
import {
  DATABASE_DEFAULT_ROW_TEMPLATE_KEY,
  DATABASE_ROW_TEMPLATES_KEY,
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

type PersistedTemplateRecord = Record<string, unknown>;

function readPersistedTemplateRecords(database: YDatabase): PersistedTemplateRecord[] {
  const raw = database.get(YjsDatabaseKey.metas)?.get(DATABASE_ROW_TEMPLATES_KEY);

  if (typeof raw !== 'string' || raw.trim() === '') return [];

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (entry): entry is PersistedTemplateRecord => typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    );
  } catch {
    return [];
  }
}

function isHiddenMigrationSource(record: PersistedTemplateRecord): boolean {
  return typeof record.template_id === 'string' && record.template_id.length > 0 && record.name === '';
}

function serializeVisibleTemplatesPreservingMigrationSources(
  database: YDatabase,
  templates: DatabaseRowTemplate[]
): string {
  const visibleTemplateIds = new Set(templates.map((template) => template.templateId));
  const migrationSources = readPersistedTemplateRecords(database).filter(
    (record) => isHiddenMigrationSource(record) && !visibleTemplateIds.has(record.template_id as string)
  );

  return JSON.stringify([...templates.map(serializeDatabaseRowTemplate), ...migrationSources]);
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
    snapshotState?.[0] ?? metas?.get(DATABASE_ROW_TEMPLATES_KEY),
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
  const templates = metas?.get(DATABASE_ROW_TEMPLATES_KEY);
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
    typeof templates === 'string' ? templates : '',
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

  upsert(template: DatabaseRowTemplate): DatabaseRowTemplate {
    const state = this.read();
    const index = state.templates.findIndex((item) => item.templateId === template.templateId);
    const updated = {
      ...template,
      embeddedDatabases: sanitizeEmbeddedDatabases(template.embeddedDatabases),
      defaultCells: sanitizeTemplateCells(this.database, template.defaultCells),
      updatedAtMs: Date.now(),
    };
    const templates = [...state.templates];

    if (index < 0) templates.push(updated);
    else templates[index] = updated;

    transact(this.database, () => {
      ensureMetas(this.database).set(
        DATABASE_ROW_TEMPLATES_KEY,
        serializeVisibleTemplatesPreservingMigrationSources(this.database, templates)
      );
    });

    return updated;
  }

  delete(templateId: string): boolean {
    const state = this.read();
    const templates = state.templates.filter((template) => template.templateId !== templateId);

    if (templates.length === state.templates.length) return false;

    transact(this.database, () => {
      const metas = ensureMetas(this.database);

      metas.set(
        DATABASE_ROW_TEMPLATES_KEY,
        serializeVisibleTemplatesPreservingMigrationSources(this.database, templates)
      );
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

    const templates = [...this.read().templates];
    const fromIndex = templates.findIndex((template) => template.templateId === fromTemplateId);
    const toIndex = templates.findIndex((template) => template.templateId === toTemplateId);

    if (fromIndex < 0 || toIndex < 0) return false;

    const [moved] = templates.splice(fromIndex, 1);

    templates.splice(toIndex, 0, moved);

    transact(this.database, () => {
      ensureMetas(this.database).set(
        DATABASE_ROW_TEMPLATES_KEY,
        serializeVisibleTemplatesPreservingMigrationSources(this.database, templates)
      );
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
    const records = readPersistedTemplateRecords(this.database).filter(
      (record) => record.template_id !== updated.templateId
    );

    records.push({ ...serializeDatabaseRowTemplate(updated) });
    transact(this.database, () => {
      ensureMetas(this.database).set(DATABASE_ROW_TEMPLATES_KEY, JSON.stringify(records));
    });

    return updated;
  }

  deleteTransientMigrationSource(templateId: string): boolean {
    const records = readPersistedTemplateRecords(this.database);
    const remaining = records.filter((record) => record.template_id !== templateId);

    if (remaining.length === records.length) return false;

    transact(this.database, () => {
      ensureMetas(this.database).set(DATABASE_ROW_TEMPLATES_KEY, JSON.stringify(remaining));
    });

    return true;
  }
}
