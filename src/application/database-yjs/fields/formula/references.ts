import { FieldType } from '@/application/database-yjs/database.type';
import { parseRollupTypeOption } from '@/application/database-yjs/fields/rollup/parse';
import { YDatabaseField, YDatabaseFields, YjsDatabaseKey } from '@/application/types';

import { collectPropRefs, formulaUsesClock } from './ast';
import { compileFormula } from './compile';
import { parseFormulaTypeOption } from './parse';
import { FormulaFieldSchema, resolveFormulaField } from './schema';

/** Fields whose formula values come from outside the row document. */
export interface FormulaExternalReferences {
  /** now()/today(), including calls in referenced formulas. */
  clock?: boolean;
  /** Person, Created by or Last edited by: names come from the workspace members. */
  people: boolean;
  /** Relation fields: titles come from the related database. */
  relations: FormulaFieldSchema[];
  /** Rollup fields: values are computed from related rows. */
  rollups: FormulaFieldSchema[];
}

export const NO_EXTERNAL_REFERENCES: FormulaExternalReferences = { people: false, relations: [], rollups: [] };

const PEOPLE_TYPES = new Set([FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy]);

/**
 * The fields an expression reads, directly or through the formulas it
 * references, that need data from outside the row. The expression may name
 * properties by id (storage form) or by name (the editor's draft).
 */
export function collectExpressionExternalReferences(
  expression: string,
  schema: FormulaFieldSchema[],
  ownerId?: string
): FormulaExternalReferences {
  let people = false;
  let clock = false;
  const relations = new Map<string, FormulaFieldSchema>();
  const rollups = new Map<string, FormulaFieldSchema>();
  const visited = new Set<string>(ownerId ? [ownerId] : []);
  const visit = (source: string, fieldId?: string) => {
    // Compiles are cached, and evaluation compiles the same expression anyway.
    const { ast } = compileFormula(source, schema, fieldId);

    if (!ast) return;
    clock ||= formulaUsesClock(ast);
    collectPropRefs(ast).forEach((ref) => {
      const entry = resolveFormulaField(schema, ref);

      if (!entry) return;
      if (PEOPLE_TYPES.has(entry.type)) people = true;
      if (entry.type === FieldType.Relation) relations.set(entry.id, entry);
      if (entry.type === FieldType.Rollup) rollups.set(entry.id, entry);
      if (entry.type === FieldType.Formula && !visited.has(entry.id)) {
        visited.add(entry.id);
        visit(parseFormulaTypeOption(entry.field).formula, entry.id);
      }
    });
  };

  visit(expression, ownerId);
  if (!clock && !people && relations.size === 0 && rollups.size === 0) return NO_EXTERNAL_REFERENCES;
  return { clock, people, relations: Array.from(relations.values()), rollups: Array.from(rollups.values()) };
}

/** `collectExpressionExternalReferences` for a formula field's saved expression. */
export function collectFormulaExternalReferences(
  field: YDatabaseField,
  schema: FormulaFieldSchema[]
): FormulaExternalReferences {
  const fieldId = field.get(YjsDatabaseKey.id);

  return collectExpressionExternalReferences(
    parseFormulaTypeOption(field).formula,
    schema,
    fieldId ? String(fieldId) : undefined
  );
}

/** Identity includes configuration: an unchanged field id can read different data. */
export function formulaExternalReferencesKey(references: FormulaExternalReferences): string {
  if (references === NO_EXTERNAL_REFERENCES) return '';
  const fieldKey = (entry: FormulaFieldSchema) => {
    const relationId = entry.type === FieldType.Rollup ? parseRollupTypeOption(entry.field)?.relation_field_id : undefined;
    const relation = relationId ? (entry.field.parent as YDatabaseFields | null)?.get(relationId) : undefined;

    return [entry.id, entry.type, entry.field.get(YjsDatabaseKey.type_option)?.toJSON(), relation?.toJSON()];
  };

  return JSON.stringify([
    references.clock,
    references.people,
    references.relations.map(fieldKey),
    references.rollups.map(fieldKey),
  ]);
}
