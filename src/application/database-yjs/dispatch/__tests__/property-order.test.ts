import { renderHook } from '@testing-library/react';

import { useReorderPropertiesDispatch } from '../property-order';

const mockReorderColumn = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({
  useReorderColumnDispatch: () => mockReorderColumn,
}));

beforeEach(() => jest.clearAllMocks());

it('reorders the native Verification field with all other properties', () => {
  const { result } = renderHook(useReorderPropertiesDispatch);

  result.current('verification-field', ['verification-field', 'status', 'date']);
  expect(mockReorderColumn).toHaveBeenCalledWith('verification-field', undefined);
  result.current('date', ['status', 'verification-field', 'date']);
  expect(mockReorderColumn).toHaveBeenLastCalledWith('date', 'verification-field');
});

it('ignores a stale drag whose field is no longer in the order', () => {
  const { result } = renderHook(useReorderPropertiesDispatch);

  result.current('removed', ['date', 'status']);
  expect(mockReorderColumn).not.toHaveBeenCalled();
});
