import { parseRuleList, ruleApi, RuleDefinition } from '../automation-api';
import { getAxios } from '../core';

jest.mock('../core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: (f: () => Promise<unknown>) => f(),
  executeAPIVoidRequest: (f: () => Promise<unknown>) => f(),
}));

it('addresses row setup, resolution and invocation by escaped path segments and preserves ordinary rules', async () => {
  const http = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
  jest.mocked(getAxios).mockReturnValue(http as unknown as ReturnType<typeof getAxios>);
  const rules = '/api/workspace/w%2Fx/database/d%20b/row/r%3F1/automation';
  const button = '/api/workspace/w%2Fx/database/d%20b/row/r%3F1/button/field%2F%23';
  const [workspace, database, row, field] = ['w/x', 'd b', 'r?1', 'field/#'];
  const signal = new AbortController().signal;
  const draft = { name: 'Review', trigger: { type: 'button', field_id: field } } as RuleDefinition;
  await ruleApi.list(workspace, database, signal, row);
  expect(http.get).toHaveBeenCalledWith(rules, { signal, transformResponse: [parseRuleList] });
  await ruleApi.get(workspace, database, 'rule', signal, row);
  expect(http.get).toHaveBeenCalledWith(rules + '/rule', { signal });
  await ruleApi.create(workspace, database, 'rule', draft, row);
  expect(http.post).toHaveBeenCalledWith(rules, { id: 'rule', ...draft });
  await ruleApi.patch(workspace, database, 'rule', 4, { enabled: false }, row);
  expect(http.patch).toHaveBeenCalledWith(rules + '/rule', { expected_revision: 4, enabled: false });
  await ruleApi.remove(workspace, database, 'rule', 5, row);
  expect(http.delete).toHaveBeenCalledWith(rules + '/rule', { params: { expected_revision: 5 } });
  await ruleApi.resolveButton(workspace, database, row, field, signal);
  expect(http.get).toHaveBeenCalledWith(button, { signal });
  const body = {
    automation_id: 'bound',
    request_id: 'request',
    expected_revision: 12,
    connections: [{ action_index: 1, connection_id: 'mine' }],
  };
  await ruleApi.invokeButton(workspace, database, row, field, body);
  expect(http.post).toHaveBeenCalledWith(button + '/run', body);
  await ruleApi.get(workspace, database, 'rule');
  expect(http.get).toHaveBeenLastCalledWith('/api/workspace/w%2Fx/database/d%20b/automation/rule', {
    signal: undefined,
  });
});
