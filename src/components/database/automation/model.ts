import { validate as isUuid } from 'uuid';

import { FieldType } from '@/application/database-yjs';
import { isMemberRecipient } from '@/application/services/js-services/http/automation-api';
import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import type {
  AutomationText,
  EmailRecipient,
  Formula,
  PropertyValue,
  RuleAction,
  RuleDefinition,
  RuleTrigger,
  TextPart,
} from '@/application/services/js-services/http/automation-api';

import { propertyOperand, validPropertyEvent } from './property-trigger';

export const triggerTypes = [
  'row_created',
  'row_updated',
  'row_deleted',
  'row_created_or_updated',
  'status_set_to',
  'row_events',
  'manual',
  'scheduled',
  'button',
];
export const actionTypes = [
  'notify',
  'set_property',
  'create_row',
  'edit_row',
  'define_variable',
  'email',
  'connected_email',
  'addressed_email',
  'member_addressed_email',
  'slack',
  'webhook',
  'webhook_properties',
];
const propertyKinds = ['text', 'number', 'checkbox', 'date_time', 'event_time', 'single_select', 'multi_select'];

export function ruleCapabilities(info?: ServerInfo) {
  const triggers = triggerTypes.filter(
    (type) =>
      info?.database_automation_triggers?.includes(type) &&
      (type !== 'button' || info.database_automation_scope_features?.includes('row_scoped_v1'))
  );
  const actions = actionTypes.filter(
    (type) =>
      info?.database_automation_actions?.includes(type) &&
      (type !== 'webhook_properties' || info?.database_automation_webhook_features?.includes('selected_properties_v1'))
  );

  return {
    enabled: info?.enable_database_automations === true && triggers.length > 0 && actions.length > 0,
    triggers,
    actions,
    webhookHeaders: info?.database_automation_webhook_features?.includes('headers_v1') === true,
    formulaExpression: info?.database_automation_value_features?.includes('formula_expression_v1') === true,
    propertyEdited: info?.database_automation_trigger_features?.includes('property_edited_v1') === true,
    customRecurrence: info?.database_automation_schedule_features?.includes('custom_recurrence_v1') === true,
  };
}

export type Capabilities = ReturnType<typeof ruleCapabilities>;
export type RuleField = { id: string; name: string; type: FieldType };

export function valueKinds(type?: FieldType): string[] {
  switch (type) {
    case FieldType.RichText:
      return ['text'];
    case FieldType.Number:
      return ['number'];
    case FieldType.Checkbox:
      return ['checkbox'];
    case FieldType.DateTime:
      return ['event_time', 'date_time'];
    case FieldType.SingleSelect:
      return ['single_select'];
    case FieldType.Person:
      return ['person'];
    case FieldType.Relation:
      return ['relation'];
    case FieldType.MultiSelect:
      return ['multi_select'];
    default:
      return [];
  }
}

export function relationVariables(actions: RuleAction[], fields: RuleField[]) {
  const names = new Set<string>();

  for (const { type, name, value } of actions) {
    if (type !== 'define_variable' || !name || !value) continue;
    const relation =
      (value.kind === 'relation' && (value.operation ?? 'replace') === 'replace') ||
      (value.kind === 'field' && fields.some((f) => f.id === value.field_id && f.type === FieldType.Relation)) ||
      (value.kind === 'variable' && !!value.name && names.has(value.name));

    if (relation) names.add(name);
  }

  return [...names];
}

export function newAction(type: string): RuleAction {
  switch (type) {
    case 'notify':
      return { type, notify_actor: true };
    case 'set_property':
      return { type, field_id: '', value: { kind: 'text', value: '' } };
    case 'create_row':
      return { type, database_id: '', view_id: '', properties: [] };
    case 'edit_row':
      return { type, database_id: '', row: { type: 'trigger' }, properties: [] };
    case 'define_variable':
      return { type, name: '', value: { kind: 'text', value: '' } };
    case 'email':
      return { type, recipient_id: '', subject: '', message: '' };
    case 'member_addressed_email':
      return { type, connection_id: '', to: [{ type: 'address', value: '' }], subject: '', message: '' };
    case 'addressed_email':
    case 'connected_email':
      return { type, connection_id: '', to: [''], subject: '', message: '' };
    case 'webhook_properties':
      return { type, endpoint_id: '', property_ids: [], message: '' };
    case 'slack':
      return { type, connection_id: '', channel_id: '', message: '' };
    default:
      return { type, endpoint_id: '', message: '' };
  }
}

