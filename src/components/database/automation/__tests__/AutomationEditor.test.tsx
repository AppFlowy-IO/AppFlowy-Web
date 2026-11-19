import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import strings from '@/@types/translations/en.json';
import { readButtonOpenTarget, readButtonResultTarget, validButtonUrl } from '@/application/automation/button';
import { FieldType, useDatabaseContextOptional, useFieldSelector } from '@/application/database-yjs';
import { useUpdateButtonTypeOption } from '@/application/database-yjs/dispatch';
import { authorizeIntegration } from '@/application/integrations/oauth';
import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import {
  type DatabaseRule,
  type AutomationText,
  type TextPart,
  parseRuleList,
  type PropertyValue,
  ruleApi,
  type RuleAction,
  type ScheduleState,
  type TargetRow,
} from '@/application/services/js-services/http/automation-api';
import { confirmConnection, listConnections } from '@/application/services/js-services/http/integration-api';
import { getWorkspaceGroups, searchMentions } from '@/application/services/js-services/http/workspace-api';
import { Role, type YDatabaseField } from '@/application/types';
import { useUserWorkspaceInfoOptional } from '@/components/app/app.hooks';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getServerInfoSnapshot } from '@/utils/server-info';

import AutomationButton from '../AutomationButton';
import { RuleManager } from '../AutomationEditor';
import { ButtonCell } from '../ButtonCell';
import { ButtonControl } from '../ButtonControl';
import { ButtonDefaults } from '../ButtonDefaults';
import { ButtonResult } from '../ButtonResult';
import {
  actionTypes,
  canEditRule,
  relationVariables,
  reorderActions,
  ruleCapabilities,
  ruleChanges,
  scheduleRequiresSourceRow,
  triggerTypes,
  validRule,
  valueKinds,
  workflowVariableChoices,
} from '../model';
import { validPropertyEvent } from '../property-trigger';
import { RichActionContext } from '../RichActionText';
import { selectAssignmentsFit } from '../select-variable';
import { TextFields } from '../TextFields';
import { SourceValue } from '../WorkflowFields';

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
    Person: 15,
    URL: 6,
    CreatedBy: 17,
    LastEditedBy: 18,
    Button: 20,
    Formula: 19,
  },
  useFieldSelector: jest.fn(),
  useDatabaseFields: () => undefined,
  useDatabaseContextOptional: jest.fn(),
  useDatabase: () => ({ get: () => 'd' }),
  useDatabaseContext: () => ({ workspaceId: 'w', databasePageId: 'page' }),
  useDatabaseViewsSelector: () => ({ viewIds: ['board'], childViews: [{ get: () => 'Work board' }] }),
  usePropertiesSelector: () => ({
    properties: [
      { id: 'send', name: 'Request review', type: 20 },
      { id: 'state', name: 'Status', type: 3 },
      { id: 'labels', name: 'Labels', type: 4 },
      { id: 'stamp', name: 'Completed', type: 2 },
      { id: 'assignee', name: 'Assignee', type: 15 },
      { id: 'subtasks', name: 'Subtasks', type: 10 },
      { id: 'title', name: 'Task title', type: 0 },
    ],
  }),
  useRowOrdersSelector: () => [{ id: 'e5e8c286-c7c7-4c44-8e15-12f6e4987004' }],
  useSelectFieldOptions: () => [{ id: 'done', name: 'Done' }],
  useDatabaseView: () => ({ get: () => ({ toJSON: () => [] }) }),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateButtonTypeOption: jest.fn() }));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => {
  const fetchUsers = jest.fn();

  return {
    useMentionableUsers: () => ({
      users: [
        { person_id: 'person-id', name: 'Avery' },
        { person_id: '825119c1-c9e1-4bcd-b54c-b31ba43ee9de', name: 'Morgan' },
      ],
      fetchUsers,
    }),
  };
});
jest.mock('@/application/services/js-services/http/workspace-api', () => ({
  ...jest.requireActual('@/application/services/js-services/http/workspace-api'),
  getWorkspaceGroups: jest.fn(),
  searchMentions: jest.fn(),
}));
jest.mock('@/application/integrations/oauth', () => ({ authorizeIntegration: jest.fn() }));
jest.mock('@/application/services/js-services/http/integration-api', () => ({
  listConnections: jest.fn(),
  queryIntegration: jest.fn(),
  confirmConnection: jest.fn(),
}));
jest.mock('@/utils/server-info', () => ({
  getServerInfoSnapshot: jest.fn(),
  subscribeToServerInfo: () => () => undefined,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: jest.fn() }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useServerInfoState: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({ useUserWorkspaceInfoOptional: jest.fn() }));
jest.mock('@/application/services/js-services/http/automation-api', () => ({
  ...jest.requireActual('@/application/services/js-services/http/automation-api'),
  ruleApi: {
    list: jest.fn(),
    resolveButton: jest.fn(),
    buttonResult: jest.fn(),
    invokeButton: jest.fn(),
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
    createWebhook: jest.fn(),
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
test('refreshes a pending row rule with the same row authorization scope', async () => {
  api.list.mockResolvedValueOnce({ items: [{ ...rule, status: 'setting_up' }] });
  render(<RuleManager workspace='w' database='d' caps={caps} rowScope='row' />);
  expect(await screen.findByText('Setting up')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Check setup status' }));
  expect(await screen.findByText('Active')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Check setup status' })).toBeNull();
  expect(api.list.mock.calls.map(([workspace, database, , row]) => [workspace, database, row])).toEqual([
    ['w', 'd', 'row'],
    ['w', 'd', 'row'],
  ]);
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

const extended = {
  rowScoped: false,
  buttonInteractions: false,
  enabled: true,
  triggers: triggerTypes,
  actions: actionTypes,
  propertyEdited: false,
  formulaExpression: false,
  customRecurrence: false,
  webhookHeaders: false,
};
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

test('a row menu runs only enabled manual rules owned by the current member and binds retries to the open row', async () => {
  const owner = '9007199254740993';
  const raw = JSON.stringify({
    items: [
      { ...rule, name: 'Own "owner_uid":123', owner_uid: 'OWNER', trigger: { type: 'manual' } },
      { ...rule, id: 'other', name: 'Other member', owner_uid: 'OTHER', trigger: { type: 'manual' } },
      { ...rule, id: 'disabled', name: 'Paused', owner_uid: 'OWNER', enabled: false, trigger: { type: 'manual' } },
      { ...rule, id: 'scheduled', name: 'Automatic', owner_uid: 'OWNER', trigger: { type: 'scheduled' } },
    ],
  })
    .replace(/"OWNER"/g, owner)
    .replace(/"OTHER"/g, '9007199254740992');

  api.list.mockResolvedValue(parseRuleList(raw) as { items: DatabaseRule[] });
  api.run.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('run');
  jest
    .mocked(useCurrentUserOptional)
    .mockReturnValue({ attributionUid: owner } as ReturnType<typeof useCurrentUserOptional>);
  jest
    .mocked(useUserWorkspaceInfoOptional)
    .mockReturnValue({ workspaces: [{ id: 'w', role: Role.Member }] } as ReturnType<
      typeof useUserWorkspaceInfoOptional
    >);
  const info = {
    status: 'ready',
    info: {
      enable_database_automations: true,
      database_automation_triggers: ['manual'],
      database_automation_actions: ['notify'],
    },
  } as ReturnType<typeof getServerInfoSnapshot>;

  jest.mocked(getServerInfoSnapshot).mockReturnValue(info);
  const prepare = jest.fn().mockResolvedValue(true);

  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <AutomationButton rowId={row} prepare={prepare} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const item = await screen.findByRole('menuitem', { name: 'Run now' });

  await act(async () => {
    fireEvent.click(item);
  });
  const available = await screen.findByRole('button', { name: 'Own "owner_uid":123' }, { timeout: 5000 });

  expect(screen.queryByText('Other member')).toBeNull();
  expect(screen.queryByText('Paused')).toBeNull();
  expect(screen.queryByText('Automatic')).toBeNull();
  expect(screen.queryByText('New automation')).toBeNull();
  expect(prepare).toHaveBeenCalledTimes(1);
  fireEvent.click(available);
  const rowInput = screen.getByLabelText('Row ID');

  expect(rowInput.readOnly).toBe(true);
  expect(rowInput.value).toEqual(row);
  fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
  await screen.findByText('Run queued.');
  expect(api.run.mock.calls[0]).toEqual(['w', 'd', 'rule', 5, row, expect.any(String)]);
  expect(api.run.mock.calls[1]).toEqual(api.run.mock.calls[0]);
});

test.each([true, false])('a guest opens only the exact row where the server grants setup (%p)', async (allowed) => {
  jest
    .mocked(useCurrentUserOptional)
    .mockReturnValue({ uuid: 'guest', attributionUid: '5' } as ReturnType<typeof useCurrentUserOptional>);
  jest
    .mocked(useUserWorkspaceInfoOptional)
    .mockReturnValue({ workspaces: [{ id: 'w', role: Role.Guest }] } as ReturnType<typeof useUserWorkspaceInfoOptional>);
  jest.mocked(getServerInfoSnapshot).mockReturnValue({
    status: 'ready',
    info: {
      enable_database_automations: true,
      database_automation_triggers: ['row_created', 'manual'],
      database_automation_actions: ['notify'],
      database_automation_scope_features: ['row_scoped_v1'],
    },
  } as ReturnType<typeof getServerInfoSnapshot>);
  const mine = { ...rule, trigger: { type: 'manual' }, owner_uid: '5' };
  const shared = { ...mine, id: 'other', name: 'Other owner', owner_uid: '6' };

  api.list.mockImplementation(async (_workspace, _database, _signal, target) => {
    if (target === row && allowed) return { items: [mine, shared] };
    throw Error('Row access denied');
  });
  api.get.mockResolvedValue(mine);
  render(<AutomationButton rowId={row} standaloneRow />);
  await waitFor(() => expect(api.list).toHaveBeenCalledWith('w', 'd', expect.anything(), row));
  if (!allowed) {
    expect(screen.queryByText('Automations for this row')).toBeNull();
    expect(screen.queryByText('New automation')).toBeNull();
    return;
  }

  fireEvent.click(await screen.findByRole('button', { name: 'Automations for this row' }));
  await screen.findByText('Other owner');
  expect(screen.getAllByRole('button', { name: 'Run now' })).toHaveLength(1);
  fireEvent.click(screen.getByText('Existing'));
  await screen.findByLabelText('Name');
  expect(api.get).toHaveBeenCalledWith('w', 'd', 'rule', expect.anything(), row);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'For this row' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, { name: 'For this row' }, row));
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Scoped creation' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledWith(
      'w',
      'd',
      expect.any(String),
      expect.objectContaining({ name: 'Scoped creation' }),
      row
    )
  );
  fireEvent.click(await screen.findByText('Existing'));
  fireEvent.click(await screen.findByText('Delete'));
  fireEvent.click(screen.getByText('Delete'));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith('w', 'd', 'rule', 5, row));
  expect(api.list.mock.calls.every((args) => args[3] === row)).toBe(true);
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
  api.get.mockResolvedValue({ ...scheduled, revision: base.revision });
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

test.each([false, true])(
  'only a capable editor can replace an existing custom calendar with a simple one (%s)',
  async (customRecurrence) => {
    const scheduled = { ...rule, actions: [{ type: 'notify', user_ids: [row] }], trigger: { type: 'scheduled' } };
    const base = {
      revision: 6,
      frequency: 'weekly' as const,
      interval: 1,
      weekdays: [3],
      starts_on: '2026-11-18',
      local_time: '08:00:00',
      timezone: 'UTC',
      next_due_at: null,
    };

    api.list.mockResolvedValue({ items: [scheduled] });
    api.get.mockResolvedValue({ ...scheduled, revision: base.revision });
    api.getSchedule.mockResolvedValue(base);
    api.putSchedule.mockResolvedValue({ ...base, revision: 7 });
    render(<RuleManager workspace='w' database='d' caps={{ ...extended, customRecurrence }} />);
    fireEvent.click(await screen.findByText('Schedule'));
    if (!customRecurrence) {
      await screen.findByRole('alert');
      expect(screen.getByText('Save').disabled).toBe(true);
      expect(api.putSchedule).not.toHaveBeenCalled();
      return;
    }

    await screen.findByLabelText('Weekdays');
    await waitFor(() => expect(screen.getByLabelText('Repeat').value).toBe('weekly'));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'daily' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(api.putSchedule).toHaveBeenCalledWith(
        'w',
        'd',
        'rule',
        6,
        expect.objectContaining({ frequency: 'daily', interval: 1, replace_custom_recurrence: true })
      )
    );
  }
);

test.each([true, false])('calendar uses the fresh server row requirement (%s) through Save', async (required) => {
  const scheduled = {
    ...rule,
    trigger: { type: 'scheduled' },
    actions: [{ type: required ? 'create_row' : 'set_property' }],
  };
  const state: ScheduleState = {
    frequency: 'daily',
    local_time: '09:00:00',
    timezone: 'UTC',
    starts_on: '2026-11-18',
    revision: 6,
    next_due_at: null,
  };

  api.list.mockResolvedValue({ items: [{ ...scheduled, requires_source_row: !required }] });
  api.get.mockResolvedValue({ ...scheduled, revision: 6, requires_source_row: required });
  api.getSchedule.mockResolvedValue(state);
  api.putSchedule.mockResolvedValue(state);
  fullManager();
  fireEvent.click(await screen.findByText('Schedule'));
  await screen.findByDisplayValue(state.starts_on);
  const rowInput = screen.getByLabelText(required ? 'Row ID' : 'Row ID (optional)');

  expect(rowInput.required).toBe(required);
  if (required) {
    expect(screen.getByText('Save').disabled).toBe(true);
    fireEvent.submit(screen.getByText('Save').closest('form')!);
    expect(api.putSchedule).not.toHaveBeenCalled();
    fireEvent.change(rowInput, { target: { value: '00000000-0000-0000-0000-000000000000' } });
    expect(screen.getByText('Save').disabled).toBe(true);
    fireEvent.change(rowInput, { target: { value: row } });
  }

  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.putSchedule).toHaveBeenCalledWith(
      'w',
      'd',
      'rule',
      6,
      expect.objectContaining({ row_id: required ? row : undefined })
    )
  );
});

test('calendar reloads a concurrently edited rule before saving its new row requirement', async () => {
  const scheduled = { ...rule, trigger: { type: 'scheduled' }, requires_source_row: false };
  const state: ScheduleState = {
    frequency: 'daily',
    local_time: '09:00:00',
    timezone: 'UTC',
    starts_on: '2026-11-18',
    revision: 6,
    next_due_at: null,
  };

  api.list.mockResolvedValue({ items: [scheduled] });
  api.get.mockResolvedValueOnce(scheduled).mockResolvedValue({ ...scheduled, revision: 6, requires_source_row: true });
  api.getSchedule.mockResolvedValue(state);
  fullManager();
  fireEvent.click(await screen.findByText('Schedule'));
  fireEvent.click(await screen.findByText('Reload saved version'));
  await screen.findByDisplayValue(state.starts_on);
  expect(screen.getByLabelText('Row ID').required).toBe(true);
  expect(screen.getByText('Save').disabled).toBe(true);
  expect(api.putSchedule).not.toHaveBeenCalled();
});

test('older calendars distinguish source fields and row IDs from row-independent actions, filters and formulas', () => {
  const fieldText = { parts: [{ type: 'field' as const, field_id: 'title' }] };
  const check = (action: RuleAction, conditions: unknown[] = []) =>
    scheduleRequiresSourceRow({ ...rule, actions: [action], conditions, trigger: { type: 'scheduled' } });
  const define = (value: PropertyValue) => check({ type: 'define_variable', value });
  const literal = { kind: 'number', value: 1 };
  const nested = (value: PropertyValue): PropertyValue => ({
    kind: 'formula',
    value: { operator: 'add', left: literal, right: value },
  });

  expect(check({ type: 'create_row' }, [{}])).toBe(true);
  for (const action of [
    { type: 'set_property' },
    { type: 'webhook_properties' },
    { type: 'notify', notify_actor: true },
    { type: 'notify', person_field_ids: ['owner'] },
    { type: 'notify', message_template: fieldText },
    { type: 'edit_row', row: { type: 'trigger' as const } },
    { type: 'create_row', properties: [{ field_id: 'dest', value: nested({ kind: 'field', field_id: 'source' }) }] },
    { type: 'edit_row', properties: [{ field_id: 'dest', value: { kind: 'template', parts: fieldText.parts } }] },
    { type: 'webhook', message: fieldText },
    { type: 'slack', message: fieldText },
    { type: 'email', subject: fieldText },
    { type: 'connected_email', to: [fieldText] },
    { type: 'addressed_email', sender_name: fieldText },
    { type: 'addressed_email', bcc: [fieldText] },
    { type: 'member_addressed_email', reply_to: { type: 'person_field' as const, field_id: 'owner' } },
    { type: 'member_addressed_email', cc: [{ type: 'address' as const, value: fieldText }] },
  ])
    expect(check(action)).toBe(true);
  for (const expression of ['prop("title")', 'if(false, id(), "x")', 'bad(']) {
    expect(define(nested({ kind: 'expression', expression }))).toBe(true);
  }

  for (const expression of ['now()', '"prop() and id() are literals"', 'if(true, 1, 2)']) {
    expect(define(nested({ kind: 'expression', expression }))).toBe(false);
  }

  const targets: TargetRow[] = [
    { type: 'step', action_index: 0 },
    { type: 'id', row_id: row },
    { type: 'matching', conditions: [{}] },
  ];

  for (const target of targets) {
    expect(check({ type: 'edit_row', row: target, properties: [{ field_id: 'dest', value: literal }] })).toBe(false);
  }

  expect(check({ type: 'notify', user_ids: [row] })).toBe(false);
  expect(check({ type: 'future_action' })).toBe(true);
  expect(check({ type: 'member_addressed_email', to: [{ type: 'workspace_user', user_id: row }] })).toBe(false);
});

test('selected webhook properties require a live source row for triggers and schedules', async () => {
  const webhook = { type: 'webhook_properties', endpoint_id: 'ep', message: 'Info', property_ids: ['field'] };
  const scheduled = { ...rule, actions: [webhook], trigger: { type: 'scheduled' } };
  const calendar = {
    revision: 6,
    frequency: 'daily' as const,
    starts_on: '2026-11-18',
    local_time: '08:00:00',
    timezone: 'UTC',
    next_due_at: null,
  };

  expect(validRule({ ...scheduled, trigger: { type: 'row_deleted' } })).toBe(false);
  expect(
    validRule({
      ...scheduled,
      trigger: { type: 'row_events', match: 'any', triggers: [{ type: 'row_deleted' }, { type: 'row_created' }] },
    })
  ).toBe(false);
  expect(validRule({ ...scheduled, trigger: { type: 'manual' } })).toBe(true);
  api.list.mockResolvedValue({ items: [scheduled] });
  api.get.mockResolvedValue({ ...scheduled, revision: calendar.revision });
  api.getSchedule.mockResolvedValue(calendar);
  api.putSchedule.mockResolvedValue(calendar);
  fullManager();
  fireEvent.click(await screen.findByText('Schedule'));
  const input = await screen.findByLabelText('Row ID');

  await screen.findByDisplayValue(calendar.starts_on);
  expect(screen.getByText('Save').disabled).toBe(true);
  fireEvent.change(input, { target: { value: row } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.putSchedule).toHaveBeenCalledWith('w', 'd', 'rule', 6, expect.objectContaining({ row_id: row }))
  );
});

test('custom calendars keep their anchor and selected ISO weekdays and clear weekdays on a yearly switch', async () => {
  const scheduled = { ...rule, actions: [{ type: 'notify', user_ids: [row] }], trigger: { type: 'scheduled' } };
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
  api.get.mockResolvedValue({ ...scheduled, revision: base.revision });
  api.getSchedule.mockResolvedValue(base);
  api.putSchedule.mockResolvedValue(base);
  render(<RuleManager workspace='w' database='d' caps={{ ...extended, customRecurrence: true }} />);
  fireEvent.click(await screen.findByText('Schedule'));
  await waitFor(() => expect(screen.getByLabelText('Repeat interval').value).toBe('2'));
  expect(Array.from(screen.getByLabelText('Weekdays').selectedOptions, (o) => o.value)).toEqual(['1', '5']);
  fireEvent.change(screen.getByLabelText('Repeat interval'), { target: { value: '1000' } });
  expect(screen.getByText('Save').disabled).toBe(true);
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

test('duplicate retries the disabled scheduled copy under the same ID and never copies runtime or actor data', async () => {
  const original = { ...rule, trigger: { type: 'scheduled' } };
  const calendar = {
    revision: 5,
    frequency: 'weekly' as const,
    starts_on: '2026-11-18',
    local_time: '09:00:00',
    timezone: 'UTC',
    next_due_at: null,
  };

  api.list.mockResolvedValue({ items: [original] });
  api.get.mockResolvedValue(original);
  api.create.mockImplementation(async (_w, _d, id, data) => ({ ...rule, ...data, id, revision: 1 }));
  api.getSchedule.mockImplementation(async (_w, _d, id) => {
    if (id === original.id) return calendar;
    throw Object.assign(new Error('Missing schedule'), { code: -2 });
  });
  api.putSchedule.mockRejectedValueOnce(Error('network')).mockResolvedValue({ ...calendar, revision: 2 });
  fullManager();
  fireEvent.click(await screen.findByText('Duplicate'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Duplicate'));
  await waitFor(() => expect(api.putSchedule).toHaveBeenCalledTimes(2));
  const [[, , id, draft], [, , retryId, retryDraft]] = api.create.mock.calls;

  expect(id).toEqual(retryId);
  expect(id).not.toEqual(original.id);
  expect(retryDraft).toEqual(draft);
  expect(draft).toEqual({
    name: 'Copy of Existing',
    enabled: false,
    conditions: original.conditions,
    timezone: original.timezone,
    actions: original.actions,
    trigger: original.trigger,
  });
  expect(api.putSchedule.mock.calls[0]).toEqual([
    'w',
    'd',
    id,
    1,
    expect.objectContaining({ frequency: 'weekly', starts_on: '2026-11-18' }),
  ]);
  expect(api.putSchedule.mock.calls[1]).toEqual(api.putSchedule.mock.calls[0]);
});
test('the first calendar can be saved after the API returns record not found', async () => {
  const scheduled = { ...rule, actions: [{ type: 'notify', user_ids: [row] }], trigger: { type: 'scheduled' } };

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

test('webhook property actions store selected IDs and write-only headers stay with endpoint registration', async () => {
  const endpoint = { id: 'owned', name: 'Review webhook', disabled: false };

  api.webhooks.mockResolvedValue({ items: [endpoint] });
  api.createWebhook.mockResolvedValue({ endpoint, signing_secret: 'signing-key' });
  api.create.mockResolvedValue(rule);
  const info = {
    enable_database_automations: true,
    database_automation_triggers: ['row_created'],
    database_automation_actions: ['webhook', 'webhook_properties'],
  };

  expect(ruleCapabilities(info as ServerInfo).actions).toEqual(['webhook']);
  const server = ruleCapabilities({
    ...info,
    database_automation_webhook_features: ['headers_v1', 'selected_properties_v1'],
  } as ServerInfo);

  render(<RuleManager workspace='w' database='d' caps={server} />);
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Publish review' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'webhook_properties' } });
  fireEvent.click(screen.getByText('Register endpoint'));
  const names = screen.getAllByLabelText('Name');

  fireEvent.change(names[names.length - 1], { target: { value: 'Review webhook' } });
  fireEvent.change(screen.getByLabelText('HTTPS URL'), { target: { value: 'https://example.org/review' } });
  fireEvent.click(screen.getByText('Add header'));
  fireEvent.change(screen.getByLabelText('Header name'), { target: { value: 'Authorization' } });
  const header = screen.getByLabelText('Header value');

  expect(header.type).toBe('password');
  fireEvent.change(header, { target: { value: 'private-fixture' } });
  fireEvent.click(screen.getByText('Confirm'));
  await waitFor(() =>
    expect(api.createWebhook).toHaveBeenCalledWith('w', 'Review webhook', 'https://example.org/review', {
      Authorization: 'private-fixture',
    })
  );
  expect(screen.queryByDisplayValue('private-fixture')).toBeNull();
  const property = screen.getByLabelText('Webhook properties');

  property.options[0].selected = true;
  fireEvent.change(property);
  fireEvent.change(screen.getByLabelText('Notification message'), { target: { value: 'Status' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  expect(api.create.mock.calls[0][3].actions).toEqual([
    { type: 'webhook_properties', endpoint_id: 'owned', property_ids: ['state'], message: 'Status' },
  ]);
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

test('authoring a grouped property edit keeps the stable field ID, type, operator, and value when saved', async () => {
  const caps = { ...extended, propertyEdited: true };
  const trigger = {
    type: 'row_events',
    match: 'all' as const,
    triggers: [{ type: 'property_edited', field_id: 'title', ty: 0, condition: 4, content: 'Ship' }],
  };
  const stored = { ...rule, trigger };

  expect(canEditRule(stored, extended)).toBe(false);
  expect(canEditRule(stored, caps)).toBe(true);
  expect(canEditRule({ ...stored, trigger: { ...trigger, triggers: [null] as never } }, caps)).toBe(false);
  expect(canEditRule({ ...stored, trigger: { ...trigger, triggers: [] } }, caps)).toBe(false);
  expect(
    canEditRule({ ...stored, trigger: { ...trigger, triggers: [{ ...trigger.triggers[0], condition: 55 }] } }, caps)
  ).toBe(false);
  expect(canEditRule({ ...stored, trigger: trigger.triggers[0] }, caps)).toBe(false);
  api.list.mockResolvedValue({ items: [stored] });
  api.get.mockResolvedValue(stored);
  api.patch.mockResolvedValue({ ...stored, revision: 6 });
  render(<RuleManager workspace='w' database='d' caps={caps} />);
  fireEvent.click(await screen.findByText('Existing'));
  expect((await screen.findByLabelText('Value')).value).toBe('Ship');
  const when = screen.getAllByLabelText('When');

  expect(Array.from(when[0].options, (o) => o.value)).not.toContain('property_edited');
  expect(Array.from(when[1].options, (o) => o.value)).toContain('property_edited');
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'labels' } });
  const options = screen.getByLabelText('Value');

  options.options[0].selected = true;
  fireEvent.change(options);
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
      trigger: {
        ...trigger,
        triggers: [{ type: 'property_edited', field_id: 'labels', ty: 4, condition: 2, content: 'done' }],
      },
    })
  );
});

test('creates a property-trigger group from the toolbar and submits only after the operand is valid', async () => {
  api.create.mockResolvedValue(rule);
  render(<RuleManager workspace='w' database='d' caps={{ ...extended, propertyEdited: true }} />);
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ship notices' } });
  fireEvent.change(screen.getByLabelText('When'), { target: { value: 'row_events' } });
  fireEvent.change(screen.getAllByLabelText('When')[1], { target: { value: 'property_edited' } });
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'title' } });
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: '4' } });
  expect(screen.getByText('Save').disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Ship' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  expect(api.create.mock.calls[0][3].trigger).toEqual({
    type: 'row_events',
    match: 'any',
    triggers: [{ type: 'property_edited', field_id: 'title', ty: 0, condition: 4, content: 'Ship' }],
  });
});

test('validates property edits using filter operator arity, UTF-8 size, member or row identity, option bounds and finite numbers', () => {
  const valid = (ty: number, condition: number, content: string) =>
    validPropertyEvent({ type: 'property_edited', field_id: 'f', ty, condition, content });

  for (const [ty, op] of [
    [0, 4],
    [6, 2],
    [1, 5],
    [3, 0],
    [4, 2],
    [5, 0],
    [10, 2],
    [15, 1],
  ]) {
    const operand: Record<number, string> = {
      0: 'Ship',
      6: 'https',
      1: '-1.5e2',
      3: 'one',
      4: 'one,two',
      5: '',
      10: JSON.stringify([row]),
      15: JSON.stringify([row]),
    };

    expect(valid(ty, op, operand[ty])).toBe(true);
  }

  expect(valid(1, 0, '0x10')).toBe(false);
  expect(valid(1, 4, 'Infinity')).toBe(false);
  expect(valid(0, 4, '界'.repeat(1366))).toBe(false);
  expect(valid(4, 0, 'one')).toBe(false);
  expect(valid(3, 2, 'one')).toBe(false);
  expect(valid(4, 2, 'one,one')).toBe(false);
  expect(valid(4, 2, Array.from({ length: 33 }, (_, i) => String(i)).join(','))).toBe(false);
  expect(valid(10, 6, '')).toBe(false);
  expect(valid(10, 2, JSON.stringify(['not-a-row']))).toBe(false);
  expect(valid(15, 0, '[]')).toBe(false);
  expect(valid(15, 2, 'anything')).toBe(false);
  expect(valid(5, 1, '')).toBe(true);
  expect(
    ruleCapabilities({ database_automation_trigger_features: ['property_edited_v1'] } as ServerInfo).propertyEdited
  ).toBe(true);
  expect(ruleCapabilities().propertyEdited).toBe(false);
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

test('creates a formula assignment with a stable source property and preserves the selected text range', async () => {
  const caps = { ...extended, formulaExpression: true };

  api.create.mockResolvedValue(rule);
  render(<RuleManager workspace='w' database='d' caps={caps} />);
  fireEvent.click(await screen.findByText('New automation'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Label the task' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'set_property' } });
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'title' } });
  fireEvent.change(screen.getByLabelText('Value source'), { target: { value: 'expression' } });
  expect(screen.getByText('Save').disabled).toBe(true);
  const source = screen.getByLabelText('Formula expression');
  const chooser = screen.getByLabelText('Insert source property');

  expect(within(chooser).queryByText('Assignee')).toBeNull();
  fireEvent.change(source, { target: { value: 'upper(task)' } });
  source.setSelectionRange(6, 10);
  fireEvent.change(chooser, { target: { value: 'title' } });
  expect(source.value).toBe('upper(prop("title"))');
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.create.mock.calls[0][3].actions).toEqual([
      { type: 'set_property', field_id: 'title', value: { kind: 'expression', expression: 'upper(prop("title"))' } },
    ])
  );
});

