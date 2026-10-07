import { fireEvent, render, screen, within } from '@testing-library/react';
import dayjs from 'dayjs';
import * as Y from 'yjs';

import { FieldType, Filter } from '@/application/database-yjs/database.type';
import { DateFilter, DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import { NumberFilter, NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { PersonFilter, PersonFilterCondition } from '@/application/database-yjs/fields/person/person.type';
import {
  SelectOption,
  SelectOptionColor,
  SelectOptionFilter,
  SelectOptionFilterCondition,
} from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilter, TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { mergeOptionLists, MergedSelection } from '@/application/database-yjs/global-filter-options';
import { MentionablePerson, YDatabaseField, YjsDatabaseKey as K } from '@/application/types';
import {
  GlobalFilterContent,
  GlobalFilterValue,
} from '@/components/database/dashboard/global-filters/GlobalFilterContent';

import DateTimeFilterDatePicker from '../filter-menu/DateTimeFilterDatePicker';
import MultiSelectOptionFilterMenu from '../filter-menu/MultiSelectOptionFilterMenu';
import NumberFilterMenu from '../filter-menu/NumberFilterMenu';
import PersonFilterMenu from '../filter-menu/PersonFilterMenu';
import SingleSelectOptionFilterMenu from '../filter-menu/SingleSelectOptionFilterMenu';
import TextFilterMenu from '../filter-menu/TextFilterMenu';
import { PERSON_FILTER_LIST_LIMIT } from '../value-controls/usePersonFilterOptions';

/**
 * A view filter and a dashboard global filter of the same property type are
 * edited with the same value controls. For the same pick they must store the
 * same `content`, or a filter would mean one thing in a view and another on a
 * dashboard.
 */

const PICKED_DAY = new Date(2026, 2, 14);
const PICKED_END = new Date(2026, 2, 20);

let mockField: YDatabaseField;
let mockReadOnly = false;
let mockUsers: MentionablePerson[] = [];
const mockUpdate = jest.fn();

jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useConditionsReadOnly: () => mockReadOnly,
}));
jest.mock('@/application/database-yjs/selector', () => ({
  useFieldSelector: () => ({ field: mockField }),
  useFieldType: () => Number(mockField.get('ty')),
  useFormulaResultType: () => 'any',
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch'),
  useUpdateFilter: () => mockUpdate,
}));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: mockUsers, loading: false }),
}));
jest.mock('@/components/database/components/filters/filter-menu/FieldMenuTitle', () => ({
  __esModule: true,
  default: () => <div data-testid='filter-editor-header' />,
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => undefined,
  useCurrentUserOptional: () => undefined,
}));
// The calendar library is not under test: a pick hands the control fixed days.
jest.mock('@/components/ui/calendar', () => ({
  Calendar: ({ mode, onSelect }: { mode: string; onSelect: (value: unknown) => void }) => (
    <button
      type='button'
      data-testid='calendar-pick'
      onClick={() => onSelect(mode === 'range' ? { from: PICKED_DAY, to: PICKED_END } : PICKED_DAY)}
    >
      pick
    </button>
  ),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const count = options?.count;
      const template =
        (count === 1 ? options?.defaultValue_one : count !== undefined ? options?.defaultValue_other : undefined) ??
        options?.defaultValue ??
        key;

      return String(template).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

const OPTIONS: SelectOption[] = [
  { id: 'a', name: 'Todo', color: SelectOptionColor.OptionColor1 },
  { id: 'b', name: 'Doing', color: SelectOptionColor.OptionColor2 },
  { id: 'c', name: 'Done', color: SelectOptionColor.OptionColor3 },
];

function createField(type: FieldType, options?: SelectOption[]) {
  const doc = new Y.Doc();
  const field = doc.getMap('field');
  const typeOptions = new Y.Map<unknown>();

  field.set(K.id, 'field-1');
  field.set(K.type, type);
  if (options) {
    const typeOption = new Y.Map<unknown>();

    typeOption.set(K.content, JSON.stringify({ disable_color: false, options }));
    typeOptions.set(String(type), typeOption);
  }

  field.set(K.type_option, typeOptions);
  return field as unknown as YDatabaseField;
}

function viewFilter<T extends Filter>(condition: number, content: string, extra: Partial<T> = {}): T {
  return { id: 'filter-1', fieldId: 'field-1', condition, content, ...extra } as unknown as T;
}

function globalFilter(fieldType: FieldType, condition: number, content: string): GlobalFilterValue {
  return { id: 'gf:1', fieldType, condition, content };
}

/** The content the view filter editor last wrote. */
function viewContent(): string {
  const { calls } = mockUpdate.mock;

  expect(calls[calls.length - 1][0]).toMatchObject({ filterId: 'filter-1', fieldId: 'field-1' });
  return calls[calls.length - 1][0].content;
}

function lastContent(onChange: jest.Mock): string {
  return onChange.mock.calls[onChange.mock.calls.length - 1][0];
}

/** A select pick in the global editor: only its ids are compared with the view filter's. */
function contentOf(onChange: jest.Mock) {
  return (selection: MergedSelection) => onChange(selection.content);
}

/** Not a select filter: the selection path is never taken. */
const noSelection = jest.fn();

function person(id: string, uid: number, name: string): MentionablePerson {
  return { person_id: id, uid: String(uid), name, email: `${id}@example.com` } as MentionablePerson;
}

beforeEach(() => {
  mockUpdate.mockClear();
  mockReadOnly = false;
  mockUsers = [person('alice', 101, 'Alice'), person('bob', 102, 'Bob')];
  mockField = createField(FieldType.RichText);
});

describe.each([
  ['a multi-select', FieldType.MultiSelect, SelectOptionFilterCondition.OptionContains, MultiSelectOptionFilterMenu],
  ['a single select', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, SingleSelectOptionFilterMenu],
] as const)('select value of %s filter', (_name, fieldType, condition, ViewMenu) => {
  // The global editor lists the options of every source merged by name (one source here).
  const optionEntries = mergeOptionLists([OPTIONS]);

  beforeEach(() => {
    mockField = createField(fieldType, OPTIONS);
  });

  it('stores the same option ids, in field option order, from either editor', () => {
    const onChange = jest.fn();
    const view = render(<ViewMenu filter={viewFilter<SelectOptionFilter>(condition, 'c', { optionIds: ['c'] })} />);

    fireEvent.click(screen.getByText('Todo'));
    view.unmount();
    render(
      <GlobalFilterContent
        filter={globalFilter(fieldType, condition, 'c')}
        optionEntries={optionEntries}
        onChange={onChange}
        onSelectionChange={contentOf(onChange)}
      />
    );
    fireEvent.click(screen.getByText('Todo'));

    expect(viewContent()).toBe('a,c');
    expect(lastContent(onChange)).toBe(viewContent());
  });

  it('removes a picked option the same way', () => {
    const onChange = jest.fn();
    const view = render(<ViewMenu filter={viewFilter<SelectOptionFilter>(condition, 'a,c', { optionIds: ['a', 'c'] })} />);

    fireEvent.click(screen.getByText('Done'));
    view.unmount();
    render(
      <GlobalFilterContent
        filter={globalFilter(fieldType, condition, 'a,c')}
        optionEntries={optionEntries}
        onChange={onChange}
        onSelectionChange={contentOf(onChange)}
      />
    );
    fireEvent.click(screen.getByText('Done'));

    expect(viewContent()).toBe('a');
    expect(lastContent(onChange)).toBe(viewContent());
  });

  it('clears to the same empty content', () => {
    const onChange = jest.fn();
    const view = render(<ViewMenu filter={viewFilter<SelectOptionFilter>(condition, 'a', { optionIds: ['a'] })} />);

    fireEvent.click(screen.getByTestId('filter-clear-selection'));
    view.unmount();
    render(
      <GlobalFilterContent
        filter={globalFilter(fieldType, condition, 'a')}
        optionEntries={optionEntries}
        onChange={onChange}
        onSelectionChange={contentOf(onChange)}
      />
    );
    fireEvent.click(screen.getByTestId('dashboard-global-filter-clear-selection'));

    expect(viewContent()).toBe('');
    expect(lastContent(onChange)).toBe('');
  });

  it('searches the options and returns the list to the top in both editors', () => {
    render(
      <GlobalFilterContent
        filter={globalFilter(fieldType, condition, '')}
        optionEntries={optionEntries}
        onChange={jest.fn()}
        onSelectionChange={jest.fn()}
      />
    );
    const results = screen.getByTestId('filter-option-results');

    results.scrollTop = 120;
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'do' } });

    expect(screen.getByTestId('filter-option-results').scrollTop).toBe(0);
    expect(screen.getAllByTestId('dashboard-global-filter-option').map((item) => item.textContent)).toEqual([
      'Todo',
      'Doing',
      'Done',
    ]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'doi' } });
    expect(screen.getAllByTestId('dashboard-global-filter-option').map((item) => item.textContent)).toEqual(['Doing']);
  });
});

