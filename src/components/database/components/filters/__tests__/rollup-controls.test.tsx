import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { CalculationType, FieldType, FilterType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { applyFilterUpdate, UpdateFilterParams } from '@/application/database-yjs/dispatch/filter-update';
import { PersonFilter } from '@/application/database-yjs/fields/person/person.type';
import { parseRollupTypeOption } from '@/application/database-yjs/fields/rollup/parse';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { parseFilter } from '@/application/database-yjs/filter';
import {
  defaultRollupPredicate,
  migrateRollupFilters,
  newRollupFilterMetadata,
  rememberRollupTarget,
  rollupResultType,
} from '@/application/database-yjs/rollup/filter';
import {
  MentionablePerson,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YjsDatabaseKey as K,
  YjsEditorKey as E,
} from '@/application/types';
import { TooltipProvider } from '@/components/ui/tooltip';

import { FilterPanelRow } from '../advanced/FilterPanelRow';
import PersonFilterMenu from '../filter-menu/PersonFilterMenu';
import RollupFilterMenu from '../filter-menu/RollupFilterMenu';
import { useFilterChipLabel } from '../overview/useFilterChipLabel';

let mockDatabase: YDatabase;
let mockFields: YDatabaseFields;
let mockFilters: YDatabaseFilters;
let mockField: YDatabaseField;
let mockTarget: YDatabaseField;
let mockType: FieldType;
let mockReadOnly = false;
let mockTargetResolved = true;
let mockSelectOptions: SelectOption[] = [];
const mockUsers: MentionablePerson[] = [
  { person_id: 'alice', uid: '9007199254740993', name: 'Alice', email: 'alice@example.com' },
  { person_id: 'bob', uid: '9007199254740992', name: 'Bob', email: 'bob@elsewhere.test' },
] as MentionablePerson[];
const mockUpdate = jest.fn((params: UpdateFilterParams) => applyFilterUpdate(mockFilters, mockFields, params));
const mockRelationData = jest.fn(() => ({
  loading: false,
  selectedView: { id: 'third-view' },
  relatedDatabaseId: 'third-db',
}));
const mockNoop = jest.fn();

jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useDatabase: () => mockDatabase,
  useReadOnly: () => mockReadOnly,
}));
jest.mock('@/application/database-yjs/selector', () => ({ useFieldSelector: () => ({ field: mockField }) }));
jest.mock('@/application/database-yjs/dispatch', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch'),
  useRemoveAdvancedFilterAndRebuild: () => mockNoop,
  useUpdateAdvancedFilterAndRebuild: () => mockNoop,
  useUpdateAdvancedFilter: () => mockUpdate,
  useUpdateFilter: () => mockUpdate,
}));
jest.mock('@/application/database-yjs/dispatch/sort-filter', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch/sort-filter'),
  useUpdateAdvancedFilter: () => mockUpdate,
}));
jest.mock('@/components/database/components/property/rollup/useRollupData', () => ({
  useRollupData: () => ({
    targetField: mockTargetResolved ? { type: mockType, field: mockTarget } : undefined,
    selectOptions: mockSelectOptions,
  }),
}));
jest.mock('@/components/database/components/property/relation/useRelationData', () => ({
  useRelationData: (...args: unknown[]) => mockRelationData(...(args as [])),
}));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: mockUsers, loading: false }),
}));
jest.mock('@/components/database/components/filters/filter-menu/FieldMenuTitle', () => ({
  __esModule: true,
  default: () => <span>Rollup</span>,
}));
jest.mock('@/components/database/components/conditions/PropertiesMenu', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => undefined }));
jest.mock('@/components/database/components/cell/relation/RelationCellMenuContent', () => ({
  __esModule: true,
  default: ({ onAddRelationRowId }: { onAddRelationRowId: (id: string) => void }) => (
    <button onClick={() => onAddRelationRowId('third-row')}>Third database row</button>
  ),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

function setup(
  type = FieldType.RichText,
  showAs = RollupDisplayMode.OriginalList,
  calculation = CalculationType.Count,
  resolved = true
) {
  mockType = type;
  mockTargetResolved = resolved;
  mockSelectOptions = [];
  const doc = new Y.Doc();

  mockDatabase = new Y.Map() as YDatabase;
  doc.getMap(E.data_section).set(E.database, mockDatabase);
  mockFields = new Y.Map() as YDatabaseFields;
  mockDatabase.set(K.fields, mockFields);
  mockFields.set('rollup', createRollupField('rollup'));
  mockField = mockFields.get('rollup')!;
  mockField.set(K.name, 'Rollup');
  const option = mockField.get(K.type_option).get(String(FieldType.Rollup));

  option.set(K.relation_field_id, 'relation');
  option.set(K.target_field_id, 'target');
  option.set(K.show_as, showAs);
  option.set(K.calculation_type, calculation);
  mockTarget = new Y.Doc().getMap('target') as YDatabaseField;
  mockTarget.set(K.id, 'target');
  mockTarget.set(K.type, type);
  const targetOptions = new Y.Map();
  const targetOption = new Y.Map();

  mockTarget.set(K.type_option, targetOptions);
  targetOptions.set(String(type), targetOption);
  targetOption.set(
    K.content,
    JSON.stringify({
      options: [
        { id: 'a', name: 'Alpha', color: 0 },
        { id: 'b', name: 'Beta', color: 1 },
        { id: 'c', name: 'Gamma', color: 2 },
      ],
    })
  );
  if (resolved) rememberRollupTarget(mockField, mockTarget);
  const views = new Y.Map();
  const view = new Y.Map();

  mockDatabase.set(K.views, views);
  views.set('view', view);
  mockFilters = new Y.Array() as YDatabaseFilters;
  view.set(K.filters, mockFilters);
  const node = new Y.Map() as YDatabaseFilter;
  const predicateType = rollupResultType({ show_as: showAs, calculation_type: calculation }, type);

  node.set(K.id, 'rule');
  node.set(K.field_id, 'rollup');
  node.set(K.filter_type, FilterType.Data);
  node.set(K.type, FieldType.Rollup);
  node.set(K.rollup_target_type, predicateType);
  node.set(K.rollup_meta, newRollupFilterMetadata(mockField, type));
  Object.entries(defaultRollupPredicate(predicateType)).forEach(([key, value]) => node.set(key, value));
  mockFilters.push([node]);
  return node;
}

function Harness({ advanced = false, showLabel = false }: { advanced?: boolean; showLabel?: boolean }) {
  const [, update] = useState(0);

  useEffect(() => {
    const change = () => update((count) => count + 1);

    mockFilters.observeDeep(change);
    return () => mockFilters.unobserveDeep(change);
  }, []);
  const filter = parseFilter(FieldType.Rollup, mockFilters.get(0));
  const label = useFilterChipLabel(filter);

  return (
    <TooltipProvider>
      {showLabel && (
        <output data-testid='filter-summary' data-has-content={label.hasContent}>
          {label.description}
        </output>
      )}
      {advanced ? <FilterPanelRow filter={filter} isFirst /> : <RollupFilterMenu filter={filter} />}
    </TooltipProvider>
  );
}

async function chooseMode(name: string) {
  fireEvent.pointerDown(screen.getByTestId('rollup-filter-mode'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menuitem', { name, exact: true })).toBeTruthy());
  fireEvent.click(screen.getByRole('menuitem', { name, exact: true }));
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
  mockReadOnly = false;
  mockUpdate.mockClear();
  mockRelationData.mockClear();
});
afterEach(() => jest.useRealTimers());

test.each<[boolean, FieldType]>([
  [false, FieldType.RichText],
  [true, FieldType.RichText],
  [false, FieldType.Number],
  [true, FieldType.Number],
])('simple/advanced=%s preserves typed source %s while changing mode and reopening', async (advanced, type) => {
  const node = setup(type);
  const inputId = type === FieldType.Number ? 'advanced-filter-number-input' : 'advanced-filter-text-input';
  const draft = type === FieldType.Number ? '42' : 'Alpha';
  const mounted = render(<Harness advanced={advanced} />);
  const originalInput = screen.getByTestId(inputId);

  fireEvent.change(originalInput, { target: { value: draft } });
  await chooseMode('Every');
  expect(screen.getByTestId(inputId)).toBe(originalInput);
  expect(screen.getByTestId(inputId).value).toBe(draft);
  await waitFor(() => expect(node.get(K.content)).toBe(draft));
  expect(node.toJSON().rollup_meta.rollup_filter_mode).toBe(2);
  mounted.unmount();
  render(<Harness advanced={advanced} />);
  expect(screen.getByTestId(inputId).value).toBe(draft);
  expect(screen.getByTestId('rollup-filter-mode').textContent).toBe('Every');
});

test.each([false, true])(
  'simple/advanced=%s select search preserves hidden and unresolved IDs and repeated choices',
  async (advanced) => {
    const node = setup(FieldType.MultiSelect);

    node.set(K.content, 'a,deleted');
    render(<Harness advanced={advanced} />);
    await chooseMode('Every');
    fireEvent.click(screen.getByTestId('advanced-filter-select-input'));
    const searchInput = screen.getByRole('textbox', { name: 'Search' });

    screen.getByTestId('filter-option-results').scrollTop = 180;
    searchInput.focus();
    fireEvent.change(searchInput, { target: { value: 'Beta' } });
    expect(screen.getByTestId('filter-option-results').scrollTop).toBe(0);
    expect(document.activeElement).toBe(searchInput);
    expect(node.get(K.content)).toBe('a,deleted');
    fireEvent.click(screen.getByText('Beta'));
    expect(node.get(K.content)).toBe('a,deleted,b');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'Gamma' } });
    fireEvent.click(screen.getByText('Gamma'));
    expect(node.get(K.content)).toBe('a,deleted,b,c');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'no such option' } });
    expect(screen.getByText('inlineActions.noResults')).toBeTruthy();
    expect(node.get(K.content)).toBe('a,deleted,b,c');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(node.toJSON().rollup_meta.rollup_filter_mode).toBe(2);
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'Beta' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('advanced-filter-select-input'));
    expect(screen.getByRole('textbox', { name: 'Search' }).value).toBe('');
  }
);

