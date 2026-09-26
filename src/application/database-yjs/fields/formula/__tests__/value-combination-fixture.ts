import * as Y from 'yjs';

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { evaluateRollupCell, RollupCellValue } from '@/application/database-yjs/rollup/cache';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  YDatabase,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey as K,
  YjsEditorKey as E,
} from '@/application/types';

import { readFieldFormulaValue, ReadFieldValueContext } from '../cell-values';
import { evaluateFormulaCell } from '../evaluate';
import { FormulaFieldSchema, readFormulaSchema } from '../schema';
import { FormulaValue } from '../values';

import {
  CellSpec,
  checklistData,
  createFields,
  createRow,
  FieldSpec,
  mediaItem,
  RowMeta,
  selectOptions,
} from './fixture';
import datasetJson from './value-combination-dataset.json';

export interface ConcreteValue {
  id: string;
  input: null | {
    text?: string;
    start?: number;
    end?: number;
    include_time?: boolean;
    ids?: string[];
    checked?: boolean;
    done?: number;
    total?: number;
    rows?: string[];
    names?: string[];
    people?: string[];
    uid?: number;
  };
  expected: {
    normalized: string;
    truth: boolean;
    empty: boolean;
    number?: number | null;
    boolean?: boolean;
    items?: string[];
    start_ms?: number | null;
    end_ms?: number | null;
    include_time?: boolean;
  };
}

export interface ValueContract {
  id: string;
  field_type: FieldType;
  source_type: FieldType;
  kind: 'text' | 'number' | 'boolean' | 'date' | 'list';
  value_set: string;
  predicate: string;
  normalize: string;
  formula?: string;
  rollup?: {
    target: 'amount' | 'title' | 'checked';
    formula: string;
    calculation: 'Sum' | 'PercentChecked';
    show_as: 'Calculated' | 'OriginalList';
  };
}

export const dataset = datasetJson as Omit<typeof datasetJson, 'contracts' | 'value_sets'> & {
  contracts: ValueContract[];
  value_sets: Record<string, ConcreteValue[]>;
};

const relatedDatabaseId = 'concrete-related-database';
const ownerDatabaseId = 'concrete-owner-database';

export function database(id: string, specs: FieldSpec[]) {
  const doc = new Y.Doc({ guid: id }) as YDoc;
  const db = new Y.Map() as YDatabase;
  const fields = createFields(specs);

  doc.getMap(E.data_section).set(E.database, db);
  db.set(K.id, id);
  db.set(K.fields, fields.clone());
  fields.doc?.destroy();
  return { doc, db, fields: db.get(K.fields) };
}

export function reload(doc: YDoc): YDoc {
  const restored = new Y.Doc({ guid: doc.guid }) as YDoc;

  Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
  return restored;
}

export function rowOf(doc: YDoc): YDatabaseRow {
  return doc.getMap(E.data_section).get(E.database_row) as YDatabaseRow;
}

export function databaseOf(doc: YDoc): YDatabase {
  return doc.getMap(E.data_section).get(E.database) as YDatabase;
}

function fieldSpecs(contract: ValueContract, id: string): FieldSpec[] {
  const sourceId = contract.formula ? `${id}-source` : id;
  const field: FieldSpec = { id: sourceId, name: sourceId, type: contract.source_type };

  if (field.type === FieldType.SingleSelect || field.type === FieldType.MultiSelect) {
    field.typeOption = { content: selectOptions(dataset.options.map(({ id, name }) => [id, name])) };
  }

  if (contract.rollup) {
    field.typeOption = {
      relation_field_id: `${id}-relation`,
      target_field_id: `formula-${contract.rollup.target}`,
      calculation_type: CalculationType[contract.rollup.calculation],
      show_as: RollupDisplayMode[contract.rollup.show_as],
    };
    return [
      {
        id: `${id}-relation`,
        name: `${id}-relation`,
        type: FieldType.Relation,
        typeOption: { database_id: relatedDatabaseId },
      },
      field,
    ];
  }

  if (field.type === FieldType.Relation) field.typeOption = { database_id: relatedDatabaseId };
  return contract.formula
    ? [
        field,
        {
          id,
          name: id,
          type: FieldType.Formula,
          typeOption: { expression: contract.formula.replaceAll('$source', sourceId) },
        },
      ]
    : [field];
}

