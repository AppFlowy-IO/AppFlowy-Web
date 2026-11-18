import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import strings from '@/@types/translations/en.json';
import { FieldType } from '@/application/database-yjs';
import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import { DatabaseRule, ruleApi, RuleAction } from '@/application/services/js-services/http/automation-api';
import { listConnections } from '@/application/services/js-services/http/integration-api';

import { RuleManager } from '../AutomationEditor';
import {
  actionTypes,
  canEditRule,
  relationVariables,
  reorderActions,
  ruleCapabilities,
  ruleChanges,
  triggerTypes,
  validRule,
  valueKinds,
} from '../model';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, args: Record<string, unknown> = {}) => {
      const translation =
        key
          .split('.')
          .reduce<unknown>(
            (value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined),
            strings
          ) ||
        args.defaultValue ||
        key;

      return String(translation).replace(/{{(\w+)}}/g, (_, name) => String(args[name]));
    },
    i18n: { language: 'en-US@posix' },
  }),
}));
jest.mock('@/application/database-yjs', () => ({
  FieldType: {
    RichText: 0,
    Number: 1,
    DateTime: 2,
    SingleSelect: 3,
    MultiSelect: 4,
    Checkbox: 5,
    Relation: 10,
    Person: 16,
    CreatedBy: 17,
    LastEditedBy: 18,
  },
  useDatabaseFields: () => undefined,
  useDatabaseContext: () => ({ databasePageId: 'page' }),
  useDatabaseViewsSelector: () => ({ viewIds: ['board'], childViews: [{ get: () => 'Work board' }] }),
  usePropertiesSelector: () => ({
    properties: [
      { id: 'state', name: 'Status', type: 3 },
      { id: 'labels', name: 'Labels', type: 4 },
      { id: 'stamp', name: 'Completed', type: 2 },
      { id: 'assignee', name: 'Assignee', type: 16 },
      { id: 'subtasks', name: 'Subtasks', type: 10 },
    ],
  }),
  useRowOrdersSelector: () => [{ id: 'e5e8c286-c7c7-4c44-8e15-12f6e4987004' }],
  useSelectFieldOptions: () => [{ id: 'done', name: 'Done' }],
  useDatabaseView: () => ({ get: () => ({ toJSON: () => [] }) }),
}));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => {
  const fetchUsers = jest.fn();

  return { useMentionableUsers: () => ({ users: [{ person_id: 'person-id', name: 'Avery' }], fetchUsers }) };
});
jest.mock('@/application/services/js-services/http/integration-api', () => ({
  listConnections: jest.fn(),
  queryIntegration: jest.fn(),
  confirmConnection: jest.fn(),
}));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useServerInfoState: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({ useUserWorkspaceInfoOptional: jest.fn() }));
jest.mock('@/application/services/js-services/http/automation-api', () => ({
  ...jest.requireActual('@/application/services/js-services/http/automation-api'),
  ruleApi: {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    patch: jest.fn(),
    remove: jest.fn(),
    runs: jest.fn(),
    run: jest.fn(),
    getSchedule: jest.fn(),
    putSchedule: jest.fn(),
    databases: jest.fn(),
    fields: jest.fn(),
    webhooks: jest.fn(),
  },
}));
const api = ruleApi as jest.Mocked<typeof ruleApi>;
const caps = ruleCapabilities({
  enable_database_automations: true,
  database_automation_triggers: ['row_created', 'status_set_to'],
  database_automation_actions: ['notify', 'set_property'],
} as ServerInfo);
const rule: DatabaseRule = {
  id: 'rule',
  name: 'Existing',
  revision: 5,
  enabled: true,
  status: 'active',
  trigger: { type: 'row_created' },
  actions: [{ type: 'notify', notify_actor: true }],
  conditions: [],
  timezone: 'UTC',
};

