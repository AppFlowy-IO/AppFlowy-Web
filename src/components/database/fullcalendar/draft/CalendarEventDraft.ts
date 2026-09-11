import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { populateNewRowCells } from '@/application/database-yjs/dispatch/new-row-cells';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta } from '@/application/database-yjs/row_meta';
import { readDatabaseRowTemplateState } from '@/application/database-yjs/template';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { correctAllDayEndForStorage } from '@/utils/time';

export interface CalendarDraftSelection {
  start: Date;
  /** FullCalendar's exclusive end for all-day selections. */
  end?: Date;
  allDay: boolean;
}

export interface CalendarDraftSnapshot {
  id: string;
  cells: YDatabaseCells;
  meta: Y.Map<unknown>;
}

function meaningfulValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(meaningfulValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'created_at' && key !== 'last_modified')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, meaningfulValue(item)])
    );
  }

  return value;
}

// Cloud Yjs integers can be bigint values, which Y.Map.clone cannot integrate.
// Copy only editor schema, omitting row orders before allocating their contents.
function cloneDraftSchema(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Y.Map) {
    const copy = new Y.Map<unknown>();

    value.forEach((child, key) =>
      copy.set(key, key === YjsDatabaseKey.row_orders ? new Y.Array() : cloneDraftSchema(child))
    );
    return copy;
  }

  if (value instanceof Y.Array) {
    const copy = new Y.Array<unknown>();

    copy.push(value.toArray().map(cloneDraftSchema));
    return copy;
  }

  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map(cloneDraftSchema);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneDraftSchema(item)]));
  }

  return value;
}

/** An ephemeral editing environment: no row binding, IndexedDB or outbox. */
export class CalendarEventDraft {
  readonly id = uuidv4();
  readonly databaseDoc = new Y.Doc() as YDoc;
  readonly rowDoc = new Y.Doc({ guid: this.id }) as YDoc;
  readonly context: DatabaseContextState;
  readonly database: YDatabase;
  readonly cells: YDatabaseCells;
  readonly meta: Y.Map<unknown>;
  readonly selection: CalendarDraftSelection;
  readonly templateId?: string;
  saving = false;
  savedId: string | null = null;
  private baseline: string;
  private pending?: Promise<string | null>;
  private readonly files = new Map<string, { file: File; remote?: string }>();
  private readonly originalOptions = new Map<string, ReturnType<typeof parseSelectOptionTypeOptions>>();

  constructor(readonly source: DatabaseContextState, readonly dateFieldId: string, selection: CalendarDraftSelection) {
    const database = source.databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    this.database = new Y.Map() as YDatabase;
    this.database.set(YjsDatabaseKey.id, database.get(YjsDatabaseKey.id));
    this.database.set(YjsDatabaseKey.fields, cloneDraftSchema(database.get(YjsDatabaseKey.fields)));
    this.database.set(YjsDatabaseKey.views, cloneDraftSchema(database.get(YjsDatabaseKey.views)));
    this.databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, this.database);
    const fields = this.database.get(YjsDatabaseKey.fields);

    fields.forEach((field, id) => this.originalOptions.set(id, parseSelectOptionTypeOptions(field)));
    initialDatabaseRow(this.id, database.get(YjsDatabaseKey.id), this.rowDoc);
    const root = this.rowDoc.getMap(YjsEditorKey.data_section);
    const row = root.get(YjsEditorKey.database_row) as YDatabaseRow;

    this.cells = row.get(YjsDatabaseKey.cells);
    this.meta = root.get(YjsEditorKey.meta) as Y.Map<unknown>;
    const templates = readDatabaseRowTemplateState(database);
    const template = templates.templates.find((item) => item.templateId === templates.defaultTemplateId);

    this.templateId = template?.templateId;
    const start = selection.allDay ? dayjs(selection.start).startOf('day').toDate() : selection.start;
    let end = selection.end;

    if (selection.allDay && end && dayjs(end).diff(dayjs(start), 'day') <= 1) end = undefined;
    if (!selection.allDay && (!end || end.getTime() - start.getTime() <= 30 * 60 * 1000)) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    this.selection = { start, end, allDay: selection.allDay };
    const fieldType = Number(fields.get(dateFieldId)?.get(YjsDatabaseKey.type));
    const isSystemTime = fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime;
    const storedEnd = selection.allDay && end ? correctAllDayEndForStorage(end) : end;
    const dateData = {
      data: String(dayjs(start).unix()),
      endTimestamp: storedEnd ? String(dayjs(storedEnd).unix()) : undefined,
      isRange: !!storedEnd,
      includeTime: !selection.allDay,
    };

    this.rowDoc.transact(() => {
      populateNewRowCells({
        row,
        database: this.database,
        template,
        filters: this.database.get(YjsDatabaseKey.views)?.get(source.activeViewId)?.get(YjsDatabaseKey.filters),
        calendarFieldId: dateFieldId,
        cellsData: isSystemTime ? undefined : { [dateFieldId]: dateData },
      });
      const meta = generateRowMeta(this.id, {
        [RowMetaKey.IconId]: template?.icon ?? null,
        [RowMetaKey.CoverId]: template?.cover ?? null,
        [RowMetaKey.IsDocumentEmpty]: template?.isDocumentEmpty ?? true,
      });

      Object.entries(meta).forEach(([key, value]) => this.meta.set(key, value));
    });

