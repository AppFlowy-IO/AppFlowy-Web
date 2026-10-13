import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import EditWorkspace from '../EditWorkspace';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ name: 'Test' }) }));

test('a denied submission retains its name and Enter cannot bypass a refreshed denial', async () => {
  const submit = jest.fn().mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValue(undefined);
  const close = jest.fn();
  const { rerender } = render(<EditWorkspace open canSubmit onOk={submit} openOnChange={close} />);
  const input = screen.getByRole('textbox');

  fireEvent.change(input, { target: { value: 'Retained draft' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'workspace.create' }).disabled).toBe(false));
  expect(close).not.toHaveBeenCalled();
  rerender(<EditWorkspace open canSubmit={false} onOk={submit} openOnChange={close} />);
  expect((input as HTMLInputElement).value).toBe('Retained draft');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).toHaveBeenCalledTimes(1);
  rerender(<EditWorkspace open canSubmit onOk={submit} openOnChange={close} />);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(submit).toHaveBeenLastCalledWith('Retained draft');
});

test('a late completion cannot close a replacement account dialog', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => { resolve = done; });
  const close = jest.fn();
  const { unmount } = render(<EditWorkspace open onOk={() => pending} openOnChange={close} />);

  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  unmount();
  await act(async () => { resolve(); });
  expect(close).not.toHaveBeenCalled();
});

test('a dialog kept mounted while closed reopens with the suggested name it would show on first open', () => {
  const { rerender } = render(<EditWorkspace open={false} openOnChange={jest.fn()} />);

  rerender(<EditWorkspace open openOnChange={jest.fn()} />);
  expect((screen.getByRole('textbox')).value).toBe("Test's Workspace");
});

test('a secondary action sits in the footer beside the dialog buttons', () => {
  const discard = jest.fn();

  render(<EditWorkspace open openOnChange={jest.fn()} secondaryAction={<button onClick={discard}>Discard</button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(discard).toHaveBeenCalledTimes(1);
});
