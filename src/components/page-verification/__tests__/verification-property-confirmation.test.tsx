import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import { YjsDatabaseKey } from '@/application/types';
import { PropertyMutationConfirm } from '@/components/database/components/property/PropertyMutationConfirm';

const mockField = new Map<string, unknown>();
let mockVerification: { remove: jest.Mock; clear: jest.Mock };
const mockDelete = jest.fn();
const mockClear = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/database-yjs', () => ({
  FieldType: jest.requireActual('@/application/database-yjs/database.type').FieldType,
  useFieldSelector: () => ({ field: mockField }),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useDeletePropertyDispatch: () => mockDelete,
  useClearCellsWithFieldDispatch: () => mockClear,
}));
jest.mock('@/application/page-verification/database', () => ({
  useDatabaseVerification: () => mockVerification,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockField.set(YjsDatabaseKey.type, FieldType.Verification);
  mockVerification = { remove: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) };
});

it.each(['delete', 'clear'] as const)(
  'keeps the captured lifecycle action when a %s confirmation sees a replacement property',
  async (kind) => {
    const captured = kind === 'delete' ? mockVerification.remove : mockVerification.clear;
    const close = jest.fn();
    const { rerender } = render(<PropertyMutationConfirm fieldId='field' kind={kind} onClose={close} />);

    mockVerification = { remove: jest.fn(), clear: jest.fn() };
    rerender(<PropertyMutationConfirm fieldId='field' kind={kind} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: `button.${kind}` }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(captured).toHaveBeenCalledTimes(1);
    expect(mockVerification.remove).not.toHaveBeenCalled();
    expect(mockVerification.clear).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  }
);

it('keeps a rejected native mutation open and shows its error', async () => {
  mockVerification.remove.mockRejectedValue(new Error('Property generation changed'));
  const close = jest.fn();

  render(<PropertyMutationConfirm fieldId='field' kind='delete' onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'button.delete' }));
  await screen.findByText('Property generation changed');
  expect(close).not.toHaveBeenCalled();
  expect(mockDelete).not.toHaveBeenCalled();
});

it('retains ordinary property deletion behavior', async () => {
  mockField.set(YjsDatabaseKey.type, FieldType.Number);
  render(<PropertyMutationConfirm fieldId='field' kind='delete' onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'button.delete' }));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('field'));
  expect(mockVerification.remove).not.toHaveBeenCalled();
});
