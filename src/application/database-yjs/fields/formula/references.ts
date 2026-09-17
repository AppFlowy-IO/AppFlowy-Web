import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField } from '@/application/types';

import { parseFormulaTypeOption } from './parse';
import { FormulaFieldSchema } from './schema';

/** Fields whose formula values come from outside the row document. */
export interface FormulaExternalReferences {
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
 * The fields a formula reads, directly or through the formulas it references,
 * that need data from outside the row. References are stored as
 * `prop("<field id>")`, so a quoted id in the expression is a reference.
 */
export function collectFormulaExternalReferences(
  field: YDatabaseField,
  schema: FormulaFieldSchema[]
): FormulaExternalReferences {
  const people = { found: false };
  const relations = new Map<string, FormulaFieldSchema>();
  const rollups = new Map<string, FormulaFieldSchema>();
  const visited = new Set<string>();
  const visit = (expression: string) => {
    schema.forEach((entry) => {
      if (!expression.includes(`"${entry.id}"`)) return;
      if (PEOPLE_TYPES.has(entry.type)) people.found = true;
      if (entry.type === FieldType.Relation) relations.set(entry.id, entry);
      if (entry.type === FieldType.Rollup) rollups.set(entry.id, entry);
      if (entry.type === FieldType.Formula && !visited.has(entry.id)) {
        visited.add(entry.id);
        visit(parseFormulaTypeOption(entry.field).formula);
      }
    });
  };

  visit(parseFormulaTypeOption(field).formula);
  if (!people.found && relations.size === 0 && rollups.size === 0) return NO_EXTERNAL_REFERENCES;
  return { people: people.found, relations: Array.from(relations.values()), rollups: Array.from(rollups.values()) };
}