export function newRule(caps: Capabilities): RuleDefinition {
  return {
    name: '',
    enabled: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    conditions: [],
    trigger: { type: caps.triggers[0] },
    actions: [newAction(caps.actions[0])],
  };
}

const knownKeys = (obj: object, keys: string[]) => Object.keys(obj).every((key) => keys.includes(key));

function supportedTrigger(trigger: RuleTrigger, caps: Capabilities): boolean {
  if (!caps.triggers.includes(trigger.type)) return false;
  if (trigger.type === 'row_events')
    return (
      knownKeys(trigger, ['type', 'match', 'triggers', 'view_id']) &&
      Array.isArray(trigger.triggers) &&
      trigger.triggers.length > 0 &&
      trigger.triggers.every(
        (child) =>
          !!child &&
          typeof child === 'object' &&
          (child.type === 'property_edited'
            ? caps.propertyEdited &&
              knownKeys(child, ['type', 'field_id', 'ty', 'condition', 'content']) &&
              !!propertyOperand(child.ty, child.condition) &&
              typeof child.content === 'string'
            : !['row_events', 'manual', 'scheduled', 'button'].includes(child.type) && supportedTrigger(child, caps))
      )
    );
  if (trigger.type === 'button') return knownKeys(trigger, ['type', 'field_id']) && typeof trigger.field_id === 'string';
  const keys =
    trigger.type === 'status_set_to'
      ? ['type', 'field_id', 'option_id']
      : ['row_updated', 'row_created_or_updated'].includes(trigger.type)
      ? ['type', 'field_ids']
      : ['type'];

  return knownKeys(trigger, keys);
}

function knownText(text?: AutomationText): boolean {
  if (text === undefined || typeof text === 'string') return true;
  return (
    !!text &&
    knownKeys(text, ['parts']) &&
    Array.isArray(text.parts) &&
    text.parts.every((p) => {
      if (!p || typeof p !== 'object') return false;
      switch (p.type) {
        case 'text':
          return knownKeys(p, ['type', 'value']);
        case 'field':
          return knownKeys(p, ['type', 'field_id']);
        case 'variable':
          return knownKeys(p, ['type', 'name']);
        case 'step_row_id':
          return knownKeys(p, ['type', 'action_index']);
        default:
          return false;
      }
    })
  );
}

export const arithmetic = ['add', 'subtract', 'multiply', 'divide', 'add_days'] as const;
export function formula(v?: PropertyValue): Formula | undefined {
  return v?.kind === 'formula' && v.value && typeof v.value === 'object' && 'operator' in v.value ? v.value : undefined;
}

function knownValue(v: PropertyValue | undefined, expressions: boolean): boolean {
  if (!v) return false;
  if (v.kind === 'expression')
    return expressions && knownKeys(v, ['kind', 'expression']) && typeof v.expression === 'string';
  if (v.kind === 'formula') {
    const f = formula(v);

    return (
      !!f &&
      knownKeys(v, ['kind', 'value']) &&
      knownKeys(f, ['operator', 'left', 'right']) &&
      arithmetic.includes(f.operator) &&
      knownValue(f.left, expressions) &&
      knownValue(f.right, expressions)
    );
  }

  if (v.kind === 'multi_select_delta')
    return (
      knownKeys(v, ['kind', 'value', 'operation']) &&
      (v.operation === 'add' || v.operation === 'remove') &&
      Array.isArray(v.value)
    );

  if (['person', 'relation'].includes(v.kind))
    return (
      knownKeys(v, ['kind', 'value', 'operation']) && ['replace', 'add', 'remove'].includes(v.operation || 'replace')
    );
  if (v.kind === 'field') return knownKeys(v, ['kind', 'field_id']);
  if (v.kind === 'variable') return knownKeys(v, ['kind', 'name']);
  if (v.kind === 'template') return knownKeys(v, ['kind', 'parts']) && knownText({ parts: v.parts || [] });
  return propertyKinds.includes(v.kind) && knownKeys(v, v.kind === 'event_time' ? ['kind'] : ['kind', 'value']);
}