test.each([false, true])(
  'formula variables preserve their date expression and respect scheduled row scope (bound=%s)',
  async (rowBound) => {
    const caps = { ...extended, formulaExpression: true };
    const action = { type: 'define_variable', name: 'year', value: { kind: 'expression', expression: 'year(now())' } };
    const saved = { ...rule, trigger: { type: 'scheduled' }, actions: [action] };

    expect(canEditRule(saved, extended)).toBe(false);
    expect(canEditRule(saved, caps)).toBe(true);
    expect(canEditRule({ ...saved, actions: [{ ...action, value: { ...action.value, options: true } }] }, caps)).toBe(
      false
    );
    api.getSchedule.mockResolvedValue({ row_id: rowBound ? row : undefined } as ScheduleState);
    api.list.mockResolvedValue({ items: [saved] });
    api.get.mockResolvedValue(saved);
    api.patch.mockResolvedValue({ ...saved, revision: 6 });
    render(<RuleManager workspace='w' database='d' caps={caps} />);
    fireEvent.click(await screen.findByText('Existing'));
    const input = await screen.findByLabelText('Formula expression');

    expect(input.value).toBe('year(now())');
    await waitFor(() => expect(api.getSchedule).toHaveBeenCalled());
    if (rowBound) expect(await screen.findByLabelText('Insert source property')).toBeTruthy();
    else expect(screen.queryByLabelText('Insert source property')).toBeNull();
    fireEvent.change(input, { target: { value: 'formatDate(now(), "YYYY")' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
        actions: [{ ...action, value: { kind: 'expression', expression: 'formatDate(now(), "YYYY")' } }],
      })
    );
  }
);