beforeEach(() => {
  jest.resetAllMocks();
  api.list.mockResolvedValue({ items: [rule] });
  api.get.mockResolvedValue(rule);
});
const manager = () => render(<RuleManager workspace='w' database='d' caps={caps} />);

test('hides unsupported capabilities and protects future definitions; all supported field types have editors', () => {
  expect(ruleCapabilities().enabled).toBe(false);
  expect(ruleCapabilities({ enable_database_automations: true } as ServerInfo).enabled).toBe(false);
  expect(canEditRule({ ...rule, actions: [{ type: 'new_action' }] }, caps)).toBe(false);
  expect(canEditRule({ ...rule, trigger: Object.assign({}, rule.trigger, { future: true }) }, caps)).toBe(false);
  expect(ruleChanges(rule, { ...rule, name: 'Renamed' })).toEqual({ name: 'Renamed' });
  expect(valueKinds(FieldType.DateTime)).toEqual(['event_time', 'date_time']);
  expect(
    [FieldType.RichText, FieldType.Number, FieldType.Checkbox, FieldType.SingleSelect, FieldType.MultiSelect].map(
      (t) => valueKinds(t)[0]
    )
  ).toEqual(['text', 'number', 'checkbox', 'single_select', 'multi_select']);
  expect(validRule({ ...rule, trigger: { type: 'status_set_to' } })).toBe(false);
});
test('retries a create with the same id and authors a status rule with a date action', async () => {
  api.create.mockRejectedValueOnce(new Error('connection')).mockResolvedValueOnce(rule);
  manager();
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Record completion' } });
  fireEvent.change(screen.getByLabelText('When'), { target: { value: 'status_set_to' } });
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'state' } });
  fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'done' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'set_property' } });
  fireEvent.change(screen.getAllByLabelText('Property')[1], { target: { value: 'stamp' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
  expect(api.create.mock.calls[0]).toEqual(api.create.mock.calls[1]);
  expect(api.create.mock.calls[0][3]).toMatchObject({
    name: 'Record completion',
    trigger: { type: 'status_set_to', field_id: 'state', option_id: 'done' },
    actions: [{ type: 'set_property', field_id: 'stamp', value: { kind: 'event_time' } }],
  });
});
test('conflicts retain unsaved edits until explicit reload and preserve unknown fields on patch', async () => {
  const future = { ...rule, actions: [{ type: 'future' }] };

  api.get.mockResolvedValueOnce(future).mockResolvedValueOnce({ ...future, name: 'Other author', revision: 6 });
  api.patch.mockRejectedValue({ code: 1008, diagnosticMessage: 'Invalid request:automation_revision_conflict:rule:6' });
  manager();
  fireEvent.click(await screen.findByText('Existing'));
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'My draft' } });
  expect(screen.queryByLabelText('When')).toBeNull();
  fireEvent.click(screen.getByText('Save'));
  await screen.findByRole('alert');
  expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, { name: 'My draft' });
  expect(screen.getByLabelText('Name').value).toBe('My draft');
  fireEvent.click(screen.getByText('Reload saved version'));
  await screen.findByDisplayValue('Other author');
});
test('pages run history under a POSIX locale using its cursor and deletes with the current revision after confirmation', async () => {
  const result = {
    id: 'a',
    row_id: 'r',
    status: 'succeeded',
    attempts: 1,
    notified_count: 1,
    event_observed_at: '2026-01-15T08:00:00Z',
  };

  api.runs
    .mockResolvedValueOnce({ items: [result], next_cursor: 42 })
    .mockResolvedValueOnce({ items: [{ ...result, id: 'b', status: 'skipped' }] });
  manager();
  fireEvent.click(await screen.findByText('Run history'));
  fireEvent.click(await screen.findByText('Load more'));
  await screen.findByText(/Skipped/);
  expect(api.runs.mock.calls[1].slice(0, 4)).toEqual(['w', 'd', 'rule', 42]);
  fireEvent.click(screen.getByText('Back'));
  fireEvent.click(screen.getByText('Existing'));
  fireEvent.click(await screen.findByText('Delete'));
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Delete'));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith('w', 'd', 'rule', 5));
});