function supportedAction(a: RuleAction, caps: Capabilities) {
  if (!caps.actions.includes(a.type)) return false;
  const keys: Record<string, string[]> = {
    notify: ['message', 'message_template', 'user_ids', 'person_field_ids', 'notify_actor'],
    set_property: ['field_id', 'value'],
    define_variable: ['name', 'value'],
    create_row: ['database_id', 'view_id', 'properties'],
    edit_row: ['database_id', 'row', 'properties'],
    email: ['recipient_id', 'subject', 'message'],
    member_addressed_email: ['connection_id', 'to', 'cc', 'bcc', 'reply_to', 'sender_name', 'subject', 'message'],
    addressed_email: ['connection_id', 'to', 'cc', 'bcc', 'reply_to', 'sender_name', 'subject', 'message'],
    connected_email: ['connection_id', 'to', 'subject', 'message'],
    slack: ['connection_id', 'channel_id', 'message'],
    webhook: ['endpoint_id', 'message'],
    webhook_properties: ['endpoint_id', 'message', 'property_ids'],
  };
  const recipient = (v: EmailRecipient) => {
    if (a.type !== 'member_addressed_email') return !isMemberRecipient(v) && knownText(v);
    if (!isMemberRecipient(v)) return false;
    switch (v.type) {
      case 'address':
        return knownKeys(v, ['type', 'value']) && v.value !== undefined && knownText(v.value);
      case 'actor':
        return knownKeys(v, ['type']);
      case 'workspace_user':
        return knownKeys(v, ['type', 'user_id']) && typeof v.user_id === 'string';
      case 'person_field':
        return knownKeys(v, ['type', 'field_id']) && typeof v.field_id === 'string';
      default:
        return false;
    }
  };

  const row = a.row;
  const rowKeys =
    row &&
    {
      id: ['type', 'row_id'],
      step: ['type', 'action_index'],
      trigger: ['type'],
      matching: ['type', 'conditions'],
      variable: ['type', 'name'],
    }[row.type];

  return (
    !!keys[a.type] &&
    knownKeys(a, ['type', ...keys[a.type]]) &&
    (!a.value || knownValue(a.value, caps.formulaExpression)) &&
    (!row || (!!rowKeys && knownKeys(row, rowKeys))) &&
    (row?.type !== 'variable' ||
      (caps.actions.includes('define_variable') && typeof row.name === 'string' && !!row.name)) &&
    (a.type !== 'notify' || a.message === undefined || typeof a.message === 'string') &&
    (a.value === undefined ||
      !['template', 'field', 'variable', 'formula', 'person', 'relation', 'multi_select_delta'].includes(a.value.kind) ||
      caps.actions.includes('define_variable')) &&
    (a.message_template === undefined ||
      (caps.actions.includes('define_variable') && a.message === undefined && knownText(a.message_template))) &&
    knownText(a.message) &&
    knownText(a.subject) &&
    [a.to, a.cc, a.bcc].every((group) => group === undefined || (Array.isArray(group) && group.every(recipient))) &&
    (a.reply_to === undefined || recipient(a.reply_to)) &&
    knownText(a.sender_name) &&
    (!a.properties ||
      a.properties.every(
        (p) =>
          knownKeys(p, ['field_id', 'value']) &&
          knownValue(p.value, caps.formulaExpression) &&
          (p.value.kind !== 'multi_select_delta' || caps.actions.includes('define_variable'))
      ))
  );
}

export function canEditRule(rule: RuleDefinition, caps: Capabilities) {
  return supportedTrigger(rule.trigger, caps) && rule.actions.every((action) => supportedAction(action, caps));
}

export const isRecipientField = (field: RuleField) =>
  [FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy].includes(field.type);

export function needsRecipientRow(a: RuleAction) {
  return (
    a.type === 'member_addressed_email' &&
    [...(a.to || []), ...(a.cc || []), ...(a.bcc || []), a.reply_to].some(
      (v) => v && isMemberRecipient(v) && v.type === 'person_field'
    )
  );
}

