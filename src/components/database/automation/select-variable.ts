import { FieldType } from '@/application/database-yjs';
import type { PropertyValue, RuleAction } from '@/application/services/js-services/http/automation-api';

export function selectVariableConstants(actions: RuleAction[]) {
  const constants = new Map<string, PropertyValue>();

  for (const action of actions) {
    if (action.type !== 'define_variable' || !action.name || !action.value) continue;
    const value = action.value.kind === 'variable' ? constants.get(action.value.name || '') : action.value;

    if (value && ['single_select', 'multi_select', 'multi_select_delta'].includes(value.kind))
      constants.set(action.name, value);
  }

  return constants;
}

export function optionIdsFit(value: PropertyValue | undefined, options: { id: string }[]) {
  if (!value) return true;
  const ids = Array.isArray(value.value) ? value.value : [value.value];

  return ids.every((id) => options.some((option) => option.id === id));
}

type OptionField = { id: string; type?: number; options: { id: string }[] };

/** Resolve each destination's schema once per save, only for assignments consuming literal option IDs. */
export async function selectAssignmentsFit(
  source: string,
  actions: RuleAction[],
  readFields: (database: string, fieldIds: string[]) => Promise<OptionField[]>
) {
  const constants = selectVariableConstants(actions);
  const targets = new Map<string, { field: string; value: PropertyValue }[]>();

  if (!constants.size) return true;
  for (const action of actions) {
    const database = action.type === 'set_property' ? source : action.database_id;

    if (!database) continue;
    const properties = action.type === 'set_property' ? [action] : action.properties ?? [];

    for (const assignment of properties) {
      if (!assignment.field_id || assignment.value?.kind !== 'variable') continue;
      const value = constants.get(assignment.value.name || '');

      if (!value) continue;
      const current = targets.get(database) ?? [];

      current.push({ field: assignment.field_id, value });
      targets.set(database, current);
    }
  }

  const valid = await Promise.all(
    [...targets].map(async ([database, assignments]) => {
      const fields = await readFields(database, [...new Set(assignments.map((assignment) => assignment.field))]);

      return assignments.every(({ field, value }) => {
        const target = fields.find((item) => item.id === field);
        const kind = value.kind === 'single_select' ? FieldType.SingleSelect : FieldType.MultiSelect;

        return target?.type === kind && optionIdsFit(value, target.options);
      });
    })
  );

  return valid.every(Boolean);
}