test.each([FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy])(
  'person/attribution %s searches emails and keeps the exact identifier domain',
  async (type) => {
    const node = setup(type);
    const first = type === FieldType.Person ? 'alice' : '9007199254740993';
    const second = type === FieldType.Person ? 'bob' : '9007199254740992';

    node.set(K.content, JSON.stringify([first, 'unresolved']));
    render(<Harness advanced />);
    await chooseMode('None');
    fireEvent.click(screen.getByTestId('advanced-filter-person-input'));
    const searchInput = screen.getByRole('textbox', { name: 'Search' });

    screen.getByTestId('filter-option-results').scrollTop = 180;
    searchInput.focus();
    fireEvent.change(searchInput, { target: { value: 'elsewhere' } });
    expect(screen.getByTestId('filter-option-results').scrollTop).toBe(0);
    expect(document.activeElement).toBe(searchInput);
    expect(JSON.parse(node.get(K.content))).toEqual([first, 'unresolved']);
    fireEvent.click(screen.getByText('Bob'));
    expect(JSON.parse(node.get(K.content))).toEqual([first, 'unresolved', second]);
    expect(node.toJSON().rollup_meta.rollup_filter_mode).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByTestId('advanced-filter-person-input').textContent).toBe('3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'grid.person.unknownUser' }));
    expect(JSON.parse(node.get(K.content))).toEqual([first, second]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'no such person' } });
    expect(screen.getByText('grid.field.person.noMatches')).toBeTruthy();
    expect(JSON.parse(node.get(K.content))).toEqual([first, second]);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('advanced-filter-person-input'));
    expect(screen.getByRole('textbox', { name: 'Search' }).value).toBe('');
    expect(screen.getByText('Alice')).toBeTruthy();
  }
);