function storedValue(
  contract: ValueContract,
  id: string,
  value: ConcreteValue
): { cells: Record<string, CellSpec>; meta: RowMeta } {
  const cells: Record<string, CellSpec> = {};
  const meta: RowMeta = {};
  const input = value.input;

  if (!input) return { cells, meta };
  const sourceId = contract.formula ? `${id}-source` : id;
  const type = contract.source_type;

  switch (type) {
    case FieldType.CreatedTime:
      meta.createdAt = String(input.start);
      break;
    case FieldType.LastEditedTime:
      meta.lastModified = String(input.start);
      break;
    case FieldType.CreatedBy:
      meta.createdBy = input.uid;
      break;
    case FieldType.LastEditedBy:
      meta.lastEditedBy = input.uid;
      break;
    case FieldType.Rollup:
      cells[`${id}-relation`] = { type: FieldType.Relation, data: { yArray: input.rows! } };
      break;
    case FieldType.DateTime:
      cells[sourceId] = {
        type,
        data: String(input.start),
        extra: {
          include_time: input.include_time,
          is_range: input.end !== undefined,
          ...(input.end === undefined ? {} : { end_timestamp: String(input.end) }),
        },
      };
      break;
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      cells[sourceId] = { type, data: input.ids!.join(',') };
      break;
    case FieldType.Checkbox:
      cells[sourceId] = { type, data: input.checked ? 'Yes' : 'No' };
      break;
    case FieldType.Checklist:
      cells[sourceId] = { type, data: checklistData(input.done!, input.total!) };
      break;
    case FieldType.Relation:
      cells[sourceId] = { type, data: { yArray: input.rows! } };
      break;
    case FieldType.Media:
      cells[sourceId] = { type, data: { yArray: input.names!.map((name, i) => mediaItem(`media-${i}`, name)) } };
      break;
    case FieldType.Person:
      cells[sourceId] = { type, data: JSON.stringify(input.people) };
      break;
    default:
      cells[sourceId] = { type, data: input.text! };
  }

  return { cells, meta };
}

export interface PreparedValue {
  contract: ValueContract;
  value: ConcreteValue;
  id: string;
  row: YDatabaseRow;
  schema: FormulaFieldSchema[];
  entry: FormulaFieldSchema;
  context: ReadFieldValueContext;
  /** Reads actual stored cells on every call, including formula source dependencies. */
  read: () => FormulaValue;
}

export interface PreparedContract {
  contract: ValueContract;
  id: string;
  schema: FormulaFieldSchema[];
  source: PreparedValue[];
  restored: PreparedValue[];
}

/**
 * One immutable related graph feeds all states. Rollup results are calculated
 * from its Formula targets before the matrix, never supplied by the oracle.
 * The restored graph has independent YDocs produced by actual Yjs updates.
 */