describe.each([
  ['Person', FieldType.Person, '["alice","bob"]'],
  // Created by / Last edited by store user uids, not workspace person ids.
  ['Created by', FieldType.CreatedBy, '["101","102"]'],
] as const)('person value of a %s filter', (_name, fieldType, bothSelected) => {
  const first = JSON.parse(bothSelected)[0] as string;
  const condition = PersonFilterCondition.PersonContains;

  beforeEach(() => {
    mockField = createField(fieldType);
  });

  it('stores the same ids from either editor', () => {
    const onChange = jest.fn();
    const content = JSON.stringify([first]);
    const view = render(<PersonFilterMenu filter={viewFilter<PersonFilter>(condition, content, { userIds: [first] })} />);

    fireEvent.click(screen.getByText('Bob'));
    view.unmount();
    render(
      <GlobalFilterContent
        filter={globalFilter(fieldType, condition, content)}
        onChange={onChange}
        onSelectionChange={noSelection}
      />
    );
    fireEvent.click(screen.getByText('Bob'));

    expect(viewContent()).toBe(bothSelected);
    expect(lastContent(onChange)).toBe(viewContent());
  });

  it('clears to the same empty list', () => {
    const onChange = jest.fn();
    const content = JSON.stringify([first]);
    const view = render(<PersonFilterMenu filter={viewFilter<PersonFilter>(condition, content, { userIds: [first] })} />);

    fireEvent.click(screen.getByTestId('filter-clear-selection'));
    view.unmount();
    render(
      <GlobalFilterContent
        filter={globalFilter(fieldType, condition, content)}
        onChange={onChange}
        onSelectionChange={noSelection}
      />
    );
    fireEvent.click(screen.getByTestId('dashboard-global-filter-clear-selection'));

    expect(viewContent()).toBe('[]');
    expect(lastContent(onChange)).toBe('[]');
  });
});