test('ordinary person search resets results to the top without losing focus or saved selections', () => {
  const node = setup(FieldType.Person);

  mockField.set(K.type, FieldType.Person);
  node.set(K.content, JSON.stringify(['alice', 'unresolved']));
  render(<PersonFilterMenu filter={parseFilter(FieldType.Person, node) as PersonFilter} />);
  const searchInput = screen.getByRole('textbox', { name: 'Search' });

  screen.getByTestId('filter-option-results').scrollTop = 180;
  searchInput.focus();
  fireEvent.change(searchInput, { target: { value: 'elsewhere' } });
  expect(screen.getByTestId('filter-option-results').scrollTop).toBe(0);
  expect(document.activeElement).toBe(searchInput);
  expect(screen.getByText('Bob')).toBeTruthy();
  expect(screen.queryByText('Alice')).toBeNull();
  expect(JSON.parse(node.get(K.content))).toEqual(['alice', 'unresolved']);
  fireEvent.change(searchInput, { target: { value: 'no such person' } });
  expect(screen.getByText('grid.field.person.noMatches')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByText('Alice')).toBeTruthy();
  expect(screen.getByText('grid.person.unknownUser')).toBeTruthy();
  expect(JSON.parse(node.get(K.content))).toEqual(['alice', 'unresolved']);
  expect(mockUpdate).not.toHaveBeenCalled();
});

