/**
 * Debounce of filter text inputs (PERFORMANCE-REPORT W4 d): a dashboard
 * global filter's text value and its name wait 300 ms after the last key,
 * the desktop value (`globalFilterInputDebounce`), so every widget re-filters
 * sooner; a saved (view) filter's text value keeps its 500 ms.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  FILTER_INPUT_DEBOUNCE_MS,
  GLOBAL_FILTER_INPUT_DEBOUNCE_MS,
} from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { FilterTextValueInput } from '@/components/database/components/filters/value-controls/FilterTextValueInput';

import { GlobalFilterContent } from '../global-filters/GlobalFilterContent';
import { GlobalFilterBuilder } from '../global-filters/GlobalFilterMultiSources';

// The real debounce (the shared mock calls through at once): this file is about its timing.
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => undefined }));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: [], loading: false }),
}));

const textFilter: DashboardGlobalFilter = {
  id: 'gf-name',
  name: 'Name',
  fieldType: FieldType.RichText,
  condition: 2,
  content: '',
  targets: {},
};

function type(element: HTMLElement, value: string) {
  act(() => {
    fireEvent.change(element, { target: { value } });
  });
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('filter text input debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is the desktop value for a global filter and stays 500 ms for a saved filter', () => {
    expect(GLOBAL_FILTER_INPUT_DEBOUNCE_MS).toBe(300);
    expect(FILTER_INPUT_DEBOUNCE_MS).toBe(500);
  });

  it('applies a global filter’s typed value 300 ms after the last key', () => {
    const onChange = jest.fn();

    render(<GlobalFilterContent filter={textFilter} onChange={onChange} onSelectionChange={jest.fn()} />);
    const input = screen.getByTestId('dashboard-global-filter-content');

    type(input, 'a');
    advance(GLOBAL_FILTER_INPUT_DEBOUNCE_MS - 100);
    // Another key restarts the wait.
    type(input, 'an');
    advance(GLOBAL_FILTER_INPUT_DEBOUNCE_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    advance(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('an');
  });

  it('renames a global filter 300 ms after the last key', () => {
    const onRename = jest.fn();

    render(
      <GlobalFilterBuilder
        filter={textFilter}
        onAddAnother={jest.fn()}
        onDone={jest.fn()}
        onRemoveTarget={jest.fn()}
        onRename={onRename}
        sources={[]}
      />
    );
    type(screen.getByTestId('dashboard-global-filter-name'), 'Who');
    advance(GLOBAL_FILTER_INPUT_DEBOUNCE_MS - 1);
    expect(onRename).not.toHaveBeenCalled();
    advance(1);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename.mock.calls[0][0](textFilter)).toEqual({ ...textFilter, name: 'Who' });
  });

  it('applies a saved filter’s typed value 500 ms after the last key', () => {
    const onChange = jest.fn();

    render(
      <FilterTextValueInput content='' data-testid='saved-filter' fieldId='name' filterId='f1' onChange={onChange} />
    );
    type(screen.getByTestId('saved-filter'), 'a');
    advance(GLOBAL_FILTER_INPUT_DEBOUNCE_MS);
    expect(onChange).not.toHaveBeenCalled();
    advance(FILTER_INPUT_DEBOUNCE_MS - GLOBAL_FILTER_INPUT_DEBOUNCE_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    advance(1);
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