test('editing a row offers only the trigger database and rows created in the selected database', async () => {
  const create = (id: string): RuleAction => ({ type: 'create_row', database_id: id, view_id: 'v', properties: [] });
  const edit: RuleAction = {
    type: 'edit_row',
    database_id: 'd',
    row: { type: 'trigger' },
    properties: [{ field_id: 'title', value: { kind: 'text', value: 'Ready' } }],
  };
  const steps = [create('d'), create('dest'), create('d')];
  const saved = { ...rule, actions: [...steps, edit] };
  const dbs = ['d', 'dest', 'empty'].map((database_id) => ({
    database_id,
    views: [{ view_id: 'v', name: database_id }],
  }));

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.databases.mockResolvedValue({ databases: dbs, has_more: false });
  api.fields.mockResolvedValue([{ id: 'title', name: 'Title', field_type_id: 0 }]);
  api.patch.mockResolvedValue(saved);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  await screen.findByDisplayValue('Ready');
  const targetRow = screen.getByLabelText('Target row');
  const destination = screen.getAllByLabelText('Target database')[3];

  expect(targetRow.value).toBe('trigger');
  fireEvent.change(targetRow, { target: { value: 'step' } });
  const indices = () => Array.from(screen.getByLabelText('Row from action').options, (o) => o.value).filter(Boolean);

  expect(indices()).toEqual(['0', '2']);
  fireEvent.change(destination, { target: { value: 'empty' } });
  expect(within(targetRow).queryByText('Triggering row')).toBeNull();
  expect(targetRow.value).toBe('id');
  expect(screen.getByLabelText('Row ID').value).toBe('');
  expect(within(targetRow).queryByRole('option', { name: 'Row from an earlier action' })).toBeNull();
  fireEvent.change(destination, { target: { value: 'dest' } });
  expect(targetRow.value).toBe('step');
  expect(indices()).toEqual(['1']);
  fireEvent.click(screen.getAllByText('Add a property')[3]);
  await waitFor(() => expect(within(screen.getByLabelText('Property')).getByText('Title')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'title' } });
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Assigned' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
      actions: [...steps, expect.objectContaining({ database_id: 'dest', row: { type: 'step', action_index: 1 } })],
    })
  );
});