    this.context = {
      ...source,
      databaseDoc: this.databaseDoc,
      rowMap: { [this.id]: this.rowDoc },
      // This existing isolated-row contract also suppresses reciprocal links.
      templateEditingRowId: this.id,
      ensureRow: async (id) => (id === this.id ? this.rowDoc : undefined),
      loadRowFromSeed: undefined,
      peekRowDocFromSeed: undefined,
      bindRowSync: undefined,
      markCellLocalMutation: undefined,
      hasCellLocalMutation: undefined,
      getCellLocalMutationRevision: undefined,
      subscribeToCellLocalMutations: undefined,
      // Relation pickers use this callback to load existing row documents.
      // Keep the draft itself local; isolated pickers disable target creation.
      createRow: async (key) => {
        if (key.endsWith(`_rows_${this.id}`)) return this.rowDoc;
        if (!source.createRow) throw new Error('Related row loading is unavailable');
        return source.createRow(key);
      },
      navigateToRow: undefined,
      bindViewSync: undefined,
      loadRowDocument: undefined,
      createRowDocument: undefined,
      duplicateRowDocument: undefined,
      checkIfRowDocumentExists: async () => false,
      uploadFile: async (file) => {
        const url = URL.createObjectURL(file);

        this.files.set(url, { file });
        return url;
      },
    };
    this.baseline = this.fingerprint();
  }

  private fingerprint() {
    return JSON.stringify(
      meaningfulValue({
        cells: this.cells.toJSON(),
        meta: this.meta.toJSON(),
        fields: this.database.get(YjsDatabaseKey.fields).toJSON(),
      })
    );
  }

  get dirty() {
    return this.fingerprint() !== this.baseline;
  }

  /** Share a single in-flight save across Escape, blur and explicit submission. */
  commit(persist: (snapshot: CalendarDraftSnapshot) => Promise<string | null>, force = false): Promise<string | null> {
    if (this.pending) return this.pending;
    if (this.savedId) return Promise.resolve(this.savedId);
    if (!force && !this.dirty) return Promise.resolve(null);
    this.saving = true;
    this.pending = (async () => {
      const snapshotDoc = new Y.Doc();
      const cells = this.cells.clone() as YDatabaseCells;

      const meta = this.meta.clone() as Y.Map<unknown>;

      snapshotDoc.getMap('snapshot').set('cells', cells);
      snapshotDoc.getMap('snapshot').set('meta', meta);
      try {
        await this.resolveUploads(cells);
        this.commitOptions();
        const id = await persist({ id: this.id, cells, meta });

        if (!id) throw new Error('The calendar row could not be saved');
        this.savedId = id;
        return id;
      } catch (error) {
        // Publication is the ownership boundary. A later reciprocal-link error
        // must never leave a real row offering the local-only discard action.
        const liveDatabase = this.source.databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
        const orders = liveDatabase.get(YjsDatabaseKey.views).get(this.source.activeViewId)?.get(YjsDatabaseKey.row_orders);

        if (orders?.toArray().some((row) => row.id === this.id)) this.savedId = this.id;
        throw error;
      } finally {
        snapshotDoc.destroy();
        this.saving = false;
        this.pending = undefined;
      }
    })();
    return this.pending;
  }

  private async resolveUploads(cells: YDatabaseCells) {
    const replacements: Array<Promise<void>> = [];

    cells.forEach((value, fieldId) => {
      const cell = value as YDatabaseCell;
      const field = this.database.get(YjsDatabaseKey.fields).get(fieldId);

      if (Number(field?.get(YjsDatabaseKey.type)) !== FieldType.Media) return;
      const data = cell.get(YjsDatabaseKey.data);

      if (!(data instanceof Y.Array)) return;
      replacements.push(
        (async () => {
          const items = await Promise.all(
            data.toArray().map(async (raw) => {
              const item = JSON.parse(raw);
              const pending = this.files.get(item.url);

              if (!pending) return raw;
              if (!this.source.uploadFile) throw new Error('File upload is unavailable');
              pending.remote ??= await this.source.uploadFile(pending.file);
              return JSON.stringify({ ...item, url: pending.remote });
            })
          );

          data.delete(0, data.length);
          data.push(items);
        })()
      );
    });
    await Promise.all(replacements);
  }

  private commitOptions() {
    const liveDatabase = this.source.databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database) as YDatabase;

    this.source.databaseDoc.transact(() => {
      this.database.get(YjsDatabaseKey.fields).forEach((field, id) => {
        const type = Number(field.get(YjsDatabaseKey.type));

        if (type !== FieldType.SingleSelect && type !== FieldType.MultiSelect) return;
        const baseline = this.originalOptions.get(id)?.options ?? [];
        const local = parseSelectOptionTypeOptions(field).options ?? [];

        if (JSON.stringify(baseline) === JSON.stringify(local)) return;
        const live = liveDatabase.get(YjsDatabaseKey.fields).get(id);

        if (!live || Number(live.get(YjsDatabaseKey.type)) !== type) return;
        const current = parseSelectOptionTypeOptions(live);
        const removed = new Set(
          baseline.filter((option) => !local.some((item) => item.id === option.id)).map((item) => item.id)
        );
        const options = (current.options ?? []).filter((option) => !removed.has(option.id));

        local.forEach((option) => {
          if (JSON.stringify(option) === JSON.stringify(baseline.find((item) => item.id === option.id))) return;
          const index = options.findIndex((item) => item.id === option.id);

          if (index === -1) options.push(option);
          else options[index] = option;
        });
        getTypeOptions(live)?.set(YjsDatabaseKey.content, JSON.stringify({ ...current, options }));
      });
    });
  }

  dispose() {
    this.files.forEach((_, url) => URL.revokeObjectURL(url));
    this.files.clear();
    this.rowDoc.destroy();
    this.databaseDoc.destroy();
  }
}