export function validRule(rule: RuleDefinition, fields: RuleField[] = [], calendarHasRow = false) {
  if (
    rule.trigger.type === 'button' &&
    !fields.some((f) => f.type === FieldType.Button && f.id === rule.trigger.field_id)
  )
    return false;
  if (!rule.name.trim() || !rule.timezone.trim() || rule.actions.length < 1 || rule.actions.length > 5) return false;
  const validEvent = (tr: RuleTrigger) =>
    tr.type === 'property_edited'
      ? validPropertyEvent(tr) && fields.some((f) => f.id === tr.field_id && f.type === tr.ty)
      : tr.type !== 'status_set_to' || (!!tr.field_id && !!tr.option_id);

  if (
    rule.trigger.type === 'property_edited' ||
    !validEvent(rule.trigger) ||
    (rule.trigger.type === 'row_events' && (!rule.trigger.triggers?.length || !rule.trigger.triggers.every(validEvent)))
  )
    return false;
  if (
    rule.trigger.type === 'row_deleted' &&
    (rule.conditions.length || rule.actions.some((a) => a.type === 'set_property' || a.person_field_ids?.length))
  )
    return false;
  const deletesRow =
    rule.trigger.type === 'row_deleted' || rule.trigger.triggers?.some((trigger) => trigger.type === 'row_deleted');

  return rule.actions.every((a, index) => {
    const previous = rule.actions.slice(0, index);
    const created = (i: number) => previous[i]?.type === 'create_row';
    const named = (name?: string) => !!name && previous.some((p) => p.type === 'define_variable' && p.name === name);
    const parts = (v?: TextPart[]) =>
      !!v &&
      v.length <= 128 &&
      v.every((p) => {
        switch (p.type) {
          case 'field':
            return !!p.field_id;
          case 'variable':
            return named(p.name);
          case 'step_row_id':
            return created(p.action_index);
          case 'text':
            return !p.value.includes('\0');
        }
      });
    const resolved = (v?: PropertyValue): boolean =>
      !!v && validValue(v) && (v.kind !== 'variable' || named(v.name)) && (v.kind !== 'template' || parts(v.parts));

    if (a.row?.type === 'variable' && !relationVariables(previous, fields).includes(a.row.name)) return false;
    if (a.row?.type === 'step' && !created(a.row.action_index)) return false;
    const text = (v?: AutomationText) => (typeof v === 'string' ? !!v.trim() : !!v?.parts.length && parts(v.parts));

    switch (a.type) {
      case 'notify':
        return (
          Boolean(a.notify_actor || a.user_ids?.length || a.person_field_ids?.length) &&
          (a.message_template === undefined || text(a.message_template)) &&
          (typeof a.message !== 'string' || a.message.length <= 500)
        );
      case 'member_addressed_email':
      case 'addressed_email': {
        const groups = [a.to ?? [], a.cc ?? [], a.bcc ?? []];
        const addresses = groups.flat();
        const recipient = (v: EmailRecipient) => {
          if (a.type !== 'member_addressed_email') return !isMemberRecipient(v) && text(v);
          if (!isMemberRecipient(v)) return false;
          switch (v.type) {
            case 'address':
              return text(v.value);
            case 'actor':
              return rule.trigger.type !== 'scheduled';
            case 'workspace_user':
              return isUuid(v.user_id);
            case 'person_field':
              return (
                !deletesRow &&
                (rule.trigger.type !== 'scheduled' || calendarHasRow) &&
                fields.some((f) => f.id === v.field_id && isRecipientField(f))
              );
            default:
              return false;
          }
        };

        return (
          !!a.connection_id &&
          addresses.length > 0 &&
          addresses.length <= 10 &&
          addresses.every(recipient) &&
          (a.sender_name === undefined || text(a.sender_name)) &&
          (a.reply_to === undefined || recipient(a.reply_to)) &&
          text(a.subject) &&
          text(a.message)
        );
      }

      case 'connected_email':
        return (
          !!a.connection_id &&
          !!a.to?.length &&
          a.to.length <= 10 &&
          a.to.every((v) => !isMemberRecipient(v) && text(v)) &&
          text(a.subject) &&
          text(a.message)
        );
      case 'email':
        return !!a.recipient_id && text(a.subject) && text(a.message);
      case 'webhook_properties':
        return (
          !deletesRow &&
          !!a.endpoint_id &&
          text(a.message) &&
          !!a.property_ids?.length &&
          a.property_ids.length <= 32 &&
          a.property_ids.every(Boolean) &&
          new Set(a.property_ids).size === a.property_ids.length
        );
      case 'webhook':
        return !!a.endpoint_id && text(a.message);
      case 'slack':
        return !!a.connection_id && !!a.channel_id && text(a.message);
      case 'define_variable':
        return !!a.name && /^[a-zA-Z0-9_]{1,64}$/.test(a.name) && !named(a.name) && resolved(a.value);
      case 'create_row':
      case 'edit_row':
        return (
          !!a.database_id &&
          (a.type === 'create_row' ? !!a.view_id : !!a.row && (a.row.type !== 'id' || !!a.row.row_id)) &&
          (a.properties?.every((p) => !!p.field_id && resolved(p.value)) ?? false) &&
          (a.type !== 'edit_row' || !!a.properties?.length)
        );
      default:
        return !!a.field_id && resolved(a.value);
    }
  });
}