test('legacy mismatched row targets survive metadata changes and require repair for behavioral saves', async () => {
  const edit: RuleAction = {
    type: 'edit_row',
    database_id: 'dest',
    row: { type: 'trigger' },
    properties: [{ field_id: 'title', value: { kind: 'text', value: 'Before' } }],
  };
  const saved = { ...rule, actions: [edit] };

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.databases.mockResolvedValue({
    databases: [{ database_id: 'dest', views: [{ view_id: 'v', name: 'Tasks' }] }],
    has_more: false,
  });
  api.fields.mockResolvedValue([{ id: 'title', name: 'Title', field_type_id: 0 }]);
  api.patch.mockResolvedValue(saved);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  fireEvent.change(await screen.findByDisplayValue('Before'), { target: { value: 'After' } });
  expect(screen.getByText('Save').disabled).toBe(true);
  fireEvent.change(screen.getByDisplayValue('After'), { target: { value: 'Before' } });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New name' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, { name: 'New name' }));

  for (const [id, valid] of [
    ['', false],
    ['bad-id', false],
    ['ABCD0000-0000-0000-0000-000000000001', true],
    ['00000000-0000-0000-0000-000000000000', false],
    [row, true],
  ] as const) {
    expect(validRule({ ...saved, actions: [{ ...edit, row: { type: 'id', row_id: id } }] }, [], false, 'd')).toBe(valid);
  }

  const sameDb = { ...edit, database_id: 'd' };
  const triggerValid = (type: string, bound = false) =>
    validRule({ ...saved, trigger: { type }, actions: [sameDb] }, [], bound, 'd');

  expect(triggerValid('row_created')).toBe(true);
  expect(triggerValid('row_deleted')).toBe(false);
  expect(triggerValid('scheduled')).toBe(false);
  expect(triggerValid('scheduled', true)).toBe(true);
  expect(
    validRule(
      {
        ...saved,
        actions: [
          { type: 'create_row', database_id: 'd', view_id: 'v', properties: [] },
          { ...edit, row: { type: 'step', action_index: 0 } },
        ],
      },
      [],
      false,
      'd'
    )
  ).toBe(false);
});

test.each(['single_select', 'multi_select'])(
  'authors a %s constant from an explicitly selected remote property',
  async (kind) => {
    const multi = kind === 'multi_select';
    const definition = { type: 'define_variable', name: 'choice', value: { kind: 'text', value: 'before' } };
    const saved = { ...rule, trigger: { type: 'scheduled' }, actions: [definition] };
    const target = (id: string, type: number) => ({
      id,
      name: id,
      field_type_id: type,
      type_option: {
        content: {
          options: [
            { id: id + '-ready', name: 'Ready' },
            { id: id + '-done', name: 'Done' },
          ],
        },
      },
    });

    api.list.mockResolvedValue({ items: [saved] });
    api.get.mockResolvedValue(saved);
    api.getSchedule.mockRejectedValue({ code: -2 });
    api.databases.mockResolvedValue({
      has_more: false,
      databases: [{ database_id: 'dest', views: [{ view_id: 'v', name: 'Archive' }] }],
    });
    api.fields.mockResolvedValue([target('stage', 3), target('tags', 4), target('another', multi ? 4 : 3)]);
    api.patch.mockResolvedValue(saved);
    fullManager();
    fireEvent.click(await screen.findByText('Existing'));
    fireEvent.change(await screen.findByLabelText('Value source'), { target: { value: kind } });
    expect(screen.queryByLabelText('Option')).toBeNull();
    const database = screen.getByLabelText('Target database');

    await within(database).findByText('Archive');
    fireEvent.change(database, { target: { value: 'dest' } });
    const property = screen.getByLabelText('Property');
    const id = multi ? 'tags' : 'stage';

    await within(property).findByText(id);
    expect(within(property).queryByText(multi ? 'stage' : 'tags')).toBeNull();
    expect(screen.queryByLabelText('Option')).toBeNull();
    fireEvent.change(property, { target: { value: id } });
    const options = screen.getByLabelText('Option');

    if (multi) {
      for (const option of Array.from(options.options)) option.selected = true;
      fireEvent.change(options);
    } else {
      fireEvent.change(options, { target: { value: id + '-ready' } });
    }

    fireEvent.change(property, { target: { value: 'another' } });
    expect(screen.getByLabelText('Value').textContent).toContain(id + '-ready');
    expect(within(screen.getByLabelText('Option')).getByText('Ready').value).toBe('another-ready');
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
        actions: [{ ...definition, value: { kind, value: multi ? [id + '-ready', id + '-done'] : id + '-ready' } }],
      })
    );
  }
);

test('an unbound schedule chooses local property options even without permission to list other databases', async () => {
  const action = { type: 'define_variable', name: 'pick', value: { kind: 'text', value: 'initial' } };
  const saved = { ...rule, actions: [action], trigger: { type: 'scheduled' } };

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.getSchedule.mockRejectedValue({ code: -2 });
  api.databases.mockRejectedValue({ code: 1012 });
  api.patch.mockResolvedValue(saved);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  fireEvent.change(await screen.findByLabelText('Value source'), { target: { value: 'single_select' } });
  fireEvent.change(screen.getByLabelText('Target database'), { target: { value: 'd' } });
  fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'state' } });
  fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'done' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
      actions: [{ ...action, value: { kind: 'single_select', value: 'done' } }],
    })
  );
  expect(api.fields).not.toHaveBeenCalled();
});

test('a saved Person variable preserves an unavailable member while choosing an authorized person', async () => {
  const missing = 'dc7c50db-1fcc-4c22-af9e-6126e41b81ac';
  const member = '825119c1-c9e1-4bcd-b54c-b31ba43ee9de';
  const definition = { type: 'define_variable', name: 'reviewers', value: { kind: 'person', value: [missing] } };
  const saved = { ...rule, actions: [definition] };

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.patch.mockResolvedValue(saved);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  expect((await screen.findByLabelText('Value source')).value).toBe('person');
  expect(screen.getByText(missing)).toBeTruthy();
  const picker = screen.getByLabelText('Workspace members');

  within(picker).getByText('Morgan').selected = true;
  fireEvent.change(picker);
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
      actions: [{ ...definition, value: { kind: 'person', value: [missing, member] } }],
    })
  );
});

test('legacy select constants retain saved IDs when the destination catalog is unavailable', async () => {
  const constant = { kind: 'multi_select_delta', operation: 'remove' as const, value: ['old-option'] };
  const definition = { type: 'define_variable', name: 'tags', value: constant };
  const saved = { ...rule, actions: [definition] };

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.databases.mockRejectedValue({ code: 1012 });
  api.patch.mockResolvedValue(saved);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  expect(await screen.findByText('old-option')).toBeTruthy();
  expect(screen.getByLabelText('Operation').value).toBe('remove');
  expect(await screen.findByText('Retry')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'archived_tags' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
      actions: [{ ...definition, name: 'archived_tags', value: constant }],
    })
  );
});

test('downstream select assignments use authorized option IDs for constants and aliases and look up each destination once', async () => {
  const define = (name: string, value: PropertyValue): RuleAction => ({ type: 'define_variable', name, value });
  const steps = [
    define('direct', { kind: 'multi_select', value: ['one'] }),
    define('alias', { kind: 'variable', name: 'direct' }),
    define('people', { kind: 'person', value: [row] }),
  ];
  const options = (id: string) => [{ id, name: 'Same label' }];
  const names = (kind: string, id: string) => workflowVariableChoices(steps, [], [kind], options(id)).map((v) => v.name);

  expect(names('multi_select', 'one')).toEqual(['direct', 'alias']);
  expect(names('multi_select', 'other')).toEqual([]);
  expect(names('single_select', 'one')).toEqual([]);
  expect(names('person', 'one')).toEqual(['people']);
  const assignment = { field_id: 'tags', value: { kind: 'variable', name: 'alias' } };
  const actions = [
    ...steps,
    { type: 'set_property', ...assignment },
    { type: 'create_row', database_id: 'dest', properties: [assignment, { ...assignment, field_id: 'priorities' }] },
  ];
  const catalog = jest.fn(async (_db: string, ids: string[]) =>
    ids.map((id) => ({ id, type: 4, options: options('one') }))
  );

  expect(await selectAssignmentsFit('d', actions, catalog)).toBe(true);
  expect(catalog.mock.calls).toEqual([
    ['d', ['tags']],
    ['dest', ['tags', 'priorities']],
  ]);
  expect(
    await selectAssignmentsFit('d', actions, async () => [{ id: 'tags', type: 4, options: options('other') }])
  ).toBe(false);
});

