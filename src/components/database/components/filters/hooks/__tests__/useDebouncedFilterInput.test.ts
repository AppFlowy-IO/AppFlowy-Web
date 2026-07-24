import { act, renderHook } from '@testing-library/react';

import {
  FILTER_INPUT_DEBOUNCE_MS,
  useDebouncedFilterInput,
} from '@/components/database/components/filters/hooks/useDebouncedFilterInput';

jest.mock('lodash-es', () => jest.requireActual('lodash'));

describe('useDebouncedFilterInput', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('updates the local value immediately and persists only the latest value after 500 ms', () => {
    const updateFilter = jest.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedFilterInput({
        content: '',
        filterId: 'filter-1',
        fieldId: 'field-1',
        updateFilter,
      })
    );

    act(() => {
      result.current.updateValue('1');
      result.current.updateValue('12');
    });

    expect(result.current.value).toBe('12');
    expect(updateFilter).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(FILTER_INPUT_DEBOUNCE_MS - 1);
    });

    expect(updateFilter).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(updateFilter).toHaveBeenCalledTimes(1);
    expect(updateFilter).toHaveBeenCalledWith({
      filterId: 'filter-1',
      fieldId: 'field-1',
      content: '12',
    });

    unmount();
  });

  it('flushes a pending value when the input unmounts', () => {
    const updateFilter = jest.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedFilterInput({
        content: '',
        filterId: 'filter-1',
        fieldId: 'field-1',
        updateFilter,
      })
    );

    act(() => {
      result.current.updateValue('42');
    });

    expect(updateFilter).not.toHaveBeenCalled();

    unmount();

    expect(updateFilter).toHaveBeenCalledWith({
      filterId: 'filter-1',
      fieldId: 'field-1',
      content: '42',
    });
  });
});