test.each([FieldType.SingleSelect, FieldType.MultiSelect])(
  'unresolved select rollup %s shows its saved count until source option names resolve',
  (type) => {
    const node = setup(type, RollupDisplayMode.OriginalList, CalculationType.Count, false);

    node.set(K.content, 'a,b');
    const mounted = render(<Harness advanced showLabel />);

    expect(screen.getByTestId('advanced-filter-select-input').textContent).toBe('2');
    expect(screen.getByTestId('filter-summary').textContent).toContain('(2)');
    expect(screen.getByTestId('filter-summary').getAttribute('data-has-content')).toBe('true');
    act(() => {
      mockTargetResolved = true;
      rememberRollupTarget(mockField, mockTarget);
    });
    mounted.rerender(<Harness advanced showLabel />);
    expect(screen.getByTestId('advanced-filter-select-input').textContent).toBe('AlphaBeta');
    expect(screen.getByTestId('filter-summary').textContent).toContain('Alpha, Beta');
    expect(node.get(K.content)).toBe('a,b');
    expect(mockUpdate).not.toHaveBeenCalled();
  }
);

test('unresolved select rollup empty selections and emptiness conditions have no count', () => {
  const node = setup(FieldType.MultiSelect, RollupDisplayMode.OriginalList, CalculationType.Count, false);

  render(<Harness advanced showLabel />);
  expect(screen.getByTestId('advanced-filter-select-input').textContent).toBe('grid.settings.typeAValue');
  expect(screen.getByTestId('filter-summary').getAttribute('data-has-content')).toBe('false');
  act(() => {
    node.set(K.condition, 4);
    node.set(K.content, 'discarded');
  });
  expect(screen.queryByTestId('advanced-filter-select-input')).toBeNull();
  expect(screen.getByTestId('filter-summary').getAttribute('data-has-content')).toBe('false');
  expect(screen.getByTestId('filter-summary').textContent).not.toContain('(1)');
});

