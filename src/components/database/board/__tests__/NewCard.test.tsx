import { act, fireEvent, render, screen } from '@testing-library/react';

import NewCard from '@/components/database/components/board/card/NewCard';

const mockCreate = jest.fn();

jest.mock('@/application/database-yjs', () => ({ usePrimaryFieldId: () => 'name' }));
jest.mock('@/application/database-yjs/dispatch', () => ({ useNewRowDispatch: () => mockCreate }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/errors', () => ({ getErrorMessage: () => 'Creation failed' }));
jest.mock('@/utils/log', () => ({ Log: { error: jest.fn() } }));

test.each([false, true])('keeps keyboard focus through creation (failure: %s)', async (failure) => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;

  mockCreate.mockReset();
  mockCreate.mockReturnValue(new Promise<string>((yes, no) => { resolve = yes; reject = no; }));
  render(<NewCard fieldId='status' columnId='todo' isCreating setIsCreating={jest.fn()} />);
  const input = screen.getByRole<HTMLInputElement>('textbox');

  input.focus();
  fireEvent.change(input, { target: { value: 'First card' } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
  expect(input.readOnly).toBe(true);
  expect(input.disabled).toBe(false);
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
  expect(mockCreate).toHaveBeenCalledTimes(1);

  await act(async () => {
    if (failure) reject(new Error('offline'));
    else resolve('created');
  });
  expect(input.readOnly).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe(failure ? 'First card' : '');
});