const extended = { enabled: true, triggers: triggerTypes, actions: actionTypes, customRecurrence: false };
const fullManager = () => render(<RuleManager workspace='w' database='d' caps={extended} />);
const row = 'e5e8c286-c7c7-4c44-8e15-12f6e4987004';

test('manual invocation retries ambiguous requests with the same key and revision', async () => {
  api.list.mockResolvedValue({ items: [{ ...rule, trigger: { type: 'manual' } }] });
  api.run.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('the-run');
  fullManager();
  fireEvent.click(await screen.findByText('Run now'));
  fireEvent.change(screen.getByLabelText('Row ID'), { target: { value: row } });
  fireEvent.click(screen.getByText('Run now'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Run now'));
  await screen.findByText('Run queued.');
  expect(api.run.mock.calls[0]).toEqual(['w', 'd', 'rule', 5, row, expect.any(String)]);
  expect(api.run.mock.calls[1]).toEqual(api.run.mock.calls[0]);
});

test('a calendar loads its current revision and saves local wall time, frequency and timezone', async () => {
  const scheduled = { ...rule, trigger: { type: 'scheduled' } };
  const base = {
    row_id: row,
    revision: 7,
    local_time: '09:00:00',
    starts_on: '2026-03-01',
    ends_on: '2027-03-01',
    timezone: 'Europe/Paris',
    frequency: 'monthly' as const,
    next_due_at: null,
  };

  api.list.mockResolvedValue({ items: [scheduled] });
  api.get.mockResolvedValue(scheduled);
  api.getSchedule.mockResolvedValue(base);
  api.putSchedule.mockResolvedValue({ ...base, revision: 8 });
  fullManager();
  fireEvent.click(await screen.findByText('Schedule'));
  await screen.findByDisplayValue('Europe/Paris');
  expect(screen.queryByLabelText('Repeat interval')).toBeNull();
  fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });
  fireEvent.change(screen.getByLabelText('Local time'), { target: { value: '10:30' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.putSchedule).toHaveBeenCalledWith('w', 'd', 'rule', 7, {
      row_id: row,
      frequency: 'weekly',
      starts_on: '2026-03-01',
      ends_on: '2027-03-01',
      local_time: '10:30:00',
      timezone: 'Europe/Paris',
    })
  );
});

test('custom calendars keep their anchor and selected ISO weekdays and clear weekdays on a yearly switch', async () => {
  const scheduled = { ...rule, trigger: { type: 'scheduled' } };
  const base = {
    revision: 7,
    starts_on: '2026-11-18',
    local_time: '09:00:00',
    timezone: 'Europe/Paris',
    frequency: 'weekly' as const,
    interval: 2,
    weekdays: [1, 5],
    next_due_at: null,
  };
  api.list.mockResolvedValue({ items: [scheduled] });
  api.get.mockResolvedValue(scheduled);
  api.getSchedule.mockResolvedValue(base);
  api.putSchedule.mockResolvedValue(base);
  render(<RuleManager workspace='w' database='d' caps={{ ...extended, customRecurrence: true }} />);
  fireEvent.click(await screen.findByText('Schedule'));
  await waitFor(() => expect((screen.getByLabelText('Repeat interval') as HTMLInputElement).value).toBe('2'));
  expect(Array.from((screen.getByLabelText('Weekdays') as HTMLSelectElement).selectedOptions, o => o.value)).toEqual(['1', '5']);
  fireEvent.change(screen.getByLabelText('Repeat interval'), { target: { value: '1000' } });
  expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Repeat interval'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'yearly' } });
  expect(screen.queryByLabelText('Weekdays')).toBeNull();
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.putSchedule).toHaveBeenCalledWith(
      'w',
      'd',
      'rule',
      7,
      expect.objectContaining({ frequency: 'yearly', interval: 3, starts_on: '2026-11-18', weekdays: undefined })
    )
  );
});