test('relation picker uses the relation target field and keeps its mode on selection', async () => {
  const node = setup(FieldType.Relation);

  render(<Harness advanced />);
  await chooseMode('Every');
  fireEvent.click(screen.getByTestId('advanced-filter-relation-input'));
  fireEvent.click(screen.getByText('Third database row'));
  expect(mockRelationData).toHaveBeenLastCalledWith(
    'rollup',
    expect.objectContaining({ field: mockTarget, enabled: true })
  );
  expect(node.get(K.content)).toBe('["third-row"]');
  expect(node.toJSON().rollup_meta.rollup_filter_mode).toBe(2);
});

test.each([FieldType.Checkbox, FieldType.Checklist, FieldType.Media])(
  'native condition-only source %s needs no text input',
  (type) => {
    setup(type);
    render(<Harness advanced />);
    expect(screen.getByTestId('rollup-filter-mode')).toBeTruthy();
    expect(screen.queryByTestId('advanced-filter-text-input')).toBeNull();
  }
);

test.each([CalculationType.DateRange, CalculationType.DateLatest, CalculationType.Count])(
  'calculated %s has result controls and no list mode',
  (calculation) => {
    setup(FieldType.DateTime, RollupDisplayMode.Calculated, calculation);
    render(<Harness advanced />);
    expect(screen.queryByTestId('rollup-filter-mode')).toBeNull();
    expect(Boolean(screen.queryByTestId('rollup-filter-date-endpoint'))).toBe(calculation === CalculationType.DateRange);
    expect(
      screen.getByTestId(
        calculation === CalculationType.Count ? 'advanced-filter-number-input' : 'advanced-filter-date-input'
      )
    ).toBeTruthy();
  }
);

test('end-date condition changes retain an existing date range and list mode', async () => {
  const node = setup(FieldType.DateTime);

  node.set(K.condition, 5);
  node.set(K.content, JSON.stringify({ start: 1726099200, end: 1726185600 }));
  render(<Harness advanced />);
  await chooseMode('Every');
  fireEvent.pointerDown(screen.getByTestId('rollup-filter-date-endpoint'), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'End' }));
  expect(Number(node.get(K.condition))).toBe(13);
  expect(JSON.parse(node.get(K.content))).toEqual({ start: 1726099200, end: 1726185600 });
  expect(node.toJSON().rollup_meta.rollup_filter_mode).toBe(2);
});

test.each([false, true])('date range inputs persist both endpoints and reopen (advanced=%s)', async (advanced) => {
  const node = setup(FieldType.DateTime);

  node.set(K.condition, 5);
  const mounted = render(<Harness advanced={advanced} />);

  await chooseMode('Every');
  fireEvent.click(screen.getByTestId('advanced-filter-date-input'));
  const inputs = screen.getAllByTestId('datetime-date-input');

  fireEvent.change(inputs[0], { target: { value: '09/12/2026' } });
  fireEvent.blur(inputs[0]);
  fireEvent.change(inputs[1], { target: { value: '09/14/2026' } });
  fireEvent.blur(inputs[1]);
  const content = JSON.parse(node.get(K.content));

  expect(typeof content.start).toBe('number');
  expect(typeof content.end).toBe('number');
  expect(new Date(content.start * 1000).getDate()).toBe(12);
  expect(new Date(content.end * 1000).getDate()).toBe(14);
  expect(node.toJSON().rollup_meta.rollup_filter_mode).toBe(2);
  mounted.unmount();
  render(<Harness advanced={advanced} />);
  fireEvent.click(screen.getByTestId('advanced-filter-date-input'));
  const reopened = screen.getAllByTestId('datetime-date-input');

  expect(reopened.map((input) => input.value)).toEqual(['09/12/2026', '09/14/2026']);
});