test('saving a changed select constant rechecks the field consuming its alias before sending the patch', async () => {
  const first = { type: 'define_variable', name: 'label', value: { kind: 'single_select', value: 'old' } };
  const alias = { type: 'define_variable', name: 'alias', value: { kind: 'variable', name: 'label' } };
  const create = {
    type: 'create_row',
    database_id: 'dest',
    view_id: 'v',
    properties: [{ field_id: 'stage', value: { kind: 'variable', name: 'alias' } }],
  };
  const saved = { ...rule, actions: [first, alias, create] };
  const target = (id: string, ids: string[]) => ({
    id,
    name: id,
    field_type_id: 3,
    type_option: { content: { options: ids.map((option) => ({ id: option, name: 'Review' })) } },
  });

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.databases.mockResolvedValue({
    has_more: false,
    databases: [{ database_id: 'dest', views: [{ view_id: 'v', name: 'Archive' }] }],
  });
  api.fields.mockResolvedValue([target('stage', ['old', 'good']), target('other', ['bad'])]);
  api.patch.mockResolvedValue(saved);
  fullManager();
  fireEvent.click(await screen.findByText('Existing'));
  const editor = within(await screen.findByRole('group', { name: 'Action 1' }));
  const db = editor.getByLabelText('Target database');

  await within(db).findByText('Archive');
  fireEvent.change(db, { target: { value: 'dest' } });
  const property = editor.getByLabelText('Property');

  await within(property).findByText('other');
  fireEvent.change(property, { target: { value: 'other' } });
  fireEvent.change(editor.getByLabelText('Option'), { target: { value: 'bad' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByRole('alert');
  expect(api.patch).not.toHaveBeenCalled();
  fireEvent.change(property, { target: { value: 'stage' } });
  fireEvent.change(editor.getByLabelText('Option'), { target: { value: 'good' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
      actions: [{ ...first, value: { kind: 'single_select', value: 'good' } }, alias, create],
    })
  );
});

test('leaving the form during destination verification prevents a late rule write', async () => {
  const variable = { type: 'define_variable', name: 'value', value: { kind: 'single_select', value: 'ready' } };
  const create = {
    type: 'create_row',
    database_id: 'dest',
    view_id: 'v',
    properties: [{ field_id: 'stage', value: { kind: 'variable', name: 'value' } }],
  };
  const saved = { ...rule, actions: [variable, create] };
  const fields = [
    {
      id: 'stage',
      name: 'Stage',
      field_type_id: 3,
      type_option: { content: { options: [{ id: 'ready', name: 'Ready' }] } },
    },
  ];

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.databases.mockResolvedValue({
    has_more: false,
    databases: [{ database_id: 'dest', views: [{ view_id: 'v', name: 'Archive' }] }],
  });
  let resolve!: (result: typeof fields) => void;

  api.fields.mockResolvedValueOnce(fields).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const page = fullManager();

  fireEvent.click(await screen.findByText('Existing'));
  await screen.findByDisplayValue('Stage');
  fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Paris' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.fields).toHaveBeenCalledTimes(2));
  page.unmount();
  await act(async () => resolve(fields));
  expect(api.patch).not.toHaveBeenCalled();
});

test('a cross-database formula uses source field IDs and retains the target database, row and field', async () => {
  const saved = {
    ...rule,
    actions: [
      {
        type: 'edit_row',
        database_id: 'dest',
        row: { type: 'id' as const, row_id: row },
        properties: [{ field_id: 'total', value: { kind: 'number', value: 1 } }],
      },
    ],
  };

  api.list.mockResolvedValue({ items: [saved] });
  api.get.mockResolvedValue(saved);
  api.patch.mockResolvedValue(saved);
  api.databases.mockResolvedValue({
    databases: [{ database_id: 'dest', views: [{ view_id: 'v', name: 'Summary' }] }],
    has_more: false,
  });
  api.fields.mockResolvedValue([{ id: 'total', name: 'Target total', field_type_id: 1 }]);
  render(<RuleManager workspace='w' database='d' caps={{ ...extended, formulaExpression: true }} />);
  fireEvent.click(await screen.findByText('Existing'));
  await screen.findByDisplayValue('Target total');
  fireEvent.change(screen.getByLabelText('Value source'), { target: { value: 'expression' } });
  const chooser = screen.getByLabelText('Insert source property');

  expect(within(chooser).queryByText('Target total')).toBeNull();
  fireEvent.change(chooser, { target: { value: 'title' } });
  fireEvent.change(screen.getByLabelText('Formula expression'), { target: { value: 'length(prop("title"))' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() =>
    expect(api.patch.mock.calls[0][4]).toEqual({
      actions: [
        {
          ...saved.actions[0],
          properties: [{ field_id: 'total', value: { kind: 'expression', expression: 'length(prop("title"))' } }],
        },
      ],
    })
  );
});

test('formula capability, UTF-8 limits, nested operands and cross-database assignments use the same contract', () => {
  const caps = ruleCapabilities({
    enable_database_automations: true,
    database_automation_triggers: ['row_created'],
    database_automation_actions: ['create_row', 'edit_row', 'set_property', 'define_variable'],
    database_automation_value_features: ['formula_expression_v1'],
  } as ServerInfo);
  const expression = { kind: 'expression', expression: 'prop("cost") * 2' };
  const literal = { kind: 'number', value: 1 };
  const legacy = { kind: 'formula', value: { operator: 'add' as const, left: literal, right: literal } };
  const mixed = { ...legacy, value: { ...legacy.value, right: expression } };
  const valid = (value: typeof expression) =>
    validRule({ ...rule, actions: [{ type: 'define_variable', name: 'x', value }] });

  expect(caps.formulaExpression).toBe(true);
  expect(ruleCapabilities().formulaExpression).toBe(false);
  for (const type of ['create_row', 'edit_row']) {
    const saved = {
      ...rule,
      actions: [
        {
          type,
          database_id: 'dest',
          ...(type === 'create_row' ? { view_id: 'view' } : { row: { type: 'trigger' as const } }),
          properties: [{ field_id: 'total', value: mixed }],
        },
      ],
    };

    expect(canEditRule(saved, caps)).toBe(true);
    expect(canEditRule(saved, extended)).toBe(false);
    expect(
      canEditRule(
        { ...saved, actions: [{ ...saved.actions[0], properties: [{ field_id: 'total', value: legacy }] }] },
        extended
      )
    ).toBe(true);
  }

  expect(valid({ ...expression, expression: '界'.repeat(1365) + '0' })).toBe(true);
  expect(valid({ ...expression, expression: '界'.repeat(1366) })).toBe(false);
  expect(valid({ ...expression, expression: '  ' })).toBe(false);
  expect(valid({ ...expression, expression: 'a\0b' })).toBe(false);
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

test('addressed Gmail saves visible and private recipients on the selected grant', async () => {
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
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'addressed_email' } });
  await within(screen.getByLabelText('Gmail account')).findByText('Work Gmail');
  expect(within(screen.getByLabelText('Gmail account')).queryByText('Slack account')).toBeNull();
  fireEvent.change(screen.getByLabelText('Gmail account'), { target: { value: 'mail' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'reviewer@example.test' } });
  fireEvent.click(screen.getByText('Add Cc recipient'));
  fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'team@example.test' } });
  fireEvent.click(screen.getByText('Add Bcc recipient'));
  fireEvent.change(screen.getByLabelText('Bcc'), { target: { value: 'private@example.test' } });
  fireEvent.change(screen.getByLabelText('Reply-To'), { target: { value: 'reply@example.test' } });
  fireEvent.change(screen.getByLabelText('Sender name'), { target: { value: 'Review team' } });
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Update' } });
  fireEvent.change(screen.getByLabelText('Notification message'), { target: { value: 'Ready' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  expect(api.create.mock.calls[0][3].actions).toEqual([
    {
      type: 'addressed_email',
      cc: ['team@example.test'],
      bcc: ['private@example.test'],
      reply_to: 'reply@example.test',
      sender_name: 'Review team',
      connection_id: 'mail',
      to: ['reviewer@example.test'],
      subject: 'Update',
      message: 'Ready',
    },
  ]);
});

test('Gmail member addressing persists four typed sources without exposing member email addresses', async () => {
  (listConnections as jest.MockedFunction<typeof listConnections>).mockResolvedValue([
    { id: 'mail', provider: 'gmail', connected_at: '2026-01-01', status: 'active', account_identifier: 'Work Gmail' },
  ]);
  fullManager();
  api.create.mockResolvedValue(rule);
  fireEvent.click(await screen.findByText('New automation'));
  const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  choose('Name', 'Send update');
  choose('Action', 'member_addressed_email');
  await within(screen.getByLabelText('Gmail account')).findByText('Work Gmail');
  choose('Gmail account', 'mail');
  choose('To recipient source', 'actor');
  fireEvent.click(screen.getByText('Add Cc recipient'));
  choose('Cc recipient source', 'workspace_user');
  await within(screen.getByLabelText('Workspace members')).findByText('Morgan');
  choose('Workspace members', '825119c1-c9e1-4bcd-b54c-b31ba43ee9de');
  fireEvent.click(screen.getByText('Add Bcc recipient'));
  choose('Bcc recipient source', 'person_field');
  choose('Property', 'assignee');
  choose('Reply-To recipient source', 'address');
  choose('Reply-To', 'updates@example.test');
  choose('Sender name', 'Reviews');
  choose('Subject', 'Status');
  choose('Notification message', 'Approved');
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  expect(api.create.mock.calls[0][3].actions).toEqual([
    {
      type: 'member_addressed_email',
      connection_id: 'mail',
      subject: 'Status',
      message: 'Approved',
      sender_name: 'Reviews',
      to: [{ type: 'actor' }],
      cc: [{ type: 'workspace_user', user_id: '825119c1-c9e1-4bcd-b54c-b31ba43ee9de' }],
      bcc: [{ type: 'person_field', field_id: 'assignee' }],
      reply_to: { type: 'address', value: 'updates@example.test' },
    },
  ]);
});

test.each([false, true])(
  'scheduled Gmail offers property recipients only for a bound row and never offers actor (bound=%s)',
  async (rowBound) => {
    const saved = {
      ...rule,
      trigger: { type: 'scheduled' },
      actions: [
        {
          type: 'member_addressed_email',
          connection_id: 'mail',
          subject: 'Review',
          message: 'Ready',
          to: [{ type: 'address' as const, value: 'old@example.test' }],
        },
      ],
    };

    api.getSchedule.mockResolvedValue({ row_id: rowBound ? row : undefined } as ScheduleState);
    api.list.mockResolvedValue({ items: [saved] });
    api.get.mockResolvedValue(saved);
    api.patch.mockResolvedValue(saved);
    (listConnections as jest.MockedFunction<typeof listConnections>).mockResolvedValue([]);
    fullManager();
    fireEvent.click(await screen.findByText('Existing'));
    const chooser = await screen.findByLabelText('To recipient source');

    await waitFor(() => expect(api.getSchedule).toHaveBeenCalledTimes(1));
    expect(within(chooser).queryByText('Person who triggered the rule')).toBeNull();
    if (rowBound) {
      expect(await within(chooser).findByText('People from a property')).toBeTruthy();
      fireEvent.change(chooser, { target: { value: 'person_field' } });
      fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'assignee' } });
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith('w', 'd', 'rule', 5, {
          actions: [{ ...saved.actions[0], to: [{ type: 'person_field', field_id: 'assignee' }] }],
        })
      );
    } else {
      expect(within(chooser).queryByText('People from a property')).toBeNull();
    }
  }
);