export async function prepareConcreteValues(): Promise<{ contracts: PreparedContract[][]; destroy: () => void }> {
  const docs: YDoc[] = [];
  const related = database(relatedDatabaseId, [
    { id: 'title', name: 'Title', type: FieldType.RichText },
    { id: 'amount', name: 'Amount', type: FieldType.Number },
    { id: 'checked', name: 'Checked', type: FieldType.Checkbox },
    ...dataset.contracts.flatMap(({ rollup }) =>
      rollup
        ? [
            {
              id: `formula-${rollup.target}`,
              name: `Formula ${rollup.target}`,
              type: FieldType.Formula,
              typeOption: { expression: rollup.formula },
            },
          ]
        : []
    ),
  ]);

  related.fields.get('title').set(K.is_primary, true);
  const relatedRows = new Map<string, YDoc>();

  for (const input of dataset.related_rows) {
    const { doc, row } = createRow(input.id, {
      title: { type: FieldType.RichText, data: input.title },
      checked: { type: FieldType.Checkbox, data: input.checked ? 'Yes' : 'No' },
      ...(input.amount === null ? {} : { amount: { type: FieldType.Number, data: input.amount } }),
    });

    row.set(K.database_id, relatedDatabaseId);
    relatedRows.set(getRowKey(relatedDatabaseId, input.id), doc);
  }

  const restoredRelated = reload(related.doc);
  const restoredRows = new Map(Array.from(relatedRows, ([key, doc]) => [key, reload(doc)]));

  docs.push(related.doc, restoredRelated, ...relatedRows.values(), ...restoredRows.values());
  const contracts: PreparedContract[][] = [[], [], []];

  for (let slot = 0; slot < 3; slot++) {
    for (const contract of dataset.contracts) {
      const id = `${['a', 'b', 'c'][slot]}-${contract.id}`;
      const owner = database(ownerDatabaseId, fieldSpecs(contract, id));
      const restoredOwner = reload(owner.doc);
      const schema = readFormulaSchema(owner.fields);
      const prepared: PreparedContract = { contract, id, schema, source: [], restored: [] };

      docs.push(owner.doc, restoredOwner);
      for (const value of dataset.value_sets[contract.value_set]) {
        const stored = storedValue(contract, id, value);
        const { doc, row } = createRow(`${id}-${value.id}`, stored.cells, stored.meta);

        row.set(K.database_id, ownerDatabaseId);
        const restored = reload(doc);

        docs.push(doc, restored);
        for (const [isRestored, rowDoc, ownerDoc, relatedDoc, rows] of [
          [false, doc, owner.doc, related.doc, relatedRows],
          [true, restored, restoredOwner, restoredRelated, restoredRows],
        ] as const) {
          const storedRow = rowOf(rowDoc);
          const db = databaseOf(ownerDoc);
          const currentSchema = readFormulaSchema(db.get(K.fields));
          const entry = currentSchema.find((field) => field.id === id)!;
          let rollup: RollupCellValue | undefined;

          if (contract.rollup) {
            rollup = await evaluateRollupCell({
              baseDoc: ownerDoc,
              database: db,
              rollupField: entry.field,
              row: storedRow,
              rowId: storedRow.get(K.id),
              fieldId: id,
              getViewIdFromDatabaseId: async (id) => id,
              loadView: async (id) => (id === relatedDatabaseId ? relatedDoc : null),
              createRow: async (key) => rows.get(key)!,
            });
            if (rollup.error) throw new Error(`${id}/${value.id}: ${rollup.error}`);
          }

          const context: ReadFieldValueContext = {
            getRollupValue: (fieldId) => (fieldId === id ? rollup : undefined),
            getPersonName: (personId) => dataset.people.find(({ id }) => id === personId)?.name,
            getUserName: (uid) => dataset.people.find((person) => String(person.uid) === uid)?.name,
            getRelatedRowTitle: (_field, rowId) => {
              const doc = rows.get(getRowKey(relatedDatabaseId, rowId));

              if (!doc) return null;
              const fields = databaseOf(relatedDoc).get(K.fields);
              const entry = readFormulaSchema(fields).find(({ id }) => id === 'title')!;
              const value = readFieldFormulaValue(entry, rowOf(doc), {});

              return value.type === 'text' ? value.value : '';
            },
          };
          const read = () => {
            if (contract.field_type !== FieldType.Formula) return readFieldFormulaValue(entry, storedRow, context);
            const result = evaluateFormulaCell({
              schema: currentSchema,
              field: entry.field,
              fieldId: id,
              row: storedRow,
              rowId: storedRow.get(K.id),
              now: () => dataset.now_ms,
              ...context,
            });

            if (result.error) throw new Error(`${id}/${value.id}: ${result.error}`);
            return result.value;
          };

          prepared[isRestored ? 'restored' : 'source'].push({
            contract,
            value,
            id,
            row: storedRow,
            schema: currentSchema,
            entry,
            context,
            read,
          });
        }
      }

      contracts[slot].push(prepared);
    }
  }

  return { contracts, destroy: () => docs.forEach((doc) => doc.destroy()) };
}

const metadataTypes = new Set([
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
]);

/** A single row cannot store two different values for the same metadata key. */
export function incompatibleMetadata(left: PreparedValue, right: PreparedValue): boolean {
  return (
    metadataTypes.has(left.contract.source_type) &&
    left.contract.source_type === right.contract.source_type &&
    left.value.id !== right.value.id
  );
}

export function fieldForExpression(
  id: string,
  expression: string
): { fields: YDatabaseFields; entry: FormulaFieldSchema } {
  const fields = createFields([{ id, name: id, type: FieldType.Formula, typeOption: { expression } }]);

  return { fields, entry: readFormulaSchema(fields)[0] };
}