test('the first calendar can be saved after the API returns record not found', async () => {
  const scheduled = { ...rule, trigger: { type: 'scheduled' } };

  api.list.mockResolvedValue({ items: [scheduled] });
  api.get.mockResolvedValue(scheduled);
  api.getSchedule.mockRejectedValue({ code: -2 });
  api.putSchedule.mockResolvedValue({
    revision: 6,
    frequency: 'daily',
    starts_on: '2026-12-01',
    local_time: '09:00:00',
    timezone: 'UTC',
    next_due_at: null,
  });
  fullManager();
  fireEvent.click(await screen.findByText('Schedule'));
  await waitFor(() => expect(screen.getByLabelText('Row ID (optional)').closest('fieldset')?.disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-12-01' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.putSchedule).toHaveBeenCalledWith(
      'w',
      'd',
      'rule',
      5,
      expect.objectContaining({ row_id: undefined, starts_on: '2026-12-01', frequency: 'daily', timezone: 'UTC' })
    )
  );
});

test('edits earlier variables and destination fields without changing a step result or a template', async () => {
  const actions: RuleAction[] = [
    { type: 'define_variable', name: 'label', value: { kind: 'text', value: 'before' } },
    {
      type: 'create_row',
      database_id: 'target',
      view_id: 'view',
      properties: [{ field_id: 'title', value: { kind: 'variable', name: 'label' } }],
    },
    {
      type: 'edit_row',
      database_id: 'target',
      row: { type: 'step', action_index: 1 },
      properties: [
        {
          field_id: 'title',
          value: {
            kind: 'template',
            parts: [
              { type: 'text', value: 'Updated ' },
              { type: 'step_row_id', action_index: 1 },
            ],
          },
        },
      ],
    },
    {
      type: 'email',
      recipient_id: 'person-id',
      subject: 'Updated',
      message: { parts: [{ type: 'variable', name: 'label' }] },
    },
  ];
  const saved = { ...rule, actions };

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.databases.mockResolvedValue({
    databases: [{ database_id: 'target', views: [{ view_id: 'view', name: 'Tasks' }] }],
    has_more: false,
  });
  api.fields.mockResolvedValue([{ id: 'title', name: 'Title', field_type_id: 0 }]);
  api.patch.mockResolvedValue(saved);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  await screen.findByDisplayValue('before');
  fireEvent.change(screen.getByDisplayValue('before'), { target: { value: 'after' } });
  await screen.findAllByDisplayValue('Title');
  expect(screen.getByDisplayValue('Avery')).toBeTruthy();
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
      actions: [{ ...actions[0], value: { kind: 'text', value: 'after' } }, ...actions.slice(1)],
    })
  );
  const reordered = reorderActions(actions, [actions[1], actions[0], actions[2], actions[3]]);

  expect(reordered[2].row).toEqual({ type: 'step', action_index: 0 });
  expect(reordered[2].properties?.[0].value.parts?.[1]).toEqual({ type: 'step_row_id', action_index: 0 });
  expect(validRule({ ...saved, actions: reordered })).toBe(false);
});

