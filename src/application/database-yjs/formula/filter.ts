import { DateTimeCell } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  compileFormula,
  evaluateFormulaCell,
  FormulaCellResult,
  FormulaFieldSchema,
  FormulaType,
  parseFormulaTypeOption,
  ReadFieldValueContext,
  readFormulaSchema,
} from '@/application/database-yjs/fields/formula';
import { YDatabaseField, YDatabaseFields, YDatabaseRow } from '@/application/types';

function resolveFields(field: YDatabaseField, fields?: YDatabaseFields): YDatabaseFields | undefined {
  // A field map's parent is the database's `fields` map, so callers that only
  // hold the field (filter badges, menus) can still see the whole schema.
  return fields ?? ((field.parent as YDatabaseFields | null) ?? undefined);
}

function findFieldId(field: YDatabaseField, fields?: YDatabaseFields): string | undefined {
  let found: string | undefined;

  fields?.forEach((candidate, id) => {
    if (candidate === field) found = id;
  });

  return found;
}

/** Static result type of a formula field (`any` when the expression is invalid). */
export function formulaResultTypeOfField(field: YDatabaseField, fields?: YDatabaseFields): FormulaType {
  const allFields = resolveFields(field, fields);

  return compileFormula(parseFormulaTypeOption(field).formula, readFormulaSchema(allFields), findFieldId(field, allFields))
    .resultType;
}

/**
 * The native field type whose filter and sort vocabulary a formula borrows:
 * numbers filter like Number, booleans like Checkbox, dates like Date, and
 * everything else (text, lists, invalid) like Text.
 */
export function formulaPredicateFieldType(field: YDatabaseField, fields?: YDatabaseFields): FieldType {
  return predicateFieldTypeForResult(formulaResultTypeOfField(field, fields));
}

export function predicateFieldTypeForResult(resultType: FormulaType): FieldType {
  switch (resultType) {
    case 'number':
      return FieldType.Number;
    case 'boolean':
      return FieldType.Checkbox;
    case 'date':
      return FieldType.DateTime;
    default:
      return FieldType.RichText;
  }
}

/**
 * Evaluates a formula for a row inside filter/sort passes (no React). Build
 * `schema` once per pass with `readFormulaSchema`, not once per row;
 * `context` supplies member names, related titles and rollup results.
 */
export function evaluateFormulaForRow(
  field: YDatabaseField,
  fieldId: string,
  schema: FormulaFieldSchema[],
  row: YDatabaseRow,
  rowId: string,
  context?: ReadFieldValueContext
): FormulaCellResult {
  return evaluateFormulaCell({ ...context, schema, field, fieldId, row, rowId });
}

/** A date result shaped like a Date cell so the date filter predicates apply unchanged. */
export function formulaResultToDateCell(result: FormulaCellResult): DateTimeCell | null {
  if (!result.rawDate) return null;

  return {
    fieldType: FieldType.DateTime,
    createdAt: 0,
    lastModified: 0,
    data: String(result.rawDate.start),
    endTimestamp: result.rawDate.end === undefined ? undefined : String(result.rawDate.end),
    isRange: result.rawDate.end !== undefined,
    includeTime: result.rawDate.includeTime,
  };
}

/** The text a number-typed formula exposes to number predicates (plain, unformatted). */
export function formulaResultToNumberText(result: FormulaCellResult): string {
  return result.rawNumeric === undefined || !Number.isFinite(result.rawNumeric) ? '' : String(result.rawNumeric);
}