test('Gmail member selectors respect row scope, calendar binding, discovery, and the ten selector limit', () => {
  const fields = [
    { id: 'creator', name: 'Created by', type: FieldType.CreatedBy },
    { id: 'editor', name: 'Editor', type: FieldType.LastEditedBy },
    { id: 'title', name: 'Title', type: FieldType.RichText },
  ];
  const action: RuleAction = {
    type: 'member_addressed_email',
    connection_id: 'mail',
    subject: 's',
    message: 'm',
    to: [{ type: 'person_field', field_id: 'creator' }],
    reply_to: { type: 'person_field', field_id: 'editor' },
  };
  const saved = { ...rule, actions: [action], trigger: { type: 'scheduled' } };

  expect(canEditRule(saved, extended)).toBe(true);
  expect(
    canEditRule(saved, { ...extended, actions: extended.actions.filter((a) => a !== 'member_addressed_email') })
  ).toBe(false);
  expect(
    canEditRule({ ...saved, actions: [{ ...action, to: [{ type: 'actor', later: true } as never] }] }, extended)
  ).toBe(false);
  expect(validRule(saved, fields, true)).toBe(true);
  expect(validRule(saved, fields)).toBe(false);
  expect(validRule({ ...saved, actions: [{ ...action, to: [{ type: 'actor' }] }] }, fields, true)).toBe(false);
  expect(
    validRule({ ...saved, actions: [{ ...action, to: [{ type: 'person_field', field_id: 'title' }] }] }, fields, true)
  ).toBe(false);
  expect(
    validRule({ ...saved, trigger: { type: 'row_events', match: 'any', triggers: [{ type: 'row_deleted' }] } }, fields)
  ).toBe(false);
  expect(
    validRule(
      {
        ...saved,
        actions: [
          { ...action, to: Array(11).fill({ type: 'address', value: 'member@example.test' }), reply_to: undefined },
        ],
      },
      fields
    )
  ).toBe(false);
  expect(
    validRule(
      { ...saved, actions: [{ ...action, to: [{ type: 'workspace_user', user_id: 'invalid' }], reply_to: undefined }] },
      fields
    )
  ).toBe(false);
  expect(validRule({ ...saved, actions: [{ ...action, to: [], reply_to: undefined }] }, fields)).toBe(false);
  const first: RuleAction = { type: 'create_row' },
    second: RuleAction = { type: 'create_row' };
  const indirect: RuleAction = {
    ...action,
    bcc: [{ type: 'address', value: { parts: [{ type: 'step_row_id', action_index: 0 }] } }],
  };
  const reordered = reorderActions([first, second, indirect], [second, first, indirect]);

  expect(reordered[2]).toEqual({
    ...indirect,
    bcc: [{ type: 'address', value: { parts: [{ type: 'step_row_id', action_index: 1 }] } }],
  });
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
      row: { type: 'id', row_id: row },
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

test('native Button resolution uses the clicked field and row, offers caller-owned accounts, and retries the same payload', async () => {
  const userGrants = [
    {
      id: 'mine',
      provider: 'gmail' as const,
      connected_at: 'now',
      status: 'active' as const,
      account_identifier: 'My Gmail',
    },
    {
      id: 'stale',
      provider: 'gmail' as const,
      connected_at: 'now',
      status: 'revoked' as never,
      account_identifier: 'Old Gmail',
    },
  ];

  jest.mocked(listConnections).mockResolvedValue(userGrants);
  api.webhooks.mockResolvedValue({
    items: [
      { id: 'my-hook', name: 'My endpoint', disabled: false },
      { id: 'old', name: 'disabled', disabled: true },
    ],
  });
  api.list.mockRejectedValue({ code: 1004 });
  api.resolveButton.mockResolvedValue({
    automation_id: 'scoped',
    revision: 7,
    enabled: true,
    connectors: [
      { action_index: 1, kind: 'gmail' },
      { action_index: 2, kind: 'webhook' },
    ],
  });
  api.invokeButton.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce('request');
  const ui = render(<ButtonControl workspace='w' database='d' row='row-1' field='send' caps={extended} />);
  const send = await screen.findByText('Run now');

  expect((send as HTMLButtonElement).disabled).toBe(true);
  expect(api.resolveButton).toHaveBeenCalledWith('w', 'd', 'row-1', 'send', expect.any(AbortSignal));
  expect(screen.queryByText('Set up for this row')).toBeNull();
  expect(screen.queryByText('Old Gmail')).toBeNull();
  expect(screen.queryByText('disabled')).toBeNull();
  fireEvent.change(screen.getByLabelText('Step 2 · gmail account'), { target: { value: 'mine' } });
  fireEvent.change(screen.getByLabelText('Step 3 · webhook account'), { target: { value: 'my-hook' } });
  fireEvent.click(send);
  fireEvent.click(await screen.findByText('Retry'));
  await screen.findByText('Run queued.');
  const first = api.invokeButton.mock.calls[0];

  expect(first).toEqual([
    'w',
    'd',
    'row-1',
    'send',
    {
      request_id: expect.any(String),
      automation_id: 'scoped',
      expected_revision: 7,
      connections: [
        { action_index: 1, connection_id: 'mine' },
        { action_index: 2, connection_id: 'my-hook' },
      ],
    },
  ]);
  expect(api.invokeButton.mock.calls[1]).toEqual(first);
  expect(api.run).not.toHaveBeenCalled();
  ui.unmount();
  api.resolveButton.mockResolvedValue({ automation_id: 'shared', revision: 1, enabled: true, connectors: [] });
  api.invokeButton.mockResolvedValue('new');
  render(<ButtonControl workspace='w' database='d' row='row-2' field='send' caps={extended} />);
  fireEvent.click(await screen.findByText('Run now'));
  await screen.findByText('Run queued.');
  expect(api.invokeButton.mock.calls[2][4].request_id).not.toBe(first[4].request_id);
});
test.each(['gmail', 'slack'] as const)(
  'a Button clicker can connect their first %s account before invoking',
  async (provider) => {
    api.list.mockRejectedValue({ code: 1004 });
    api.resolveButton.mockResolvedValue({
      automation_id: 'shared',
      revision: 2,
      enabled: true,
      connectors: [
        { action_index: 0, kind: provider },
        { action_index: 1, kind: provider },
      ],
    });
    jest
      .mocked(listConnections)
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: 'my-new-grant', provider, status: 'active', connected_at: '2026-11-19', account_identifier: 'My account' },
      ]);
    jest.mocked(authorizeIntegration).mockResolvedValue({ connectionId: 'my-new-grant', oauthQuery: 'completed' });
    jest.mocked(confirmConnection).mockResolvedValue({ success: true });
    render(<ButtonControl workspace='w' database='d' row='row' field='send' caps={extended} />);

    const link = await screen.findByRole('button', { name: provider === 'gmail' ? 'Connect Gmail' : 'Connect Slack' });

    expect(screen.queryByText('Set up for this row')).toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'My account' })).toHaveLength(2));
    expect(authorizeIntegration).toHaveBeenCalledWith('w', provider, expect.any(AbortSignal));
    expect(confirmConnection).toHaveBeenCalledWith('w', provider, 'my-new-grant', 'completed', expect.any(AbortSignal));
    expect(api.invokeButton).not.toHaveBeenCalled();
    for (const step of [1, 2])
      fireEvent.change(screen.getByLabelText(`Step ${step} · ${provider} account`), {
        target: { value: 'my-new-grant' },
      });
    fireEvent.click(screen.getByText('Run now'));
    await screen.findByText('Run queued.');
    expect(api.invokeButton).toHaveBeenCalledWith(
      'w',
      'd',
      'row',
      'send',
      expect.objectContaining({
        connections: [0, 1].map((action_index) => ({ action_index, connection_id: 'my-new-grant' })),
      })
    );
  }
);
test('a row editor can create the first override without changing the shared definition or schema', async () => {
  api.list.mockResolvedValue({ items: [] });
  api.resolveButton.mockRejectedValue({ code: -2 });
  api.create.mockResolvedValue(rule);
  render(<ButtonControl workspace='w' database='d' row='row-1' field='send' caps={extended} />);
  fireEvent.click(await screen.findByText('Set up for this row'));
  expect(screen.queryByLabelText('Trigger')).toBeNull();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Local review' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  expect(api.create).toHaveBeenCalledWith(
    'w',
    'd',
    expect.any(String),
    expect.objectContaining({ trigger: { type: 'button', field_id: 'send' }, name: 'Local review' }),
    'row-1'
  );
  expect(api.patch).not.toHaveBeenCalled();
});
test('the Button trigger requires both discovery signals and an actual Button property', () => {
  const info = {
    enable_database_automations: true,
    database_automation_triggers: ['row_created', 'button'],
    database_automation_actions: ['notify'],
  } as ServerInfo;
  const old = ruleCapabilities(info);
  const current = ruleCapabilities({ ...info, database_automation_scope_features: ['row_scoped_v1'] });
  const saved = { ...rule, trigger: { type: 'button', field_id: 'send' } };

  expect(canEditRule(saved, old)).toBe(false);
  expect(canEditRule(saved, current)).toBe(true);
  expect(validRule(saved, [{ id: 'send', name: 'Send', type: FieldType.Button }])).toBe(true);
  expect(validRule(saved, [{ id: 'send', name: 'Send', type: FieldType.RichText }])).toBe(false);
});

test('renders 128 Button cells without resolving bindings or fetching the clicking member’s accounts', async () => {
  const enabled = {
    enable_database_automations: true,
    database_automation_triggers: ['button'],
    database_automation_scope_features: ['row_scoped_v1'],
    database_automation_actions: ['notify'],
  } as ServerInfo;
  const view = { workspaceId: 'w' } as ReturnType<typeof useDatabaseContextOptional>;
  const server = { status: 'ready', info: enabled } as ReturnType<typeof getServerInfoSnapshot>;

  jest.mocked(useDatabaseContextOptional).mockReturnValue(view);
  jest.mocked(useCurrentUserOptional).mockReturnValue({ uuid: 'clicker' } as ReturnType<typeof useCurrentUserOptional>);
  jest.mocked(getServerInfoSnapshot).mockReturnValue(server);
  const field = { get: (key: string) => (key === 'name' ? 'Request review' : undefined) } as unknown as YDatabaseField;
  const cells = Array.from({ length: 128 }, (_, i) => (
    <ButtonCell field={field} key={i} rowId={String(i)} fieldId='send' />
  ));
  const ui = render(<>{cells}</>);

  expect(screen.getAllByRole('button', { name: 'Request review' })).toHaveLength(128);
  expect(api.resolveButton).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled();
  expect(listConnections).not.toHaveBeenCalled();
  expect(api.webhooks).not.toHaveBeenCalled();
  api.list.mockResolvedValue({ items: [] });
  api.resolveButton.mockResolvedValue({ automation_id: 'bound', revision: 1, enabled: true, connectors: [] });
  fireEvent.click(screen.getAllByRole('button', { name: 'Request review' })[64]);
  await screen.findByText('Run now');
  expect(api.resolveButton).toHaveBeenCalledTimes(1);
  expect(api.resolveButton).toHaveBeenCalledWith('w', 'd', '64', 'send', expect.any(AbortSignal));
  expect(listConnections).not.toHaveBeenCalled();
  ui.unmount();
  const old = { status: 'ready', info: { ...enabled, database_automation_scope_features: [] } } as ReturnType<
    typeof getServerInfoSnapshot
  >;

  jest.mocked(getServerInfoSnapshot).mockReturnValue(old);
  const legacy = render(<ButtonCell field={field} rowId='one' fieldId='send' />);

  expect(screen.getByText('Request review').tagName).toBe('SPAN');
  legacy.unmount();
  jest.mocked(getServerInfoSnapshot).mockReturnValue(server);
  jest
    .mocked(useDatabaseContextOptional)
    .mockReturnValue({ ...view, dataSource: { type: 'history' } } as ReturnType<typeof useDatabaseContextOptional>);
  render(<ButtonCell field={field} rowId='one' fieldId='send' />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(api.resolveButton).toHaveBeenCalledTimes(1);
});

test('a negotiated confirmation is reviewed, bound to the click and retained across transport retry', async () => {
  api.resolveButton.mockResolvedValue({
    automation_id: 'bound',
    revision: 5,
    enabled: true,
    connectors: [],
    confirmation: 'Email the selected people?',
    presentation_digest: 'v1',
    has_open_target: true,
  });
  api.invokeButton.mockRejectedValueOnce(Error('interrupted')).mockResolvedValueOnce('ok');
  api.buttonResult.mockResolvedValue({
    status: 'succeeded',
    target: { type: 'url', url: 'https://example.org/result' },
  });
  render(
    <ButtonControl workspace='w' database='d' row='one' field='send' caps={{ ...extended, buttonInteractions: true }} />
  );
  await screen.findByText('Email the selected people?');
  expect(api.invokeButton).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Run now'));
  fireEvent.click(await screen.findByText('Retry'));
  const link = await screen.findByRole('link', { name: 'Open link' });

  expect(link.getAttribute('href')).toBe('https://example.org/result');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  const first = api.invokeButton.mock.calls[0];

  expect(first[4]).toMatchObject({ expected_revision: 5, presentation_digest: 'v1' });
  expect(api.invokeButton.mock.calls[1]).toEqual(first);
  expect(api.buttonResult).toHaveBeenCalledWith('w', 'd', 'one', 'send', first[4].request_id, expect.any(AbortSignal));
});

test('stale confirmation is reloaded and requires a separate click with a new submission ID', async () => {
  const b = { automation_id: 'bound', revision: 4, enabled: true, connectors: [] };

  api.resolveButton
    .mockResolvedValueOnce({ ...b, presentation_digest: 'first', confirmation: 'Original prompt' })
    .mockResolvedValueOnce({ ...b, presentation_digest: 'next', confirmation: 'Current prompt' });
  api.invokeButton
    .mockRejectedValueOnce({ code: 1008, message: 'Invalid request:automation_revision_conflict:4' })
    .mockResolvedValue('ok');
  render(
    <ButtonControl workspace='w' database='d' row='one' field='send' caps={{ ...extended, buttonInteractions: true }} />
  );
  await screen.findByText('Original prompt');
  fireEvent.click(screen.getByText('Run now'));
  fireEvent.click(await screen.findByText('Reload saved version'));
  await screen.findByText('Current prompt');
  expect(api.invokeButton).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Run now'));
  await screen.findByText('Run queued.');
  expect(api.invokeButton.mock.calls[1][4].presentation_digest).toBe('next');
  expect(api.invokeButton.mock.calls[0][4].request_id).not.toBe(api.invokeButton.mock.calls[1][4].request_id);
});

test('a completed created row uses the granted destination view and an unmounted poll cannot navigate', async () => {
  const view = '670b1863-c608-4d2d-835e-282bca078e31',
    db = '31a17711-fb18-48f6-a5cf-6517a63768c0';
  let opened!: () => void;
  const navigateToRow = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          opened = resolve;
        })
    ),
    loadViewMeta = jest.fn().mockResolvedValue({ view_id: view, extra: { database_id: db } });

  jest
    .mocked(useDatabaseContextOptional)
    .mockReturnValue({ workspaceId: 'w', navigateToRow, loadViewMeta } as unknown as ReturnType<
      typeof useDatabaseContextOptional
    >);
  const target = { type: 'row', database_id: db, view_id: view, row_id: row };

  api.buttonResult.mockResolvedValue({ status: 'succeeded', target });
  const onNavigated = jest.fn();
  const props = { workspace: 'w', database: 'd', row: 'one', field: 'send', requestId: 'key', onNavigated };
  const ui = render(<ButtonResult {...props} />);

  await waitFor(() => expect(navigateToRow).toHaveBeenCalledWith(row, view));
  expect(loadViewMeta).toHaveBeenCalledWith(view, undefined, { metadataOnly: true, authoritative: true });
  expect(onNavigated).not.toHaveBeenCalled();
  await act(async () => opened());
  expect(onNavigated).toHaveBeenCalledTimes(1);
  ui.unmount();
  let resolve!: (value: { status: string; target: unknown }) => void;

  api.buttonResult.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const closed = render(<ButtonResult {...props} />);

  closed.unmount();
  await act(async () => resolve({ status: 'succeeded', target }));
  expect(navigateToRow).toHaveBeenCalledTimes(1);
  expect(onNavigated).toHaveBeenCalledTimes(1);
});

