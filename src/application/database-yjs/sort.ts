import { FieldType, RollupDisplayMode, SortCondition } from '@/application/database-yjs/database.type';
import {
  ConditionSortValue,
  getConditionSortValue,
  getRowConditionSnapshot,
} from '@/application/database-yjs/condition-value-cache';
import { parseRollupTypeOption } from '@/application/database-yjs/fields';
import { FormulaFieldSchema, ReadFieldValueContext, readFormulaSchema } from '@/application/database-yjs/fields/formula';
import { evaluateFormulaForRow, formulaPredicateFieldType } from '@/application/database-yjs/formula/filter';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';
import { Row } from '@/application/database-yjs/selector';
import { RowId, YDatabaseFields, YDatabaseSorts, YDoc, YjsDatabaseKey } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';

type SortableValue = ConditionSortValue;

type SortOptions = {
  getRelationCellText?: (rowId: string, fieldId: string) => string;
  getRollupCellValue?: (rowId: string, fieldId: string) => { value: string; rawNumeric?: number };
  getAttributionName?: (uid: string) => string | undefined;
  /** Member names, related titles and rollup results for formula sorts. */
  getFormulaContext?: (rowId: string) => ReadFieldValueContext;
};

export function sortBy(
  rows: Row[],
  sorts: YDatabaseSorts,
  fields: YDatabaseFields,
  rowMetas: Record<RowId, YDoc>,
  options?: SortOptions
) {
  const sortArray = sorts.toArray();

  if (sortArray.length === 0 || Object.keys(rowMetas).length === 0 || fields.size === 0) return rows;

  // Define collator for Unicode string comparison
  // Can adjust parameters based on application needs, such as locale, sensitivity, etc.
  const collator = new Intl.Collator('en', {
    sensitivity: 'base',
    numeric: true, // Use numeric sorting, such as "2" before "10"
    usage: 'sort', // Used specifically for sorting
  });

  // Create a function for comparison
  const compare = (a: SortableValue, b: SortableValue, order: string): number => {
    if (a === undefined && b === undefined) return 0;
    // undefined value is placed at the end
    if (a === undefined) return order === 'asc' ? 1 : -1;
    if (b === undefined) return order === 'asc' ? -1 : 1;

    // Handle strings
    if (typeof a === 'string' && typeof b === 'string') {
      return order === 'asc' ? collator.compare(a, b) : collator.compare(b, a);
    }

    // Handle other types
    if (order === 'asc') {
      return a < b ? -1 : a > b ? 1 : 0;
    } else {
      return a > b ? -1 : a < b ? 1 : 0;
    }
  };

  // Prepare sort data, pre-calculate all values to avoid multiple calculations
  const rollupNumericCache = new Map<string, boolean>();
  const formulaPredicateCache = new Map<string, FieldType>();
  // Formula sorts evaluate every row; read the schema once for the pass.
  let formulaSchema: FormulaFieldSchema[] | undefined;
  const getFormulaSchema = () => (formulaSchema ??= readFormulaSchema(fields));
  const sortData = rows.map((row) => {
    const values = sortArray.map((sort) => {
      const fieldId = sort.get(YjsDatabaseKey.field_id);

      if (!fieldId) return '';

      const field = fields.get(fieldId);
      const fieldType = Number(field.get(YjsDatabaseKey.type));

      // Formulas sort by their evaluated result, ordered like the native type
      // of that result (numbers numerically, dates chronologically, ...).
      if (fieldType === FieldType.Formula) {
        const predicateType =
          formulaPredicateCache.get(fieldId) ??
          (() => {
            const type = formulaPredicateFieldType(field, fields);

            formulaPredicateCache.set(fieldId, type);
            return type;
          })();
        const defaultData = defaultValueForSort(predicateType, Number(sort.get(YjsDatabaseKey.condition)));
        const snapshot = getRowConditionSnapshot(rowMetas[row.id]);

        if (!snapshot) return defaultData;
        const result = evaluateFormulaForRow(
          field,
          fieldId,
          getFormulaSchema(),
          snapshot.row,
          row.id,
          options?.getFormulaContext?.(row.id)
        );

        if (result.error) return defaultData;

        switch (predicateType) {
          case FieldType.Number:
            return result.rawNumeric !== undefined && Number.isFinite(result.rawNumeric) ? result.rawNumeric : defaultData;
          case FieldType.DateTime:
            return result.rawDate ? result.rawDate.start : defaultData;
          case FieldType.Checkbox:
            return Boolean(result.rawBoolean);
          default:
            return result.text || defaultData;
        }
      }

      const isRollupNumeric =
        fieldType === FieldType.Rollup
          ? rollupNumericCache.get(fieldId) ??
            (() => {
              const numeric = isNumericRollupField(field);

              rollupNumericCache.set(fieldId, numeric);
              return numeric;
            })()
          : false;

      const rowId = row.id;
      const rowMeta = rowMetas[rowId];
      const snapshot = getRowConditionSnapshot(rowMeta);

      const defaultData = defaultValueForSort(fieldType, Number(sort.get(YjsDatabaseKey.condition)), isRollupNumeric);

      if (!snapshot) return defaultData;

      if (fieldType === FieldType.LastEditedTime) {
        return snapshot.row.get(YjsDatabaseKey.last_modified);
      }

      if (fieldType === FieldType.CreatedTime) {
        return snapshot.row.get(YjsDatabaseKey.created_at);
      }

      if (fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy) {
        const attribute = fieldType === FieldType.CreatedBy ? YjsDatabaseKey.created_by : YjsDatabaseKey.last_edited_by;
        const uid = canonicalizeUserUid(snapshot.row.get(attribute));

        if (uid === null) return defaultData;

        return options?.getAttributionName?.(uid)?.trim() || `User ${uid}`;
      }

      if (fieldType === FieldType.Relation && options?.getRelationCellText) {
        const relationText = options.getRelationCellText(rowId, fieldId);

        if (relationText === undefined || relationText === '') {
          return defaultData;
        }

        return relationText;
      }

      if (fieldType === FieldType.Rollup && options?.getRollupCellValue) {
        const rollupOption = parseRollupTypeOption(field);
        const showAs = (rollupOption?.show_as ?? RollupDisplayMode.Calculated) as RollupDisplayMode;

        if (showAs !== RollupDisplayMode.Calculated) {
          return defaultData;
        }

        const rollupValue = options.getRollupCellValue(rowId, fieldId);

        if (isRollupNumeric) {
          if (typeof rollupValue?.rawNumeric === 'number' && Number.isFinite(rollupValue.rawNumeric)) {
            return rollupValue.rawNumeric;
          }

          return defaultData;
        }

        return rollupValue?.value || defaultData;
      }

      const decoded = getConditionSortValue(snapshot, fieldId, field);

      if (decoded === undefined || decoded === null || decoded === '') {
        return defaultData;
      }

      return decoded;
    });

    return { row, values };
  });

  sortData.sort((a, b) => {
    for (let i = 0; i < sortArray.length; i++) {
      const order = Number(sortArray[i].get(YjsDatabaseKey.condition)) === SortCondition.Descending ? 'desc' : 'asc';
      const result = compare(a.values[i], b.values[i], order);

      if (result !== 0) return result;
    }

    return 0;
  });

  return sortData.map((item) => item.row);
}

export function defaultValueForSort(fieldType: FieldType, condition: SortCondition, isRollupNumeric?: boolean) {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
    case FieldType.Relation:
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return condition === SortCondition.Descending ? '\u0000' : '\uFFFF';
    case FieldType.Number:
    case FieldType.Checklist:
    case FieldType.DateTime:
      return condition === SortCondition.Descending ? -Infinity : Infinity;
    case FieldType.Rollup:
      return isRollupNumeric
        ? condition === SortCondition.Descending
          ? -Infinity
          : Infinity
        : condition === SortCondition.Descending
        ? '\u0000'
        : '\uFFFF';
    case FieldType.Checkbox:
      return false;
    default:
      return condition === SortCondition.Descending ? '\u0000' : '\uFFFF';
  }
}