test('webhook selector follows the authorized pages, excludes disabled endpoints, and saves the identifier', async () => {
  api.create.mockResolvedValue(rule);
  api.webhooks
    .mockResolvedValueOnce({ items: [{ id: 'retired', name: 'Old endpoint', disabled: true }], next_cursor: 'cursor' })
    .mockResolvedValueOnce({ items: [{ id: 'approved', name: 'Inventory', disabled: false }] });
  fullManager();
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Send status' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'webhook' } });
  const dropdown = screen.getByLabelText('Webhook endpoint');

  await within(dropdown).findByText('Inventory');
  expect(within(dropdown).queryByText('Old endpoint')).toBeNull();
  fireEvent.change(dropdown, { target: { value: 'approved' } });
  fireEvent.change(screen.getByLabelText('Notification message'), { target: { value: 'Done' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.create.mock.calls[0][3].actions).toEqual([{ type: 'webhook', endpoint_id: 'approved', message: 'Done' }])
  );
});

test('authors multiple row triggers in a view without losing their field identities', async () => {
  api.create.mockResolvedValue(rule);
  fullManager();
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Board events' } });
  fireEvent.change(screen.getByLabelText('When'), { target: { value: 'row_events' } });
  fireEvent.change(screen.getByLabelText('View'), { target: { value: 'board' } });
  fireEvent.change(screen.getByLabelText('Match'), { target: { value: 'all' } });
  fireEvent.change(screen.getAllByLabelText('When')[1], { target: { value: 'row_updated' } });
  fireEvent.click(screen.getByText('Add trigger'));
  fireEvent.change(screen.getAllByLabelText('When')[2], { target: { value: 'status_set_to' } });
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'state' } });
  fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'done' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.create.mock.calls[0][3].trigger).toEqual({
      type: 'row_events',
      match: 'all',
      view_id: 'board',
      triggers: [{ type: 'row_updated' }, { type: 'status_set_to', field_id: 'state', option_id: 'done' }],
    })
  );
});

test('authors a matching-row numerical assignment from a checked expression and retains its filter group', async () => {
  const destination = '35f36cb3-7d0a-48a1-9211-92ecc4de6005';
  const saved = {
    ...rule,
    actions: [
      {
        type: 'edit_row',
        database_id: destination,
        row: { type: 'matching' as const, conditions: [] },
        properties: [{ field_id: 'count', value: { kind: 'number', value: 1 } }],
      },
    ],
  };

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.patch.mockResolvedValue(saved);
  api.databases.mockResolvedValue({
    databases: [{ database_id: destination, views: [{ view_id: 'tasks', name: 'Tasks' }] }],
    has_more: false,
  });
  api.fields.mockResolvedValue([
    { id: 'title', name: 'Title', field_type_id: 0 },
    { id: 'count', name: 'Count', field_type_id: 1 },
  ]);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  await screen.findByDisplayValue('Count');
  fireEvent.change(screen.getByLabelText('Condition property'), { target: { value: 'title' } });
  fireEvent.click(screen.getByText('Add group'));
  fireEvent.change(screen.getAllByLabelText('Value')[0], { target: { value: 'Ready' } });
  fireEvent.change(screen.getByLabelText('Value source'), { target: { value: 'formula' } });
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'multiply' } });
  const first = within(screen.getByRole('group', { name: 'First value' }));
  const second = within(screen.getByRole('group', { name: 'Second value' }));

  fireEvent.change(first.getByLabelText('Value'), { target: { value: '3' } });
  fireEvent.change(second.getByLabelText('Value'), { target: { value: '4' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.patch).toHaveBeenCalled());
  expect(api.patch.mock.calls[0][4].actions).toMatchObject([
    {
      type: 'edit_row',
      row: {
        type: 'matching',
        conditions: [{ filter_type: 1, children: [{ field_id: 'title', condition: 0, content: 'Ready' }] }],
      },
      properties: [
        {
          field_id: 'count',
          value: {
            kind: 'formula',
            value: { operator: 'multiply', left: { kind: 'number', value: 3 }, right: { kind: 'number', value: 4 } },
          },
        },
      ],
    },
  ]);
});

