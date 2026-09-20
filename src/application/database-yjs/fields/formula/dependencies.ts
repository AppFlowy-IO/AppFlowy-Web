import { FieldType } from '@/application/database-yjs/database.type';
import { parseRollupTypeOption } from '@/application/database-yjs/fields/rollup/parse';

import { collectPropRefs } from './ast';
import { parseFormulaTypeOption } from './parse';
import { parseFormula } from './parser';
import { FormulaFieldSchema, resolveFormulaField } from './schema';

/** Formula fields affected by deleting a property in this database, including indirect dependencies. */
export function collectDependentFormulaFields(schema: FormulaFieldSchema[], fieldId: string): FormulaFieldSchema[] {
  const dependents = new Map<string, Set<string>>();
  const addDependency = (sourceId: string, dependentId: string) => {
    let entries = dependents.get(sourceId);

    if (!entries) {
      entries = new Set();
      dependents.set(sourceId, entries);
    }

    entries.add(dependentId);
  };

  schema.forEach((entry) => {
    if (entry.type === FieldType.Rollup) {
      const relationId = parseRollupTypeOption(entry.field)?.relation_field_id;

      if (relationId) addDependency(relationId, entry.id);
    }

    if (entry.type !== FieldType.Formula) return;
    try {
      // Parse independently of type checking: an already invalid formula may
      // still reference the property being deleted. Strings/comments aren't references.
      const ast = parseFormula(parseFormulaTypeOption(entry.field).formula);

      collectPropRefs(ast).forEach((ref) => {
        const dependency = resolveFormulaField(schema, ref);

        if (dependency) addDependency(dependency.id, entry.id);
      });
    } catch {
      // Incomplete expressions have no reliable dependency tree.
    }
  });

  const affected = new Set([fieldId]);

  // Set iteration also visits entries added during traversal, once each.
  affected.forEach((id) => dependents.get(id)?.forEach((dependentId) => affected.add(dependentId)));
  return schema.filter((entry) => entry.id !== fieldId && entry.type === FieldType.Formula && affected.has(entry.id));
}