describe('person list', () => {
  const condition = PersonFilterCondition.PersonContains;

  it('lists an unknown selected id as "Unknown user" and searches it like the view filter does', () => {
    const onChange = jest.fn();

    render(
      <GlobalFilterContent
        filter={globalFilter(FieldType.Person, condition, '["alice","gone"]')}
        onChange={onChange}
        onSelectionChange={noSelection}
      />
    );
    const rows = () =>
      screen.queryAllByTestId('dashboard-global-filter-person').map((item) => item.getAttribute('data-person-id'));

    expect(rows()).toEqual(['alice', 'bob', 'gone']);
    expect(screen.getByText('grid.person.unknownUser')).toBeTruthy();
    // A search that matches neither the label nor the id hides the unknown row too.
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'bob' } });
    expect(rows()).toEqual(['bob']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'gone' } });
    expect(rows()).toEqual(['gone']);
    // It can still be removed.
    fireEvent.click(screen.getByText('grid.person.unknownUser'));
    expect(lastContent(onChange)).toBe('["alice"]');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'nobody' } });
    expect(screen.getByText('grid.field.person.noMatches')).toBeTruthy();
  });

  it.each([
    ['the global filter editor', 'dashboard-global-filter-person'],
    ['the view filter menu', 'person-filter-option'],
  ])('caps the list of a large workspace in %s until the user searches', (_name, rowTestId) => {
    const selected = `person-${PERSON_FILTER_LIST_LIMIT + 5}`;
    const content = JSON.stringify([selected]);

    mockUsers = Array.from({ length: PERSON_FILTER_LIST_LIMIT + 10 }, (_, index) =>
      person(`person-${index}`, 1000 + index, `Member ${String(index).padStart(3, '0')}`)
    );
    mockField = createField(FieldType.Person);
    render(
      rowTestId === 'person-filter-option' ? (
        <PersonFilterMenu filter={viewFilter<PersonFilter>(condition, content, { userIds: [selected] })} />
      ) : (
        <GlobalFilterContent
          filter={globalFilter(FieldType.Person, condition, content)}
          onChange={jest.fn()}
          onSelectionChange={noSelection}
        />
      )
    );
    const rows = () => screen.queryAllByTestId(rowTestId);

    // The first members, plus the selected one from beyond the cap.
    expect(rows()).toHaveLength(PERSON_FILTER_LIST_LIMIT + 1);
    expect(rows()[PERSON_FILTER_LIST_LIMIT].getAttribute('data-person-id')).toBe(selected);
    expect(rows()[PERSON_FILTER_LIST_LIMIT].getAttribute('data-checked')).toBe('true');
    expect(screen.getByTestId('person-filter-more').textContent).toBe('Search to find 9 more people');

    // A search reaches the members beyond the cap.
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: `member 0${PERSON_FILTER_LIST_LIMIT + 9}` },
    });
    expect(rows().map((item) => item.getAttribute('data-person-id'))).toEqual([
      `person-${PERSON_FILTER_LIST_LIMIT + 9}`,
    ]);
    expect(screen.queryByTestId('person-filter-more')).toBeNull();
  });
});