test('the Gmail action stores a selected sender and templated or literal external recipient', async () => {
  (listConnections as jest.MockedFunction<typeof listConnections>).mockResolvedValue([
    { id: 'mail', provider: 'gmail', connected_at: '2026-01-01', status: 'active', account_identifier: 'Work Gmail' },
    {
      id: 'slack',
      provider: 'slack',
      connected_at: '2026-01-01',
      status: 'active',
      account_identifier: 'Slack account',
    },
  ]);
  api.create.mockResolvedValue(rule);
  fullManager();
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Customer update' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'connected_email' } });
  await within(screen.getByLabelText('Gmail account')).findByText('Work Gmail');
  expect(within(screen.getByLabelText('Gmail account')).queryByText('Slack account')).toBeNull();
  fireEvent.change(screen.getByLabelText('Gmail account'), { target: { value: 'mail' } });
  fireEvent.change(screen.getByLabelText('Recipient address'), { target: { value: 'reviewer@example.test' } });
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Update' } });
  fireEvent.change(screen.getByLabelText('Notification message'), { target: { value: 'Ready' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  expect(api.create.mock.calls[0][3].actions).toEqual([
    {
      type: 'connected_email',
      connection_id: 'mail',
      to: ['reviewer@example.test'],
      subject: 'Update',
      message: 'Ready',
    },
  ]);
});

test('a person assignment uses a member UUID and explicitly adds to the existing value', async () => {
  api.create.mockResolvedValue(rule);
  fullManager();
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Add reviewer' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'set_property' } });
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'assignee' } });
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'add' } });
  const member = within(screen.getByLabelText('Workspace members')).getByText('Avery');

  member.selected = true;
  fireEvent.change(screen.getByLabelText('Workspace members'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  expect(api.create.mock.calls[0][3].actions).toEqual([
    { type: 'set_property', field_id: 'assignee', value: { kind: 'person', operation: 'add', value: ['person-id'] } },
  ]);
});

test('composes an in-app notification from a row field and preserves compatibility with literal notifications', async () => {
  api.create.mockResolvedValue(rule);
  fullManager();
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Notify with row title' } });
  fireEvent.click(screen.getByText(strings.databaseAutomation.template));
  fireEvent.change(screen.getByLabelText(strings.databaseAutomation.source), { target: { value: 'field' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  const saved = api.create.mock.calls[0][3];
  const notification = saved.actions[0];

  expect(notification).toEqual({
    type: 'notify',
    notify_actor: true,
    message_template: { parts: [{ type: 'field', field_id: expect.any(String) }] },
  });
  expect(canEditRule(saved, caps)).toBe(false);
  expect(
    canEditRule({ ...saved, actions: [{ type: 'notify', notify_actor: true, message: 'Old message' }] }, caps)
  ).toBe(true);
});

test('multi-select delta uses stable IDs and older servers retain the original replacement shape', async () => {
  api.create.mockResolvedValue(rule);
  fullManager();
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Add tag' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'set_property' } });
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'labels' } });
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'add' } });
  const option = within(screen.getByLabelText('Option')).getByText('Done');

  option.selected = true;
  fireEvent.change(screen.getByLabelText('Option'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  const saved = api.create.mock.calls[0][3];

  expect(saved.actions).toEqual([
    {
      type: 'set_property',
      field_id: 'labels',
      value: { kind: 'multi_select_delta', operation: 'add', value: ['done'] },
    },
  ]);
  expect(canEditRule(saved, caps)).toBe(false);
  expect(canEditRule(saved, extended)).toBe(true);
  expect(
    canEditRule(
      { ...saved, actions: [{ type: 'set_property', field_id: 'labels', value: { kind: 'multi_select', value: [] } }] },
      caps
    )
  ).toBe(true);
});