test.each(['denied view', 'mismatched database', 'legacy view without a database'])(
  'a successful created row stays unavailable for a %s',
  async (reason) => {
    const view = '670b1863-c608-4d2d-835e-282bca078e31';
    const db = '31a17711-fb18-48f6-a5cf-6517a63768c0';
    const loadViewMeta = jest.fn(),
      navigateToRow = jest.fn(),
      loadView = jest.fn();

    if (reason === 'denied view') loadViewMeta.mockRejectedValue(new Error('No access'));
    else
      loadViewMeta.mockResolvedValue({
        view_id: view,
        extra: reason === 'mismatched database' ? { database_id: 'other' } : {},
      });
    jest.mocked(useDatabaseContextOptional).mockReturnValue({
      workspaceId: 'w',
      loadViewMeta,
      loadView,
      navigateToRow,
    } as unknown as ReturnType<typeof useDatabaseContextOptional>);
    api.buttonResult.mockResolvedValue({
      status: 'succeeded',
      target: { type: 'row', view_id: view, database_id: db, row_id: row },
    });
    render(<ButtonResult workspace='w' database='d' row='one' field='send' requestId='request' />);
    await screen.findByText('The destination is unavailable.');
    expect(navigateToRow).not.toHaveBeenCalled();
    expect(screen.queryByText('Check again')).toBeNull();
    expect(api.buttonResult).toHaveBeenCalledTimes(1);
  }
);