describe('text and number values', () => {
  it('stores the typed text from either editor', () => {
    const onChange = jest.fn();
    const view = render(<TextFilterMenu filter={viewFilter<TextFilter>(TextFilterCondition.TextContains, '')} />);

    fireEvent.change(screen.getByTestId('text-filter-input'), { target: { value: 'road map' } });
    view.unmount();
    render(
      <GlobalFilterContent
        filter={globalFilter(FieldType.RichText, TextFilterCondition.TextContains, '')}
        onChange={onChange}
        onSelectionChange={noSelection}
      />
    );
    fireEvent.change(screen.getByTestId('dashboard-global-filter-content'), { target: { value: 'road map' } });

    expect(viewContent()).toBe('road map');
    expect(lastContent(onChange)).toBe(viewContent());
  });

  it('accepts the same numbers and rejects the same edits in either editor', () => {
    const onChange = jest.fn();
    const view = render(<NumberFilterMenu filter={viewFilter<NumberFilter>(NumberFilterCondition.Equal, '')} />);
    const viewInput = screen.getByTestId('text-filter-input');

    fireEvent.change(viewInput, { target: { value: '-12.5' } });
    fireEvent.change(viewInput, { target: { value: '-12.5a' } });
    expect(viewInput.value).toBe('-12.5');
    expect(mockUpdate.mock.calls.filter(([params]) => params.content !== undefined)).toHaveLength(1);
    view.unmount();

    render(
      <GlobalFilterContent
        filter={globalFilter(FieldType.Number, NumberFilterCondition.Equal, '')}
        onChange={onChange}
        onSelectionChange={noSelection}
      />
    );
    const globalInput = screen.getByTestId('dashboard-global-filter-content');

    fireEvent.change(globalInput, { target: { value: '-12.5' } });
    fireEvent.change(globalInput, { target: { value: '-12.5a' } });
    expect(globalInput.value).toBe('-12.5');
    expect(onChange).toHaveBeenCalledTimes(1);

    expect(viewContent()).toBe('-12.5');
    expect(lastContent(onChange)).toBe(viewContent());
  });
});