test('edits a saved cross-database selection delta without changing its target or option IDs', async () => {
  const actions: RuleAction[] = [
    {
      type: 'edit_row',
      database_id: 'target',
      row: { type: 'trigger' },
      properties: [
        {
          field_id: 'tags',
          value: { kind: 'multi_select_delta', operation: 'remove', value: ['one'] },
        },
      ],
    },
  ];
  const stored = { ...rule, actions };

  api.list.mockResolvedValue({ items: [stored] });
  api.get.mockResolvedValue(stored);
  api.patch.mockResolvedValue({ ...stored, revision: 6 });
  api.databases.mockResolvedValue({
    has_more: false,
    databases: [{ database_id: 'target', views: [{ view_id: 'v', name: 'Tasks' }] }],
  });
  api.fields.mockResolvedValue([
    { id: 'tags', name: 'Tags', field_type_id: 4, type_option: { content: { options: [{ id: 'one', name: 'One' }] } } },
  ]);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  expect((await screen.findByLabelText('Operation')).value).toBe('remove');
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'replace' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.patch).toHaveBeenCalled());
  expect(api.patch.mock.calls[0][4].actions?.[0]).toEqual({
    ...actions[0],
    properties: [{ field_id: 'tags', value: { kind: 'multi_select', value: ['one'] } }],
  });
});

test('selects an earlier relation variable, saves the stable name and reopens it', async () => {
  const source: RuleAction = {
    type: 'define_variable',
    name: 'children',
    value: { kind: 'field', field_id: 'subtasks' },
  };
  const alias: RuleAction = { type: 'define_variable', name: 'members', value: { kind: 'variable', name: 'children' } };
  const scalar: RuleAction = { type: 'define_variable', name: 'count', value: { kind: 'number', value: 2 } };
  const edit: RuleAction = {
    type: 'edit_row',
    database_id: 'dst',
    row: { type: 'trigger' },
    properties: [{ field_id: 'title', value: { kind: 'text', value: 'Reviewed' } }],
  };
  const stored = { ...rule, actions: [source, scalar, alias, edit] };
  const changed = { ...edit, row: { type: 'variable' as const, name: 'members' } };
  const saved = { ...stored, revision: 5, actions: [source, scalar, alias, changed] };

  api.list.mockResolvedValue({ items: [stored] });
  api.get.mockResolvedValueOnce(stored).mockResolvedValue(saved);
  api.patch.mockResolvedValue(saved);
  api.databases.mockResolvedValue({
    has_more: false,
    databases: [{ database_id: 'dst', views: [{ view_id: 'v', name: 'Tasks' }] }],
  });
  api.fields.mockResolvedValue([{ id: 'title', name: 'Title', field_type_id: 0 }]);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  fireEvent.change(await screen.findByLabelText('Target row'), { target: { value: 'variable' } });
  const select = screen.getAllByLabelText('Variable name').find((field) => field.tagName === 'SELECT')!;

  expect(Array.from(select.options, (o) => o.value).filter(Boolean)).toEqual(['children', 'members']);
  fireEvent.change(select, { target: { value: 'members' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.patch).toHaveBeenCalled());
  expect(api.patch.mock.calls[0][4].actions).toEqual(saved.actions);
  fireEvent.click(await screen.findByText('Existing'));
  expect((await screen.findByLabelText('Target row')).value).toBe('variable');
  expect(screen.getAllByLabelText('Variable name').find((field) => field.tagName === 'SELECT')?.value).toBe('members');
  const fields = [{ id: 'subtasks', name: 'Subtasks', type: FieldType.Relation }];

  expect(validRule(saved, fields)).toBe(true);
  expect(validRule({ ...saved, actions: [source, changed, alias] }, fields)).toBe(false);
  expect(validRule({ ...saved, actions: [scalar, { ...edit, row: { type: 'variable', name: 'count' } }] }, fields)).toBe(
    false
  );
  expect(
    relationVariables(
      [{ type: 'define_variable', name: 'rows', value: { kind: 'relation', value: [] } }, source, scalar, alias],
      fields
    )
  ).toEqual(['rows', 'children', 'members']);
  expect(
    canEditRule(
      { ...saved, actions: [{ ...changed, row: { type: 'variable', name: 'members', future: true } as never }] },
      extended
    )
  ).toBe(false);
});