export function validValue(v?: PropertyValue): boolean {
  if (!v) return false;
  switch (v.kind) {
    case 'expression':
      return (
        typeof v.expression === 'string' &&
        !!v.expression.trim() &&
        !v.expression.includes('\0') &&
        new Blob([v.expression]).size <= 4096
      );
    case 'formula': {
      const f = formula(v);

      return !!f && arithmetic.includes(f.operator) && validValue(f.left) && validValue(f.right);
    }

    case 'event_time':
      return true;
    case 'date_time':
      return typeof v.value === 'string' && Number.isFinite(Date.parse(v.value));
    case 'multi_select_delta':
      return (
        (v.operation === 'add' || v.operation === 'remove') &&
        Array.isArray(v.value) &&
        v.value.length > 0 &&
        v.value.length <= 128 &&
        new Set(v.value).size === v.value.length &&
        v.value.every((id) => typeof id === 'string' && !!id)
      );
    case 'person':
    case 'relation':
      return Array.isArray(v.value) && (v.operation === undefined || ['replace', 'remove', 'add'].includes(v.operation));
    case 'single_select':
      return !!v.value;
    case 'number':
      return typeof v.value === 'number' && Number.isFinite(v.value);
    case 'field':
      return !!v.field_id;
    case 'variable':
      return !!v.name;
    case 'template':
      return !!v.parts?.length;
    default:
      return v.value !== undefined;
  }
}

/** Keep references attached to the same create action when the author moves or removes a step. */
export function reorderActions(original: RuleAction[], ordered: RuleAction[]): RuleAction[] {
  const index = (old: number) => ordered.indexOf(original[old]);
  const parts = (value: TextPart[]) =>
    value.map((p) => (p.type === 'step_row_id' ? { ...p, action_index: index(p.action_index) } : p));
  const text = (value: AutomationText) => (typeof value === 'string' ? value : { parts: parts(value.parts) });
  const recipient = (v: EmailRecipient): EmailRecipient =>
    isMemberRecipient(v) ? (v.type === 'address' ? { ...v, value: text(v.value) } : v) : text(v);
  const property = (value: PropertyValue): PropertyValue =>
    formula(value)
      ? {
          ...value,
          value: { ...formula(value)!, left: property(formula(value)!.left), right: property(formula(value)!.right) },
        }
      : value.kind === 'template' && value.parts
      ? { ...value, parts: parts(value.parts) }
      : value;

  return ordered.map((action) => ({
    ...action,
    ...(action.row?.type === 'step'
      ? { row: { type: 'step' as const, action_index: index(action.row.action_index) } }
      : {}),
    ...(action.value ? { value: property(action.value) } : {}),
    ...(action.properties ? { properties: action.properties.map((p) => ({ ...p, value: property(p.value) })) } : {}),
    ...(action.subject ? { subject: text(action.subject) } : {}),
    ...(action.to ? { to: action.to.map(recipient) } : {}),
    ...(action.cc ? { cc: action.cc.map(recipient) } : {}),
    ...(action.bcc ? { bcc: action.bcc.map(recipient) } : {}),
    ...(action.reply_to ? { reply_to: recipient(action.reply_to) } : {}),
    ...(action.sender_name ? { sender_name: text(action.sender_name) } : {}),
    ...(action.message ? { message: text(action.message) } : {}),
    ...(action.message_template ? { message_template: text(action.message_template) } : {}),
  }));
}

/** Preserve every untouched server field, including filters and values from newer clients. */
export function ruleChanges(base: RuleDefinition, draft: RuleDefinition): Partial<RuleDefinition> {
  const changes: Partial<RuleDefinition> = {};
  const keys = ['name', 'enabled', 'timezone', 'conditions', 'trigger', 'actions'] as const;

  for (const key of keys) {
    if (JSON.stringify(base[key]) !== JSON.stringify(draft[key])) Object.assign(changes, { [key]: draft[key] });
  }

  return changes;
}
