import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { applyFilterUpdate, UpdateFilterParams } from '@/application/database-yjs/dispatch/filter-update';
import { DateFilter, DateFilterCondition as C } from '@/application/database-yjs/fields/date/date.type';
import { parseFilter } from '@/application/database-yjs/filter';
import {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YjsDatabaseKey as K,
} from '@/application/types';
import { updateServerInfo, SERVER_INFO_LOADING } from '@/utils/server-info';

import { ConditionSelector, ValueInput } from '../advanced/FilterControls';
import DateTimeFilterMenu from '../filter-menu/DateTimeFilterMenu';
import { useFilterChipLabel } from '../overview/useFilterChipLabel';

let mockFields: YDatabaseFields;
let mockFilters: YDatabaseFilters;
let mockField: YDatabaseField;
let mockReadOnly = false;
const mockUpdate = jest.fn((params: UpdateFilterParams) =>
  mockFilters.doc?.transact(() => applyFilterUpdate(mockFilters, mockFields, params))
);

jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useReadOnly: () => mockReadOnly,
  useConditionsReadOnly: () => mockReadOnly,
}));
jest.mock('@/application/database-yjs/selector', () => ({
  useFieldSelector: () => ({ field: mockField }),
  useFieldType: () => FieldType.DateTime,
  useFormulaResultType: () => 'date',
}));
jest.mock('@/application/database-yjs/dispatch/sort-filter', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch/sort-filter'),
  useUpdateFilter: () => mockUpdate,
  useUpdateAdvancedFilter: () => mockUpdate,
}));
jest.mock('@/components/database/components/filters/filter-menu/FieldMenuTitle', () => ({
  __esModule: true,
  default: ({ renderConditionSelect }: { renderConditionSelect: React.ReactNode }) => <div>{renderConditionSelect}</div>,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => undefined }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function setup(condition = C.DateStartsBefore, content = '{"timestamp":1700000000}') {
  const doc = new Y.Doc();

  mockFields = doc.getMap('fields') as YDatabaseFields;
  mockField = new Y.Map() as YDatabaseField;
  mockFields.set('date', mockField);
  mockField.set(K.type, FieldType.DateTime);
  mockFilters = doc.getArray('filters') as YDatabaseFilters;
  const node = new Y.Map() as YDatabaseFilter;

  mockFilters.push([node]);
  node.set(K.id, 'rule');
  node.set(K.field_id, 'date');
  node.set(K.filter_type, FilterType.Data);
  node.set(K.condition, condition);
  node.set(K.content, content);
  return node;
}

function Harness({ advanced }: { advanced: boolean }) {
  const [, update] = useState(0);

  useEffect(() => {
    const change = () => update((count) => count + 1);

    mockFilters.observeDeep(change);
    return () => mockFilters.unobserveDeep(change);
  }, []);
  const filter = parseFilter(FieldType.DateTime, mockFilters.get(0)) as DateFilter;
  const label = useFilterChipLabel(filter);

  return (
    <>
      <output data-testid='summary'>{label.description}</output>
      {advanced ? (
        <>
          <ConditionSelector
            filter={filter}
            fieldType={FieldType.DateTime}
            disabled={mockReadOnly}
            onConditionChange={(condition) => mockUpdate({ filterId: filter.id, condition })}
          />
          <ValueInput filter={filter} fieldType={FieldType.DateTime} disabled={mockReadOnly} />
        </>
      ) : (
        <DateTimeFilterMenu filter={filter} />
      )}
    </>
  );
}

beforeAll(() => {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
  global.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  updateServerInfo('https://test.appflowy.cloud', {
    status: 'available',
    info: { enable_page_history: false, enable_relative_date_comparisons: true },
  });
  mockReadOnly = false;
  mockUpdate.mockClear();
});
afterEach(() => updateServerInfo('https://test.appflowy.cloud', SERVER_INFO_LOADING));

describe.each([false, true])('relative date editor (advanced=%s)', (advanced) => {
  const pickerId = advanced ? 'advanced-filter-date-input' : 'date-filter-date-picker';
  const conditionId = advanced ? 'filter-condition-selector' : 'filter-condition-trigger';
  const changeCondition = async (condition: C) => {
    fireEvent.pointerDown(screen.getByTestId(conditionId), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByTestId(`filter-condition-${condition}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`filter-condition-${condition}`));
  };

  it('hides new values without rollout authorization while preserving legacy Today', async () => {
    updateServerInfo('https://test.appflowy.cloud', SERVER_INFO_LOADING);
    const node = setup();

    render(<Harness advanced={advanced} />);
    fireEvent.click(screen.getByTestId(pickerId));
    expect(screen.queryByTestId('date-filter-relative-today')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('datetime-date-input'), { key: 'Escape' });
    await changeCondition(C.DateStartsToday);
    expect(node.get(K.condition)).toBe(C.DateStartsToday);
    expect(node.get(K.content)).toBe('');
    await changeCondition(C.DateStartsBefore);
    expect(node.get(K.content)).toBe('');
    expect(screen.getByTestId(pickerId).textContent).toBe('grid.dateFilter.chooseDate');
  });

  it('reacts to capability revocation with an editor open and keeps received filters readable', () => {
    const node = setup(C.DateStartsBefore, '{"relative_date":"Today"}');

    render(<Harness advanced={advanced} />);
    fireEvent.click(screen.getByTestId(pickerId));
    act(() => updateServerInfo('https://test.appflowy.cloud', { status: 'unavailable' }));
    expect(screen.queryByTestId('date-filter-relative-today')).toBeNull();
    expect(screen.getByTestId(pickerId).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId(conditionId).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('summary').textContent).toContain('before relativeDates.today');
    fireEvent.click(screen.getByRole('gridcell', { name: '15', exact: true }));
    expect(node.get(K.content)).toBe('{"relative_date":"Today"}');
    act(() =>
      updateServerInfo('https://test.appflowy.cloud', {
        status: 'available',
        info: { enable_page_history: false, enable_relative_date_comparisons: true },
      })
    );
    expect(screen.getByTestId('date-filter-relative-tomorrow')).toBeTruthy();
    fireEvent.click(screen.getByTestId('date-filter-relative-tomorrow'));
    expect(node.get(K.content)).toBe('{"relative_date":"Tomorrow"}');
  });

  it('chooses each relative day, retains it on operator edits, and switches back to a calendar date', async () => {
    const node = setup();

    render(<Harness advanced={advanced} />);
    fireEvent.click(screen.getByTestId(pickerId));
    for (const day of ['Today', 'Yesterday', 'Tomorrow']) {
      fireEvent.click(screen.getByTestId(`date-filter-relative-${day.toLowerCase()}`));
      expect(JSON.parse(node.get(K.content))).toEqual({ relative_date: day });
      expect(node.get(K.condition)).toBe(C.DateStartsBefore);
      expect(screen.getByTestId(pickerId).textContent).toBe(`relativeDates.${day.toLowerCase()}`);
      expect(screen.getByTestId('summary').textContent).toBe(
        `grid.dateFilter.choicechipPrefix.before relativeDates.${day.toLowerCase()}`
      );
    }

    fireEvent.keyDown(screen.getByTestId('datetime-date-input'), { key: 'Escape' });
    await changeCondition(C.DateStartsOnOrAfter);
    expect(JSON.parse(node.get(K.content))).toEqual({ relative_date: 'Tomorrow' });
    expect(screen.getByTestId('summary').textContent).toContain('onOrAfter relativeDates.tomorrow');
    fireEvent.click(screen.getByTestId(pickerId));
    const fixedDay = dayjs().add(1, 'day').date(15);

    fireEvent.click(screen.getByRole('gridcell', { name: fixedDay.format('D'), exact: true }));
    expect(JSON.parse(node.get(K.content))).toEqual({ timestamp: fixedDay.startOf('day').unix() });
    expect(screen.getByTestId(pickerId).textContent).not.toContain('relativeDates.');
  });

  it('converts legacy Today when changing comparison and clears it for Between', async () => {
    const node = setup(C.DateStartsToday, '');

    render(<Harness advanced={advanced} />);
    await changeCondition(C.DateStartsAfter);
    expect(JSON.parse(node.get(K.content))).toEqual({ relative_date: 'Today' });
    await changeCondition(C.DateStartsBetween);
    fireEvent.click(screen.getByTestId(pickerId));
    expect(screen.queryByTestId('date-filter-relative-today')).toBeNull();
    expect(screen.getAllByTestId('datetime-date-input')).toHaveLength(2);
    expect(node.get(K.content)).not.toContain('relative_date');
  });

  it('reflects remote changes and prevents edits when read-only', async () => {
    const node = setup();
    const view = render(<Harness advanced={advanced} />);

    await act(() => mockUpdate({ filterId: 'rule', content: '{"relative_date":"Yesterday"}' }));
    expect(screen.getByTestId(pickerId).textContent).toBe('relativeDates.yesterday');
    mockReadOnly = true;
    view.rerender(<Harness advanced={advanced} />);
    fireEvent.click(screen.getByTestId(pickerId));
    expect(screen.queryByTestId('date-filter-relative-today')).toBeNull();
    expect(JSON.parse(node.get(K.content))).toEqual({ relative_date: 'Yesterday' });
  });
});

it('keeps Before Today when the simple editor switches from start to end', async () => {
  const node = setup(C.DateStartsBefore, '{"relative_date":"Today"}');

  render(<Harness advanced={false} />);
  fireEvent.pointerDown(screen.getByTestId('date-filter-start-end-select'), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });
  await waitFor(() => expect(screen.getByRole('menuitem', { name: 'grid.dateFilter.endDate' })).toBeTruthy());
  fireEvent.click(screen.getByRole('menuitem', { name: 'grid.dateFilter.endDate' }));
  expect(node.get(K.condition)).toBe(C.DateEndsBefore);
  expect(JSON.parse(node.get(K.content))).toEqual({ relative_date: 'Today' });
  expect(screen.getByTestId('summary').textContent).toBe('grid.dateFilter.choicechipPrefix.before relativeDates.today');
});