test.each<[boolean, FieldType]>([
  [false, FieldType.RichText],
  [true, FieldType.RichText],
  [false, FieldType.Number],
  [true, FieldType.Number],
])('configuration replacement rejects pending source %s/%s edits before the reset frame', (advanced, type) => {
  jest.useFakeTimers();
  const node = setup(type);
  const inputId = type === FieldType.Number ? 'advanced-filter-number-input' : 'advanced-filter-text-input';

  render(<Harness advanced={advanced} />);
  const obsoleteInput = screen.getByTestId(inputId);

  fireEvent.change(obsoleteInput, { target: { value: '9' } });
  act(() => {
    const option = mockField.get(K.type_option).get(String(FieldType.Rollup));

    if (type === FieldType.Number) {
      option.set(K.show_as, RollupDisplayMode.Calculated);
      option.set(K.calculation_type, CalculationType.Min);
    } else {
      option.set(K.target_field_id, 'new-source');
    }

    migrateRollupFilters(mockDatabase, 'rollup', type);
    // React has not committed the replacement input yet. The old timer must
    // compare against the live Yjs configuration before its cleanup can run.
    expect(obsoleteInput.isConnected).toBe(true);
    jest.advanceTimersByTime(600);
    expect(node.get(K.content)).toBe('');
  });
  expect(screen.getByTestId(inputId)).not.toBe(obsoleteInput);
  expect(screen.getByTestId(inputId).value).toBe('');
  expect(node.get(K.content)).toBe('');
  const metadata = node.toJSON().rollup_meta;

  if (type === FieldType.Number) {
    expect(metadata.rollup_show_as).toBe(RollupDisplayMode.Calculated);
    expect(metadata.rollup_calculation_type).toBe(CalculationType.Min);
  } else {
    expect(metadata.target_field_id).toBe('new-source');
  }

  fireEvent.change(screen.getByTestId(inputId), { target: { value: '3' } });
  act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(node.get(K.content)).toBe('3');
  expect(node.get(K.id)).toBe('rule');
  expect(node.toJSON().rollup_meta).toEqual(metadata);
});

test('a mounted text predicate switches to a number predicate with the same filter ID', () => {
  jest.useFakeTimers();
  const node = setup();

  render(<Harness advanced />);
  fireEvent.change(screen.getByTestId('advanced-filter-text-input'), { target: { value: 'obsolete' } });
  act(() => {
    mockType = FieldType.Number;
    mockTarget.set(K.type, FieldType.Number);
    rememberRollupTarget(mockField, mockTarget);
    migrateRollupFilters(mockDatabase, 'rollup', FieldType.Number);
    jest.advanceTimersByTime(600);
  });
  expect(screen.queryByTestId('advanced-filter-text-input')).toBeNull();
  expect(screen.getByTestId('advanced-filter-number-input').value).toBe('');
  expect(node.get(K.id)).toBe('rule');
  expect(node.get(K.content)).toBe('');
  expect(node.toJSON().rollup_meta.target_field_type).toBe(FieldType.Number);
  fireEvent.change(screen.getByTestId('advanced-filter-number-input'), { target: { value: '12' } });
  act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(node.get(K.content)).toBe('12');
});

test.each([
  { name: 'numeric list', showAs: RollupDisplayMode.OriginalList, discriminator: FieldType.Number, numeric: true },
  {
    name: 'Count without a discriminator',
    showAs: RollupDisplayMode.Calculated,
    discriminator: undefined,
    numeric: true,
  },
  {
    name: 'explicit text Count',
    showAs: RollupDisplayMode.Calculated,
    discriminator: FieldType.RichText,
    numeric: false,
  },
])('legacy $name uses its persisted predicate without adding metadata', ({ showAs, discriminator, numeric }) => {
  jest.useFakeTimers();
  const node = setup(FieldType.Number, showAs);

  node.delete(K.rollup_meta);
  if (discriminator === undefined) node.delete(K.rollup_target_type);
  else node.set(K.rollup_target_type, discriminator);
  const inputId = numeric ? 'advanced-filter-number-input' : 'advanced-filter-text-input';
  const mounted = render(<Harness />);

  expect(screen.getByTestId(inputId)).toBeTruthy();
  expect(screen.queryByTestId('rollup-filter-mode')).toBeNull();
  fireEvent.change(screen.getByTestId(inputId), { target: { value: '12' } });
  act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(node.get(K.content)).toBe('12');
  expect(node.get(K.rollup_meta)).toBeUndefined();
  mounted.rerender(<Harness advanced />);
  expect(screen.getByTestId(inputId).value).toBe('12');
  expect(screen.queryByTestId('rollup-filter-mode')).toBeNull();
  expect(node.get(K.rollup_meta)).toBeUndefined();
});

