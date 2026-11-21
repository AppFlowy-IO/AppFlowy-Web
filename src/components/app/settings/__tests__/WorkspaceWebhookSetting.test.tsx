import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ruleApi } from '@/application/services/js-services/http/automation-api';
import { WorkspaceWebhookSetting } from '@/components/app/settings/WorkspaceWebhookSetting';

const mockTranslate = (key: string) => key;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/application/services/js-services/http/automation-api', () => ({
  ruleApi: { workspaceWebhookPolicy: jest.fn(), setWorkspaceWebhookPolicy: jest.fn() },
}));

const load = jest.mocked(ruleApi.workspaceWebhookPolicy);
const save = jest.mocked(ruleApi.setWorkspaceWebhookPolicy);

beforeEach(() => jest.resetAllMocks());

test('loads the current workspace setting and persists disable and re-enable', async () => {
  load.mockResolvedValue({ disable_automation_webhooks: false });
  save.mockImplementation(async (_workspace, disabled) => ({ disable_automation_webhooks: disabled }));
  render(<WorkspaceWebhookSetting workspace='one' />);
  const control = screen.getByRole('switch');

  await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(control);
  await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('false'));
  fireEvent.click(control);
  await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'));
  expect(save.mock.calls).toEqual([['one', true], ['one', false]]);
});

test('reloads a failed read and preserves the saved switch position after a rejected change', async () => {
  load.mockRejectedValueOnce(new Error('read failed')).mockResolvedValue({ disable_automation_webhooks: true });
  save.mockRejectedValue(new Error('write failed'));
  render(<WorkspaceWebhookSetting workspace='two' />);
  fireEvent.click(await screen.findByRole('button', { name: 'databaseAutomation.retryWebhookPolicy' }));
  const control = screen.getByRole('switch');

  await waitFor(() => expect(control.hasAttribute('disabled')).toBe(false));
  fireEvent.click(control);
  await screen.findByRole('alert');
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(save).toHaveBeenCalledWith('two', false);
});

test('a pending read from the previous workspace cannot overwrite the active setting', async () => {
  let finish: (settings: { disable_automation_webhooks: boolean }) => void = () => undefined;

  load.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue({ disable_automation_webhooks: true });
  const view = render(<WorkspaceWebhookSetting key='one' workspace='one' />);

  view.rerender(<WorkspaceWebhookSetting key='two' workspace='two' />);
  const control = screen.getByRole('switch');

  await waitFor(() => expect(control.hasAttribute('disabled')).toBe(false));
  await act(async () => finish({ disable_automation_webhooks: false }));
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(load.mock.calls[0][1]?.aborted).toBe(true);
  expect(save).not.toHaveBeenCalled();
});
