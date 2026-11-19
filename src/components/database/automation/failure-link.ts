import { NIL, validate as isUuid } from 'uuid';

export type FailureRule = { database: string; rule: string; row?: string };

const validId = (value: unknown): value is string => typeof value === 'string' && value !== NIL && isUuid(value);

function ruleTarget(database: unknown, rule: unknown, row: unknown): FailureRule | undefined {
  if (!validId(database) || !validId(rule) || (row !== undefined && row !== null && !validId(row))) return;
  return { database, rule, ...(validId(row) && { row }) };
}

export function failureRuleSearch(metadata: Record<string, unknown>): URLSearchParams | undefined {
  const target = ruleTarget(metadata.database_id, metadata.automation_id, metadata.scope_row_id);

  if (!target) return;
  const search = new URLSearchParams({ automationDatabase: target.database, automationId: target.rule });

  if (target.row) search.set('automationRow', target.row);
  return search;
}

export function failureRuleFromSearch(search: URLSearchParams) {
  return ruleTarget(search.get('automationDatabase'), search.get('automationId'), search.get('automationRow'));
}
