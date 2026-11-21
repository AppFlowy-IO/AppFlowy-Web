import { parseRuleList, ruleApi, RuleDefinition } from '../automation-api';
import { getAxios } from '../core';

jest.mock('../core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: (f: () => Promise<unknown>) => f(),
  executeAPIVoidRequest: (f: () => Promise<unknown>) => f(),
}));

it('addresses row setup, resolution and invocation by escaped path segments and preserves ordinary rules', async () => {
  const http = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };
  jest.mocked(getAxios).mockReturnValue(http as unknown as ReturnType<typeof getAxios>);
  const rules = '/api/workspace/w%2Fx/database/d%20b/row/r%3F1/automation';
  const button = '/api/workspace/w%2Fx/database/d%20b/row/r%3F1/button/field%2F%23';
  const [workspace, database, row, field] = ['w/x', 'd b', 'r?1', 'field/#'];
  const signal = new AbortController().signal;
  const draft = { name: 'Review', trigger: { type: 'button', field_id: field } } as RuleDefinition;
  await ruleApi.list(workspace, database, signal, row);
  expect(http.get).toHaveBeenCalledWith(rules, { timeout: 30_000, signal, transformResponse: [parseRuleList] });
  await ruleApi.get(workspace, database, 'rule', signal, row);
  expect(http.get).toHaveBeenCalledWith(rules + '/rule', { timeout: 30_000, signal });
  await ruleApi.create(workspace, database, 'rule', draft, row);
  expect(http.post).toHaveBeenCalledWith(rules, { id: 'rule', ...draft }, { timeout: 30_000 });
  await ruleApi.patch(workspace, database, 'rule', 4, { enabled: false }, row);
  expect(http.patch).toHaveBeenCalledWith(
    rules + '/rule',
    { expected_revision: 4, enabled: false },
    { timeout: 30_000 }
  );
  await ruleApi.remove(workspace, database, 'rule', 5, row);
  expect(http.delete).toHaveBeenCalledWith(rules + '/rule', { timeout: 30_000, params: { expected_revision: 5 } });
  await ruleApi.resolveButton(workspace, database, row, field, signal);
  expect(http.get).toHaveBeenCalledWith(button, { timeout: 30_000, signal });
  const body = {
    automation_id: 'bound',
    request_id: 'request',
    expected_revision: 12,
    connections: [{ action_index: 1, connection_id: 'mine' }],
  };
  await ruleApi.invokeButton(workspace, database, row, field, body);
  expect(http.post).toHaveBeenCalledWith(button + '/run', body, { timeout: 30_000 });
  await ruleApi.get(workspace, database, 'rule', signal, row);
  expect(http.get).toHaveBeenLastCalledWith(rules + '/rule', { timeout: 30_000, signal });
  await ruleApi.runs(workspace, database, 'rule', 53, signal, false, row);
  expect(http.get).toHaveBeenLastCalledWith(rules + '/rule/runs', {
    timeout: 30_000,
    params: { before: 53, limit: 25 },
    signal,
  });
  await ruleApi.getSchedule(workspace, database, 'rule', signal, row);
  expect(http.get).toHaveBeenLastCalledWith(rules + '/rule/schedule', { timeout: 30_000, signal });
  const calendar = {
    row_id: row,
    frequency: 'daily' as const,
    starts_on: '2026-11-18',
    local_time: '09:00:00',
    timezone: 'UTC',
  };

  await ruleApi.putSchedule(workspace, database, 'rule', 7, calendar, row);
  expect(http.put).toHaveBeenLastCalledWith(
    rules + '/rule/schedule',
    { ...calendar, expected_revision: 7 },
    { timeout: 30_000 }
  );
  await ruleApi.run(workspace, database, 'rule', 9, row, 'retry', row);
  expect(http.post).toHaveBeenLastCalledWith(
    rules + '/rule/run',
    {
      row_id: row,
      expected_revision: 9,
      request_id: 'retry',
    },
    { timeout: 30_000 }
  );
  await ruleApi.get(workspace, database, 'rule');
  expect(http.get).toHaveBeenLastCalledWith('/api/workspace/w%2Fx/database/d%20b/automation/rule', {
    timeout: 30_000,
    signal: undefined,
  });
  await ruleApi.createWebhook(workspace, 'deliver', 'https://example.org', undefined, 'receipt');
  expect(http.post).toHaveBeenLastCalledWith(
    '/api/workspace/w%2Fx/automation-webhooks',
    {
      name: 'deliver',
      url: 'https://example.org',
      request_id: 'receipt',
    },
    { timeout: 30_000 }
  );
  await ruleApi.rotateWebhook(workspace, 'endpoint', 4);
  expect(http.post).toHaveBeenLastCalledWith('/api/workspace/w%2Fx/automation-webhooks/endpoint/rotate', undefined, {
    timeout: 30_000,
    params: { expected_version: 4 },
  });
});