test.each(['failed', 'skipped', 'cancelled', 'unknown'])(
  'terminal or unknown result %s cannot open a supplied target',
  async (status) => {
    api.buttonResult.mockResolvedValue({ status, target: { type: 'url', url: 'https://example.com' } });
    render(<ButtonResult workspace='w' database='d' row='one' field='send' requestId='key' />);
    await screen.findByText(
      status === 'unknown' ? 'The destination is unavailable.' : 'The automation did not complete.'
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(api.buttonResult).toHaveBeenCalledTimes(1);
  }
);

test('navigation accepts bounded HTTP(S) destinations and non-nil stable typed targets', () => {
  expect(validButtonUrl('https://example.org/a?b=2')).toBe(true);
  for (const value of [
    'https://example.org/a\u008fb',
    'https://example.org/a\u00a0b',
    'mailto:test@example.org',
    '/app/x',
    'https://user@example.org',
    'https://@example.org',
    'https://example.org/\nnext',
    'https://e.org/' + 'é'.repeat(1024),
    String.raw`https://example.org\path`,
  ])
    expect(validButtonUrl(value)).toBe(false);
  expect(readButtonOpenTarget({ type: 'created_row', action_index: 4 })).toBeDefined();
  expect(readButtonOpenTarget({ type: 'created_row', action_index: 5 })).toBeUndefined();
  expect(readButtonResultTarget({ type: 'created_row', action_index: 0 })).toBeUndefined();
  expect(readButtonResultTarget({ type: 'page', view_id: '00000000-0000-0000-0000-000000000000' })).toBeUndefined();
});

test('field authors can save, clear and preserve negotiated Button confirmation and destinations', async () => {
  const save = jest.fn();

  jest.mocked(useUpdateButtonTypeOption).mockReturnValue(save);
  jest
    .mocked(useDatabaseContextOptional)
    .mockReturnValue({ workspaceId: 'w', canWrite: true } as ReturnType<typeof useDatabaseContextOptional>);
  const setup = (features: string[], options: Record<string, unknown>) => {
    const snapshot = {
      status: 'ready',
      info: {
        enable_database_automations: true,
        database_automation_triggers: ['button'],
        database_automation_actions: ['notify'],
        database_automation_scope_features: features,
      },
    } as ReturnType<typeof getServerInfoSnapshot>;

    jest.mocked(getServerInfoSnapshot).mockReturnValue(snapshot);
    jest
      .mocked(useFieldSelector)
      .mockReturnValue({ field: { get: () => ({ get: () => ({ toJSON: () => options }) }) } } as unknown as ReturnType<
        typeof useFieldSelector
      >);
    return render(<ButtonDefaults fieldId='send' />);
  };

  const base = ['row_scoped_v1'],
    advanced = [...base, 'button_interactions_v1'];
  const future = { type: 'url', url: 'https://example.org', extra: 1 };
  const first = setup(base, { label: 'Schedule', confirmation: 'Original', open_target: future });

  await waitFor(() => expect(screen.getByText('Save').disabled).toBe(false));
  expect(screen.queryByLabelText('Confirmation message')).toBeNull();
  fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenLastCalledWith({ label: 'Schedule', automation_id: '' });
  first.unmount();
  const unknown = setup(advanced, { label: 'Schedule', confirmation: 'Original', open_target: future });

  await screen.findByText('The destination is unavailable.');
  await waitFor(() => expect(screen.getByText('Save').disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Confirmation message'), { target: { value: 'Changed' } });
  fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenLastCalledWith({ label: 'Schedule', automation_id: '', confirmation: 'Changed' });
  unknown.unmount();
  setup(advanced, {});
  await waitFor(() => expect(screen.getByText('Save').disabled).toBe(false));
  const confirmation = screen.getByLabelText('Confirmation message');

  fireEvent.change(confirmation, { target: { value: '🌿'.repeat(257) } });
  expect(screen.getByText('Save').disabled).toBe(true);
  fireEvent.change(confirmation, { target: { value: '🌿'.repeat(256) } });
  fireEvent.change(screen.getByLabelText(strings.databaseAutomation.afterSuccess), { target: { value: 'url' } });
  const url = screen.getByLabelText(strings.databaseAutomation.openKind.url);

  fireEvent.change(url, { target: { value: 'file:///tmp/example' } });
  expect(screen.getByText('Save').disabled).toBe(true);
  fireEvent.change(url, { target: { value: 'https://example.org' } });
  fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenLastCalledWith({
    label: '',
    automation_id: '',
    confirmation: '🌿'.repeat(256),
    open_target: { type: 'url', url: 'https://example.org' },
  });
  fireEvent.change(confirmation, { target: { value: '' } });
  fireEvent.change(screen.getByLabelText(strings.databaseAutomation.afterSuccess), { target: { value: '' } });
  fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenLastCalledWith({ label: '', automation_id: '', confirmation: '', open_target: null });
});

test('a pending Button only reads six times until the member checks the same receipt again', async () => {
  jest.useFakeTimers();
  try {
    api.buttonResult.mockResolvedValue({ status: 'running', target: { type: 'url', url: 'https://example.org/' } });
    render(<ButtonResult workspace='w' database='d' row='one' field='send' requestId='receipt' />);
    await act(async () => undefined);
    for (const delay of [1000, 2000, 4000, 8000, 8000])
      await act(async () => {
        jest.advanceTimersByTime(delay);
      });
    expect(api.buttonResult).toHaveBeenCalledTimes(6);
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(api.buttonResult).toHaveBeenCalledTimes(6);
    api.buttonResult.mockResolvedValue({ status: 'succeeded', target: { type: 'url', url: 'https://example.org/' } });
    fireEvent.click(screen.getByText('Check again'));
    await act(async () => undefined);
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.org/');
    expect(api.buttonResult).toHaveBeenLastCalledWith('w', 'd', 'one', 'send', 'receipt', expect.any(AbortSignal));
    expect(api.invokeButton).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

function interactiveButtonField() {
  const snapshot = {
    status: 'ready',
    info: {
      enable_database_automations: true,
      database_automation_triggers: ['button'],
      database_automation_actions: ['notify'],
      database_automation_scope_features: ['row_scoped_v1', 'button_interactions_v1'],
    },
  } as ReturnType<typeof getServerInfoSnapshot>;

  jest.mocked(getServerInfoSnapshot).mockReturnValue(snapshot);
  jest.mocked(useCurrentUserOptional).mockReturnValue({ uuid: 'clicker' } as ReturnType<typeof useCurrentUserOptional>);
  jest
    .mocked(useDatabaseContextOptional)
    .mockReturnValue({ workspaceId: 'w' } as ReturnType<typeof useDatabaseContextOptional>);
  const field = { get: (key: string) => (key === 'name' ? 'Approve' : undefined) } as unknown as YDatabaseField;

  return field;
}

test('only an intentional connector-free cell click runs the Button once; a later click has a fresh UUID', async () => {
  const field = interactiveButtonField();
  const binding = { automation_id: 'bound', revision: 7, enabled: true, connectors: [] };

  api.list.mockResolvedValue({ items: [] });
  api.resolveButton.mockResolvedValue(binding);
  api.invokeButton.mockRejectedValueOnce(new Error('lost response')).mockResolvedValue('accepted');
  render(<ButtonCell field={field} fieldId='send' rowId='one' />);
  expect(api.invokeButton).not.toHaveBeenCalled();
  const cell = screen.getByRole('button', { name: 'Approve' });

  act(() => {
    fireEvent.click(cell);
    fireEvent.click(cell);
  });
  const retry = await screen.findByRole('button', { name: 'Retry' });

  expect(api.invokeButton).toHaveBeenCalledTimes(1);
  const first = api.invokeButton.mock.calls[0][4];

  fireEvent.click(retry);
  await screen.findByText('Run queued.');
  expect(api.invokeButton).toHaveBeenCalledTimes(2);
  expect(api.invokeButton.mock.calls[1][4]).toEqual(first);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText('Run queued.');
  expect(api.invokeButton).toHaveBeenCalledTimes(3);
  expect(api.invokeButton.mock.calls[2][4].request_id).not.toBe(first.request_id);
  expect(api.resolveButton).toHaveBeenCalledTimes(2);
});

test('a settings mount and a saved-rule reload never arm a one-click invocation', async () => {
  api.list.mockResolvedValue({ items: [] });
  api.resolveButton.mockResolvedValue({ automation_id: 'shared', revision: 1, enabled: true, connectors: [] });
  render(
    <ButtonControl workspace='w' database='d' row='one' field='send' caps={{ ...extended, buttonInteractions: true }} />
  );
  await screen.findByText('Run now');
  fireEvent.click(screen.getByText('Set up for this row'));
  await screen.findByLabelText('Name');
  expect(api.invokeButton).not.toHaveBeenCalled();
});

test('stale one-click metadata must be reviewed and clicked again even when the current Button has no prompt', async () => {
  api.list.mockResolvedValue({ items: [] });
  api.resolveButton.mockResolvedValue({ automation_id: 'r', enabled: true, revision: 9, connectors: [] });
  api.invokeButton
    .mockRejectedValueOnce({ code: 1008, diagnosticMessage: 'Invalid request:automation_revision_conflict:r:9' })
    .mockResolvedValue('accepted');
  render(
    <ButtonControl
      workspace='w'
      database='d'
      row='one'
      field='send'
      initialClickId='gesture'
      caps={{ ...extended, buttonInteractions: true }}
    />
  );
  fireEvent.click(await screen.findByText('Reload saved version'));
  const reviewed = await screen.findByText('Run now');

  expect(api.invokeButton).toHaveBeenCalledTimes(1);
  fireEvent.click(reviewed);
  await screen.findByText('Run queued.');
  expect(api.invokeButton.mock.calls[0][4].request_id).toBe('gesture');
  expect(api.invokeButton.mock.calls[1][4].request_id).not.toBe('gesture');
});

test.each(['declined capability', 'requires confirmation', 'requires connection', 'disabled'])(
  'a cell gesture waits for review when %s',
  async (variant) => {
    api.list.mockResolvedValue({ items: [] });
    api.resolveButton.mockResolvedValue({
      automation_id: 'r',
      enabled: variant !== 'disabled',
      revision: 1,
      connectors: variant === 'requires connection' ? [{ action_index: 0, kind: 'gmail' }] : [],
      ...(variant === 'requires confirmation' ? { confirmation: 'Review?' } : {}),
    });
    jest.mocked(listConnections).mockResolvedValue([]);
    render(
      <ButtonControl
        workspace='w'
        database='d'
        row='one'
        field='send'
        initialClickId='click'
        caps={{ ...extended, buttonInteractions: variant !== 'declined capability' }}
      />
    );
    await screen.findByText(variant === 'disabled' ? 'This automation is disabled.' : 'Run now');
    expect(api.invokeButton).not.toHaveBeenCalled();
  }
);

test.each(['close', 'row', 'member'])(
  'changing %s during resolution discards the original cell click',
  async (change) => {
    const field = interactiveButtonField();
    const binding = { automation_id: 'bound', revision: 1, enabled: true, connectors: [] };
    let resolve!: (value: typeof binding) => void;

    api.list.mockResolvedValue({ items: [] });
    api.resolveButton.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const view = (row: string) => <ButtonCell field={field} fieldId='send' rowId={row} />;
    const { rerender } = render(view('one'));

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.resolveButton).toHaveBeenCalledTimes(1));
    if (change === 'member') {
      jest
        .mocked(useCurrentUserOptional)
        .mockReturnValue({ uuid: 'new member' } as ReturnType<typeof useCurrentUserOptional>);
      rerender(view('one'));
    } else if (change === 'row') {
      rerender(view('two'));
    } else {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    }

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => resolve(binding));
    expect(api.invokeButton).not.toHaveBeenCalled();
    expect(api.resolveButton).toHaveBeenCalledTimes(1);
  }
);

test('typed operands, aliases and template parts offer values the Worker can actually read', () => {
  const fields = [
    { id: 'button', name: 'Run', type: FieldType.Button },
    { id: 'title', name: 'Task', type: FieldType.RichText },
    { id: 'cost', name: 'Cost', type: FieldType.Number },
    { id: 'due', name: 'Due', type: FieldType.DateTime },
    { id: 'related', name: 'Related rows', type: FieldType.Relation },
    { id: 'virtual', name: 'Calculated', type: FieldType.Formula },
  ];
  const previous = [
    { type: 'define_variable', name: 'pages', value: { kind: 'field', field_id: 'related' } },
    { type: 'define_variable', name: 'renamedPages', value: { kind: 'variable', name: 'pages' } },
    {
      type: 'define_variable',
      name: 'total',
      value: {
        kind: 'formula',
        value: { operator: 'add', left: { kind: 'number', value: 1 }, right: { kind: 'number', value: 2 } },
      },
    },
    { type: 'define_variable', name: 'scalar', value: { kind: 'expression', expression: '1 + 2' } },
  ] as RuleAction[];
  const change = jest.fn();
  const editor = (literals: string[], value: PropertyValue, row = true, definition = false) => (
    <SourceValue {...{ fields, previous, literals, value, change, definition }} expressionFields={row ? fields : []} />
  );
  const options = (label: string) =>
    Array.from(screen.getByLabelText(label).options)
      .map((o) => o.value)
      .filter(Boolean);
  const typed = (operator: 'add' | 'add_days'): PropertyValue => ({
    kind: 'formula',
    value: { operator, left: { kind: 'number', value: 1 }, right: { kind: 'number', value: 2 } },
  });
  const ui = render(editor(['number'], { kind: 'field', field_id: 'cost' }));

  expect(options('Value')).toEqual(['cost']);
  ui.rerender(editor(['number'], { kind: 'variable', name: 'total' }));
  expect(options('Value')).toEqual(['total', 'scalar']);
  ui.rerender(editor(['relation'], { kind: 'variable', name: 'pages' }));
  expect(options('Value')).toEqual(['pages', 'renamedPages']);
  ui.rerender(editor(['text'], { kind: 'text', value: '' }, false));
  expect(options('Value source')).not.toContain('field');
  ui.rerender(editor(['text'], { kind: 'field', field_id: 'related' }, true, true));
  expect(options('Value')).toEqual(['title', 'cost', 'due', 'related']);
  ui.rerender(editor(['number'], typed('add')));
  expect(options(strings.databaseAutomation.operator)).toEqual(['add', 'subtract', 'multiply', 'divide']);
  ui.rerender(editor(['date_time'], typed('add_days')));
  expect(options(strings.databaseAutomation.operator)).toEqual(['add_days']);
  ui.rerender(editor(['number', 'date_time'], typed('add'), true, true));
  fireEvent.change(screen.getByLabelText(strings.databaseAutomation.operator), { target: { value: 'add_days' } });
  expect(change).toHaveBeenLastCalledWith({
    kind: 'formula',
    value: { operator: 'add_days', left: { kind: 'event_time' }, right: { kind: 'number', value: 2 } },
  });
  ui.rerender(
    <TextFields
      label='Message'
      value={{ parts: [{ type: 'field', field_id: 'title' }] }}
      fields={fields}
      previous={previous}
      change={change}
    />
  );
  expect(options('Value')).toEqual(['title', 'cost', 'due', 'related']);
  ui.rerender(
    <TextFields
      label='Message'
      value={{ parts: [{ type: 'text', value: '' }] }}
      fields={[]}
      previous={previous}
      change={change}
    />
  );
  expect(options('Value source')).not.toContain('field');
});

test('rich text saves stable choices and a formula using the triggering row in an eligible action', async () => {
  const id = '825119c1-c9e1-4bcd-b54c-b31ba43ee9de';
  const writes = jest.fn();

  jest
    .mocked(getWorkspaceGroups)
    .mockResolvedValue({ groups: [{ group_id: id, name: 'Reviewers' }] } as Awaited<
      ReturnType<typeof getWorkspaceGroups>
    >);
  function Editor() {
    const [value, update] = useState<AutomationText>({ parts: [{ type: 'text', value: '' }] });

    return (
      <RichActionContext.Provider value={{ workspace: 'w', rich: true, related: true }}>
        <TextFields
          label='Message'
          value={value}
          fields={[{ id: 'related', name: 'Projects', type: FieldType.Relation }]}
          previous={[]}
          change={(v) => {
            writes(v);
            update(v);
          }}
        />
      </RichActionContext.Provider>
    );
  }

  render(<Editor />);
  fireEvent.change(screen.getByLabelText('Value source'), { target: { value: 'group' } });
  const option = await screen.findByRole('option', { name: 'Reviewers' });

  fireEvent.change(option.parentElement!, { target: { value: id } });
  expect(getWorkspaceGroups).toHaveBeenCalledWith('w');
  expect(writes).toHaveBeenLastCalledWith({ parts: [{ type: 'group', group_id: id }] });
  fireEvent.click(screen.getByRole('button', { name: strings.databaseAutomation.addPart }));
  fireEvent.change(screen.getAllByLabelText('Value source')[1], { target: { value: 'expression' } });
  expect((screen.getByRole('option', { name: 'Projects' })).value).toBe('related');
  fireEvent.change(screen.getByLabelText('Formula expression'), { target: { value: 'prop("related").length()' } });
  expect(writes).toHaveBeenLastCalledWith({
    parts: [
      { type: 'group', group_id: id },
      { type: 'expression', expression: 'prop("related").length()' },
    ],
  });
});
test('a mention search uses the current workspace and type, and ignores an older outstanding lookup', async () => {
  const build = (name: string, id: string) =>
    ({ sections: [{ items: [{ title: name, mention: { type: 'page', page_id: id } }] }] } as unknown as Awaited<
      ReturnType<typeof searchMentions>
    >);
  let deliver!: (value: Awaited<ReturnType<typeof searchMentions>>) => void;

  jest
    .mocked(searchMentions)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        })
    )
    .mockResolvedValueOnce(build('New page', 'new-id'));
  const change = jest.fn();
  const show = (workspace: string) => (
    <RichActionContext.Provider value={{ workspace, rich: true, related: false }}>
      <TextFields
        label='Message'
        value={{ parts: [{ type: 'page', view_id: '' }] }}
        fields={[]}
        previous={[]}
        change={change}
      />
    </RichActionContext.Provider>
  );
  const view = render(show('first'));

  await waitFor(() => expect(searchMentions).toHaveBeenCalledTimes(1));
  view.rerender(show('second'));
  expect(await screen.findByRole('option', { name: 'New page' })).toBeTruthy();
  expect(jest.mocked(searchMentions).mock.calls[0][2]?.signal?.aborted).toBe(true);
  await act(async () => deliver(build('Old page', 'old-id')));
  expect(screen.queryByRole('option', { name: 'Old page' })).toBeNull();
  expect(searchMentions).toHaveBeenLastCalledWith(
    'second',
    { query: '', include: ['page', 'database'], limit: 20 },
    expect.anything()
  );
});
test('capabilities protect older clients and validate rich text dates, IDs, schedules and action-specific fields', () => {
  const rich = ruleCapabilities({
    enable_database_automations: true,
    database_automation_triggers: ['row_created'],
    database_automation_actions: ['notify', 'define_variable'],
    database_automation_value_features: ['rich_action_text_v1', 'formula_related_inputs_v1'],
  } as ServerInfo);

  function withParts(parts: TextPart[]) {
    return {
      ...rule,
      actions: [{ type: 'notify', user_ids: ['825119c1-c9e1-4bcd-b54c-b31ba43ee9de'], message_template: { parts } }],
    };
  }

  const id = '825119c1-c9e1-4bcd-b54c-b31ba43ee9de';
  const saved = withParts([
    { type: 'date', value: '2028-02-29' },
    { type: 'date' },
    { type: 'page', view_id: id },
    { type: 'group', group_id: id },
    { type: 'person', user_id: id },
  ]);

  expect(canEditRule(saved, caps)).toBe(false);
  expect(canEditRule(saved, rich)).toBe(true);
  expect(validRule(saved)).toBe(true);
  for (const part of [
    { type: 'date', value: '2027-02-29' },
    { type: 'group', group_id: 'label' },
    { type: 'expression', expression: '' },
  ] as TextPart[])
    expect(validRule(withParts([part]))).toBe(false);
  const template = { parts: [{ type: 'date' } as TextPart] };

  expect(
    validRule({ ...rule, actions: [{ type: 'slack', connection_id: id, channel_id: 'test', message: template }] })
  ).toBe(false);
  expect(
    validRule({
      ...rule,
      actions: [{ type: 'connected_email', connection_id: id, to: [template], message: 'ok', subject: 'subject' }],
    })
  ).toBe(false);
  const scheduled = (expression: string) => ({
    ...withParts([{ type: 'expression', expression }]),
    trigger: { type: 'scheduled' },
  });

  expect(scheduleRequiresSourceRow(scheduled('now()'))).toBe(false);
  expect(scheduleRequiresSourceRow(scheduled('prop("related").length()'))).toBe(true);
});