test.each([
  { type: FieldType.RichText, partial: false, advanced: false },
  { type: FieldType.Number, partial: false, advanced: false },
  { type: FieldType.RichText, partial: true, advanced: true },
  { type: FieldType.Number, partial: true, advanced: true },
])(
  'legacy source $type, partial metadata=$partial rejects a pending edit during migration',
  ({ type, partial, advanced }) => {
    jest.useFakeTimers();
    const node = setup(type);

    if (partial) {
      node.set(K.rollup_meta, { target_field_type: type });
      node.delete(K.rollup_target_type);
    } else node.delete(K.rollup_meta);
    const before = node.toJSON();
    const inputId = type === FieldType.Number ? 'advanced-filter-number-input' : 'advanced-filter-text-input';

    render(<Harness advanced={advanced} />);
    const input = screen.getByTestId(inputId);

    expect(node.toJSON()).toEqual(before);
    expect(screen.queryByTestId('rollup-filter-mode')).toBeNull();
    fireEvent.change(input, { target: { value: '9' } });
    act(() => {
      const previous = parseRollupTypeOption(mockField);
      const option = mockField.get(K.type_option).get(String(FieldType.Rollup));

      if (type === FieldType.Number) {
        option.set(K.show_as, RollupDisplayMode.Calculated);
        option.set(K.calculation_type, CalculationType.Min);
      } else option.set(K.target_field_id, 'replacement');
      migrateRollupFilters(mockDatabase, 'rollup', type, previous);
      expect(input.isConnected).toBe(true);
      jest.advanceTimersByTime(600);
      expect(node.get(K.content)).toBe('');
    });
    expect(screen.getByTestId(inputId)).not.toBe(input);
    expect(screen.getByTestId(inputId).value).toBe('');
    fireEvent.change(screen.getByTestId(inputId), { target: { value: '3' } });
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(node.get(K.content)).toBe('3');
    expect(node.get(K.id)).toBe('rule');
  }
);

test('legacy select rollups keep selecting option names without adding native metadata', () => {
  const node = setup(FieldType.MultiSelect);

  node.delete(K.rollup_meta);
  node.set(K.rollup_target_type, FieldType.RichText);
  node.set(K.content, 'Alpha');
  mockSelectOptions = JSON.parse(
    mockTarget.get(K.type_option).get(String(FieldType.MultiSelect)).get(K.content)
  ).options;
  render(<Harness />);
  expect(screen.queryByTestId('rollup-filter-mode')).toBeNull();
  fireEvent.click(screen.getByText('Beta'));
  expect(node.get(K.content)).toBe('Beta');
  fireEvent.click(screen.getByText('Beta'));
  expect(node.get(K.content)).toBe('');
  expect(node.get(K.rollup_meta)).toBeUndefined();
  expect(node.get(K.rollup_target_type)).toBe(FieldType.RichText);
});

test('read-only rollup controls do not write or migrate rules', () => {
  const node = setup();
  const snapshot = node.toJSON();

  mockReadOnly = true;
  render(<Harness advanced />);
  expect(screen.getByTestId('rollup-filter-mode').disabled).toBe(true);
  expect(screen.getByTestId('advanced-filter-text-input').disabled).toBe(true);
  expect(node.toJSON()).toEqual(snapshot);
  expect(mockUpdate).not.toHaveBeenCalled();
});
