import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export type RuleTrigger = {
  type: string;
  field_id?: string;
  ty?: number;
  condition?: number;
  content?: string;
  option_id?: string;
  field_ids?: string[];
  triggers?: RuleTrigger[];
  match?: 'any' | 'all';
  view_id?: string;
};

export type TextPart =
  | { type: 'text'; value: string }
  | { type: 'field'; field_id: string }
  | { type: 'variable'; name: string }
  | { type: 'step_row_id'; action_index: number };
export type AutomationText = string | { parts: TextPart[] };
export type MemberRecipient =
  | { type: 'address'; value: AutomationText }
  | { type: 'workspace_user'; user_id: string }
  | { type: 'actor' }
  | { type: 'person_field'; field_id: string };
export type EmailRecipient = AutomationText | MemberRecipient;
export function isMemberRecipient(value: EmailRecipient): value is MemberRecipient {
  return !!value && typeof value === 'object' && 'type' in value;
}

export function recipientText(value?: EmailRecipient): AutomationText | undefined {
  return value === undefined || isMemberRecipient(value) ? undefined : value;
}

export type Formula = {
  operator: 'add' | 'subtract' | 'multiply' | 'divide' | 'add_days';
  left: PropertyValue;
  right: PropertyValue;
};
export type PropertyValue = {
  kind: string;
  expression?: string;
  operation?: 'replace' | 'add' | 'remove';
  value?: string | number | boolean | string[] | Formula;
  field_id?: string;
  name?: string;
  parts?: TextPart[];
};
export type TargetRow =
  | { type: 'id'; row_id: string }
  | { type: 'step'; action_index: number }
  | { type: 'trigger' }
  | { type: 'matching'; conditions: unknown[] }
  | { type: 'variable'; name: string };
export type Assignment = { field_id: string; value: PropertyValue };
export interface RuleSchedule {
  row_id?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  weekdays?: number[];
  starts_on: string;
  ends_on?: string;
  local_time: string;
  timezone: string;
}
export function isCustomSchedule(schedule: RuleSchedule): boolean {
  return schedule.frequency === 'yearly' || (schedule.interval ?? 1) !== 1 || !!schedule.weekdays?.length;
}

export type ScheduleState = RuleSchedule & { revision: number; next_due_at: string | null };
export interface WebhookMetadata {
  id: string;
  name: string;
  disabled: boolean;
}
export interface WebhookCreated {
  endpoint: WebhookMetadata;
  signing_secret: string;
}
export interface TargetDatabase {
  database_id: string;
  views: { view_id: string; name: string }[];
}
export interface TargetField {
  id: string;
  name: string;
  field_type_id?: number;
  type_option?: { content?: { options?: { id: string; name: string }[] } };
}

export interface RuleAction {
  type: string;
  field_id?: string;
  value?: PropertyValue;
  user_ids?: string[];
  person_field_ids?: string[];
  notify_actor?: boolean;
  message?: AutomationText;
  message_template?: AutomationText;
  subject?: AutomationText;
  database_id?: string;
  view_id?: string;
  row?: TargetRow;
  properties?: Assignment[];
  name?: string;
  recipient_id?: string;
  to?: EmailRecipient[];
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  sender_name?: AutomationText;
  reply_to?: EmailRecipient;
  connection_id?: string;
  channel_id?: string;
  endpoint_id?: string;
  property_ids?: string[];
}

export interface RuleDefinition {
  name: string;
  enabled: boolean;
  trigger: RuleTrigger;
  actions: RuleAction[];
  conditions: unknown[];
  timezone: string;
}

export interface DatabaseRule extends RuleDefinition {
  id: string;
  revision: number;
  status: string;
  disabled_reason?: string;
  owner_uid?: string | number;
}

export interface RuleRun {
  id: string;
  row_id?: string;
  status: string;
  reason?: string;
  attempts: number;
  notified_count: number;
  event_observed_at: string;
}

type RunPage = { items: RuleRun[]; next_cursor?: number };
const databasePath = (workspace: string, database: string) =>
  `/api/workspace/${encodeURIComponent(workspace)}/database/${encodeURIComponent(database)}`;
const rowPath = (workspace: string, database: string, row: string) =>
  `${databasePath(workspace, database)}/row/${encodeURIComponent(row)}`;
const path = (workspace: string, database: string, row?: string) =>
  `${row ? rowPath(workspace, database, row) : databasePath(workspace, database)}/automation`;
const item = (workspace: string, database: string, id: string, row?: string) =>
  `${path(workspace, database, row)}/${encodeURIComponent(id)}`;
const buttonPath = (w: string, d: string, row: string, field: string) =>
  `${rowPath(w, d, row)}/button/${encodeURIComponent(field)}`;

export type ButtonConnector = { action_index: number; kind: 'gmail' | 'slack' | 'webhook' };
export type ButtonBinding = {
  automation_id: string;
  revision: number;
  enabled: boolean;
  connectors: ButtonConnector[];
  confirmation?: string;
  has_open_target?: boolean;
  presentation_digest?: string;
};
export type ButtonInvocation = {
  presentation_digest?: string;
  automation_id: string;
  expected_revision: number;
  request_id: string;
  connections: { action_index: number; connection_id: string }[];
};

/** Keep the owning member's i64 exact when old browsers parse an unquoted JSON integer. */
export function parseRuleList(data: unknown): unknown {
  if (typeof data !== 'string' || !data.trim()) return data;
  // Consume whole JSON strings so escaped quotes in names or template text remain intact.
  const tokens = /"(?:\\.|[^"\\])*"(?:\s*:\s*-?\d+(?=\s*[,}]))?/g;

  return JSON.parse(data.replace(tokens, (token) => token.replace(/^("owner_uid"\s*:\s*)(-?\d+)$/, '$1"$2"')));
}

