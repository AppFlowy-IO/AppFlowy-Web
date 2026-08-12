import {
  DatabaseRowTemplate,
  DatabaseRowTemplateState,
  PersistedDatabaseRowTemplate,
  PersistedTemplateCellValue,
  PersistedTemplateEmbeddedDatabaseSnapshot,
  TemplateCellValue,
  TemplateEmbeddedDatabaseSnapshot,
} from './types';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Desktop persists these values as Rust `i64`s. Restrict them to JavaScript's
 * exactly representable integer range so JSON written by Web can always be
 * decoded by Desktop without precision loss or a serde type error.
 */
function asSafeInteger(value: unknown, fallback = 0): number {
  const numberValue = typeof value === 'number' ? value : Number(value);

  return Number.isSafeInteger(numberValue) ? numberValue : fallback;
}

function asByteArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const bytes = value.filter(
    (item): item is number => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255
  );

  return bytes.length > 0 ? bytes : undefined;
}

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  // Rust's `Vec<String>` and Flutter's `whereType<String>()` both preserve
  // empty strings. Field sanitization happens later and is intentionally
  // separate from decoding the shared storage shape.
  return value.filter((item): item is string => typeof item === 'string');
}

export function parseTemplateCellValue(value: unknown): TemplateCellValue | null {
  if (!isObject(value)) return null;

  const type = asString(value.type);

  switch (type) {
    case 'text':
    case 'number':
    case 'url':
    case 'legacy':
      return typeof value.value === 'string' ? { type, value: value.value } : null;
    case 'checkbox':
      return typeof value.value === 'boolean' ? { type, value: value.value } : null;
    case 'date_time':
    case 'time': {
      const numberValue = asSafeInteger(value.value, Number.NaN);

      return Number.isSafeInteger(numberValue) ? { type, value: numberValue } : null;
    }

    case 'select':
    case 'person': {
      const items = parseStringList(value.value);

      return items ? { type, value: items } : null;
    }

    default:
      return null;
  }
}

function parseDefaultCells(value: unknown): Record<string, TemplateCellValue> {
  const cells: Record<string, TemplateCellValue> = {};

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!isObject(entry)) return;
      const fieldId = asString(entry.field_id);
      const parsed = parseTemplateCellValue(entry);

      if (fieldId && parsed) cells[fieldId] = parsed;
    });

    return cells;
  }

  // Desktop versions before typed template cells stored field -> raw string.
  if (isObject(value)) {
    Object.entries(value).forEach(([fieldId, rawValue]) => {
      if (typeof rawValue === 'string') cells[fieldId] = { type: 'legacy', value: rawValue };
    });
  }

  return cells;
}

function parseEmbeddedDatabase(value: unknown): TemplateEmbeddedDatabaseSnapshot | null {
  if (!isObject(value)) return null;

  const sourceViewId = asString(value.source_view_id);
  const rawData = asString(value.raw_data);

  if (!sourceViewId || !rawData) return null;

  return {
    sourceViewId,
    sourceDatabaseId: asString(value.source_database_id),
    layoutType: asSafeInteger(value.layout_type),
    name: asString(value.name),
    rawData,
    ...(typeof value.is_linked === 'boolean' ? { isLinked: value.is_linked } : {}),
  };
}

export function parseDatabaseRowTemplate(value: unknown): DatabaseRowTemplate | null {
  if (!isObject(value)) return null;

  const templateId = asString(value.template_id);
  const name = asString(value.name);
  const docViewId = asString(value.doc_view_id);
  const documentData = asByteArray(value.doc_data);

  // This matches Desktop's list filter and create validation. Snapshot-only
  // templates intentionally have no compatibility Folder view, so doc_data
  // is a valid substitute for doc_view_id.
  if (!templateId || !name || (!docViewId && !documentData)) return null;

  const now = Date.now();
  const createdAtMs = asSafeInteger(value.created_at_ms, now);
  const embeddedDatabases = Array.isArray(value.embedded_databases)
    ? value.embedded_databases
        .map(parseEmbeddedDatabase)
        .filter((snapshot): snapshot is TemplateEmbeddedDatabaseSnapshot => snapshot !== null)
    : [];

  return {
    templateId,
    name,
    docViewId,
    documentData,
    isDocumentEmpty: typeof value.is_document_empty === 'boolean' ? value.is_document_empty : true,
    embeddedDatabases,
    defaultCells: parseDefaultCells(value.default_cells),
    ...(typeof value.icon === 'string' ? { icon: value.icon } : {}),
    ...(typeof value.cover === 'string' ? { cover: value.cover } : {}),
    createdAtMs,
    updatedAtMs: asSafeInteger(value.updated_at_ms, createdAtMs),
  };
}

export function parseDatabaseRowTemplates(raw: unknown): DatabaseRowTemplate[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  try {
    const value: unknown = JSON.parse(raw);

    if (!Array.isArray(value)) return [];

    return value.map(parseDatabaseRowTemplate).filter((template): template is DatabaseRowTemplate => template !== null);
  } catch {
    return [];
  }
}

function serializeCell(fieldId: string, cell: TemplateCellValue): PersistedTemplateCellValue | null {
  if ((cell.type === 'date_time' || cell.type === 'time') && !Number.isSafeInteger(cell.value)) return null;

  return {
    field_id: fieldId,
    type: cell.type,
    value: cell.value,
  } as PersistedTemplateCellValue;
}

function serializeEmbeddedDatabase(
  snapshot: TemplateEmbeddedDatabaseSnapshot
): PersistedTemplateEmbeddedDatabaseSnapshot {
  return {
    source_view_id: snapshot.sourceViewId,
    source_database_id: snapshot.sourceDatabaseId,
    layout_type: asSafeInteger(snapshot.layoutType),
    name: snapshot.name,
    raw_data: snapshot.rawData,
    ...(snapshot.isLinked === undefined ? {} : { is_linked: snapshot.isLinked }),
  };
}

export function serializeDatabaseRowTemplate(template: DatabaseRowTemplate): PersistedDatabaseRowTemplate {
  const now = Date.now();
  const createdAtMs = asSafeInteger(template.createdAtMs, now);

  return {
    template_id: template.templateId,
    name: template.name,
    doc_view_id: template.docViewId,
    doc_data: asByteArray(template.documentData) ?? [],
    is_document_empty: template.isDocumentEmpty,
    embedded_databases: template.embeddedDatabases.map(serializeEmbeddedDatabase),
    default_cells: Object.entries(template.defaultCells)
      .map(([fieldId, cell]) => serializeCell(fieldId, cell))
      .filter((cell): cell is PersistedTemplateCellValue => cell !== null),
    ...(template.icon === undefined ? {} : { icon: template.icon }),
    ...(template.cover === undefined ? {} : { cover: template.cover }),
    created_at_ms: createdAtMs,
    updated_at_ms: asSafeInteger(template.updatedAtMs, createdAtMs),
  };
}

export function serializeDatabaseRowTemplates(templates: DatabaseRowTemplate[]): string {
  return JSON.stringify(templates.map(serializeDatabaseRowTemplate));
}

export function parseDatabaseRowTemplateState(
  rawTemplates: unknown,
  rawDefaultTemplateId: unknown
): DatabaseRowTemplateState {
  const templates = parseDatabaseRowTemplates(rawTemplates);
  const requestedDefaultId = typeof rawDefaultTemplateId === 'string' ? rawDefaultTemplateId : '';
  const defaultTemplateId = templates.some((template) => template.templateId === requestedDefaultId)
    ? requestedDefaultId
    : undefined;

  return { templates, defaultTemplateId };
}