describe('date value', () => {
  const dayUnix = dayjs(PICKED_DAY).unix();
  const endUnix = dayjs(PICKED_END).unix();

  function pickInView(condition: DateFilterCondition) {
    const view = render(<DateTimeFilterDatePicker filter={viewFilter<DateFilter>(condition, '')} />);

    fireEvent.click(screen.getByTestId('date-filter-date-picker'));
    fireEvent.click(screen.getByTestId('calendar-pick'));
    view.unmount();
    return viewContent();
  }

  function pickInGlobal(condition: DateFilterCondition, content = '') {
    const onChange = jest.fn();
    const global = render(
      <GlobalFilterContent
        filter={globalFilter(FieldType.DateTime, condition, content)}
        onChange={onChange}
        onSelectionChange={noSelection}
      />
    );

    // The global editor shows its calendar inline (WP08 §1.6).
    fireEvent.click(within(screen.getByTestId('dashboard-global-filter-date-calendar')).getByTestId('calendar-pick'));
    global.unmount();
    return lastContent(onChange);
  }

  it('stores one picked day the same way from either editor', () => {
    const view = pickInView(DateFilterCondition.DateStartsOn);

    expect(JSON.parse(view)).toEqual({ timestamp: dayUnix });
    expect(pickInGlobal(DateFilterCondition.DateStartsOn)).toBe(view);
  });

  it('stores a picked range the same way from either editor', () => {
    const view = pickInView(DateFilterCondition.DateStartsBetween);

    expect(JSON.parse(view)).toEqual({ start: dayUnix, end: endUnix });
    expect(pickInGlobal(DateFilterCondition.DateStartsBetween)).toBe(view);
  });

  it('shows the stored day back in the global editor', () => {
    render(
      <GlobalFilterContent
        filter={globalFilter(FieldType.DateTime, DateFilterCondition.DateStartsOn, JSON.stringify({ timestamp: dayUnix }))}
        onChange={jest.fn()}
        onSelectionChange={noSelection}
      />
    );

    expect(screen.getByTestId('dashboard-global-filter-date-value').textContent).toContain('2026');
  });
});

describe('a read-only host view', () => {
  beforeEach(() => {
    mockReadOnly = true;
    mockField = createField(FieldType.MultiSelect, OPTIONS);
  });

  it('hides "Clear selection" and ignores picks in the view filter', () => {
    render(
      <MultiSelectOptionFilterMenu
        filter={viewFilter<SelectOptionFilter>(SelectOptionFilterCondition.OptionContains, 'a', { optionIds: ['a'] })}
      />
    );

    expect(screen.queryByTestId('filter-clear-selection')).toBeNull();
    fireEvent.click(screen.getByText('Done'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('still lets a viewer change a global filter (a private override)', () => {
    const onChange = jest.fn();

    render(
      <GlobalFilterContent
        filter={globalFilter(FieldType.MultiSelect, SelectOptionFilterCondition.OptionContains, 'a')}
        optionEntries={mergeOptionLists([OPTIONS])}
        onChange={onChange}
        onSelectionChange={contentOf(onChange)}
      />
    );

    fireEvent.click(within(screen.getByTestId('dashboard-global-filter-content')).getByText('Done'));
    expect(lastContent(onChange)).toBe('a,c');
    fireEvent.click(screen.getByTestId('dashboard-global-filter-clear-selection'));
    expect(lastContent(onChange)).toBe('');
  });
});
