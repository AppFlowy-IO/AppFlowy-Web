import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { ruleApi } from '@/application/services/js-services/http/automation-api';

import { failureRuleSearch } from '../failure-link';
import { FailureRuleDialog } from '../FailureRuleDialog';

const database = 'bcbbf78c-9f95-45a8-b79d-1573a789da37';
const rule = 'bbdd71d4-01db-44d4-adb4-862f8ef55962';
const row = 'bec03fe2-a539-43cf-b70b-44167e356507';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ workspaceId: 'workspace' }),
  useDatabase: () => ({ get: () => database }),
  useDatabaseView: () => undefined,
  usePropertiesSelector: () => ({ properties: [] }),
}));
jest.mock('../useAutomationCapabilities', () => ({
  useAutomationCapabilities: () => ({ enabled: true, rowScoped: true }),
}));
jest.mock('@/application/services/js-services/http/automation-api', () => ({ ruleApi: { get: jest.fn() } }));
jest.mock('../AutomationEditor', () => ({
  RuleForm: ({ base, rowScope, back }: { base: { name: string }; rowScope?: string; back: () => void }) => (
    <button onClick={back}>
      {base.name} {rowScope}
    </button>
  ),
}));

function Location() {
  return <output>{useLocation().search}</output>;
}

function dialog(query: string) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/app/workspace/view?' + query]}
    >
      <FailureRuleDialog />
      <Location />
    </MemoryRouter>
  );
}

beforeEach(() => jest.resetAllMocks());

it('loads the current row-scoped definition and preserves other query parameters on close', async () => {
  (ruleApi.get as jest.Mock).mockResolvedValue({ name: 'Current rule' });
  dialog('keep=yes&' + failureRuleSearch({ database_id: database, automation_id: rule, scope_row_id: row }));
  fireEvent.click(await screen.findByRole('button', { name: 'Current rule ' + row }));
  expect(ruleApi.get).toHaveBeenCalledWith('workspace', database, rule, expect.any(AbortSignal), row);
  await waitFor(() => expect(screen.getByText('?keep=yes')).toBeTruthy());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows a denied or missing rule without opening a blank editor', async () => {
  (ruleApi.get as jest.Mock).mockRejectedValue(new Error('revoked'));
  dialog(String(failureRuleSearch({ database_id: database, automation_id: rule })));
  expect((await screen.findByRole('alert')).textContent).toBe('databaseAutomation.loadError');
  expect(ruleApi.get).toHaveBeenCalledWith('workspace', database, rule, expect.any(AbortSignal), undefined);
  expect(screen.queryByRole('button', { name: /Current rule/ })).toBeNull();
});

it('does not fetch a rule for another database or an invalid row scope', () => {
  expect(failureRuleSearch({ database_id: database, automation_id: rule, scope_row_id: 'bad' })).toBeUndefined();
  dialog('automationDatabase=' + row + '&automationId=' + rule);
  expect(ruleApi.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