export const ruleApi = {
  list: (w: string, d: string, signal?: AbortSignal, row?: string) =>
    executeAPIRequest<{ items: DatabaseRule[] }>(() =>
      getAxios()?.get(path(w, d, row), { signal, transformResponse: [parseRuleList] })
    ),
  get: (w: string, d: string, id: string, signal?: AbortSignal, row?: string) =>
    executeAPIRequest<DatabaseRule>(() => getAxios()?.get(item(w, d, id, row), { signal })),
  create: (w: string, d: string, id: string, draft: RuleDefinition, row?: string) =>
    executeAPIRequest<DatabaseRule>(() => getAxios()?.post(path(w, d, row), { id, ...draft })),
  patch: (w: string, d: string, id: string, revision: number, changes: Partial<RuleDefinition>, row?: string) =>
    executeAPIRequest<DatabaseRule>(() =>
      getAxios()?.patch(item(w, d, id, row), { expected_revision: revision, ...changes })
    ),
  remove: (w: string, d: string, id: string, revision: number, row?: string) =>
    executeAPIVoidRequest(() => getAxios()?.delete(item(w, d, id, row), { params: { expected_revision: revision } })),
  resolveButton: (w: string, d: string, row: string, field: string, signal?: AbortSignal) =>
    executeAPIRequest<ButtonBinding>(() => getAxios()?.get(buttonPath(w, d, row, field), { signal })),
  buttonResult: (w: string, d: string, row: string, field: string, request: string, signal?: AbortSignal) =>
    executeAPIRequest<{ status: string; target?: unknown }>(() =>
      getAxios()?.get(buttonPath(w, d, row, field) + '/run/' + encodeURIComponent(request), { signal })
    ),
  invokeButton: (w: string, d: string, row: string, field: string, body: ButtonInvocation) =>
    executeAPIRequest<string>(() => getAxios()?.post(buttonPath(w, d, row, field) + '/run', body)),
  run: (w: string, d: string, id: string, revision: number, row_id: string, request_id: string, row?: string) =>
    executeAPIRequest<string>(() =>
      getAxios()?.post(item(w, d, id, row) + '/run', { row_id, request_id, expected_revision: revision })
    ),
  getSchedule: (w: string, d: string, id: string, signal?: AbortSignal, row?: string) =>
    executeAPIRequest<ScheduleState>(() => getAxios()?.get(item(w, d, id, row) + '/schedule', { signal })),
  putSchedule: (
    w: string,
    d: string,
    id: string,
    revision: number,
    schedule: RuleSchedule & { replace_custom_recurrence?: true },
    row?: string
  ) =>
    executeAPIRequest<ScheduleState>(() =>
      getAxios()?.put(item(w, d, id, row) + '/schedule', { expected_revision: revision, ...schedule })
    ),
  databases: (w: string, offset: number, signal?: AbortSignal) =>
    executeAPIRequest<{ databases: TargetDatabase[]; has_more: boolean }>(() =>
      getAxios()?.get('/api/workspace/' + encodeURIComponent(w) + '/database', { params: { offset, limit: 50 }, signal })
    ),
  fields: (w: string, d: string, signal?: AbortSignal) =>
    executeAPIRequest<TargetField[]>(() =>
      getAxios()?.get('/api/workspace/' + encodeURIComponent(w) + '/database/' + encodeURIComponent(d) + '/fields', {
        signal,
      })
    ),
  createWebhook: (w: string, name: string, url: string, headers?: Record<string, string>) =>
    executeAPIRequest<WebhookCreated>(
      () =>
        getAxios()?.post('/api/workspace/' + encodeURIComponent(w) + '/automation-webhooks', {
          name,
          url,
          ...(headers && { headers }),
        }),
      { suppressResponseDataLogging: true }
    ),
  rotateWebhook: (w: string, id: string) =>
    executeAPIRequest<WebhookCreated>(
      () =>
        getAxios()?.post(
          '/api/workspace/' + encodeURIComponent(w) + '/automation-webhooks/' + encodeURIComponent(id) + '/rotate'
        ),
      { suppressResponseDataLogging: true }
    ),
  removeWebhook: (w: string, id: string) =>
    executeAPIVoidRequest(() =>
      getAxios()?.delete('/api/workspace/' + encodeURIComponent(w) + '/automation-webhooks/' + encodeURIComponent(id))
    ),
  webhooks: (w: string, after?: string, signal?: AbortSignal) =>
    executeAPIRequest<{ items: { id: string; name: string; disabled: boolean }[]; next_cursor?: string }>(() =>
      getAxios()?.get('/api/workspace/' + encodeURIComponent(w) + '/automation-webhooks', { params: { after }, signal })
    ),
  runs: (
    w: string,
    d: string,
    id: string,
    before?: number,
    signal?: AbortSignal,
    includeDatabase = false,
    row?: string
  ) =>
    executeAPIRequest<RunPage>(() =>
      getAxios()?.get<APIResponse<RunPage>>(`${item(w, d, id, row)}/runs`, {
        params: { before, limit: 25, ...(includeDatabase ? { include_database_runs: true } : {}) },
        signal,
      })
    ),
};

export function isRuleConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 1008) return false;
  const message =
    'diagnosticMessage' in error ? error.diagnosticMessage : 'message' in error ? error.message : undefined;

  return typeof message === 'string' && message.startsWith('Invalid request:automation_revision_conflict:');
}
