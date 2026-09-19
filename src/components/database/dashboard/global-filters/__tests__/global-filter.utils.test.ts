import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import { NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { PersonFilterCondition } from '@/application/database-yjs/fields/person/person.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';

import {
  applyConditionChange,
  conditionHidesContent,
  getGlobalFilterChipText,
  getGlobalFilterConditions,
  getGlobalFilterDescription,
  hasRequiredDate,
  isGlobalFilterActive,
  parseDateContent,
  serializeDateContent,
  Translate,
} from '../global-filter.conditions';
import {
  addGlobalFilterSource,
  buildDefaultTargets,
  countGlobalFilterSources,
  createGlobalFilter,
  detachRemovedGlobalFilterSources,
  getAddableSources,
  getAvailableFieldTypes,
  getMappedSources,
  getPrimaryTargetField,
  getTargetCandidates,
  GLOBAL_FILTER_FIELD_TYPES,
  isGlobalFilterTargetUsable,
  pruneOptionContent,
  removeGlobalFilter,
  removeGlobalFilterTarget,
  replaceGlobalFilter,
  setGlobalFilterTarget,
} from '../global-filter.utils';
import { readGlobalFilterSourceFields } from '../useGlobalFilterSources';

import { addField, createSourceDoc, option, source } from './source-doc.fixture';

const t: Translate = (key, options) => {
  if (options && 'count' in options) return `${key}(${String(options.count)})`;
  return key;
};

const todo = option('o-todo', 'Todo');
const doing = option('o-doing', 'Doing');
const done = option('o-done', 'Done');

const tasks = source('db-tasks', 'Tasks', [
  { id: 'tasks-name', name: 'Name', type: FieldType.RichText, isPrimary: true },
  { id: 'tasks-status', name: 'Status', type: FieldType.SingleSelect, options: [todo, doing, done] },
  { id: 'tasks-points', name: 'Points', type: FieldType.Number },
  { id: 'tasks-owner', name: 'Owner', type: FieldType.Person },
  { id: 'tasks-duration', name: 'Duration', type: FieldType.Time },
  { id: 'tasks-link', name: 'Project', type: FieldType.Relation },
  { id: 'tasks-rollup', name: 'Total', type: FieldType.Rollup },
]);
// Duplicated from Tasks: same option ids and names, plus one extra option.
const archive = source('db-archive', 'Archive', [
  { id: 'archive-title', name: 'Title', type: FieldType.RichText, isPrimary: true },
  { id: 'archive-state', name: 'State', type: FieldType.SingleSelect, options: [todo, doing, done, option('o-x', 'X')] },
  { id: 'archive-date', name: 'Due', type: FieldType.DateTime },
]);
// Same option names, different ids: select content cannot be shared.
const bugs = source('db-bugs', 'Bugs', [
  { id: 'bugs-title', name: 'Title', type: FieldType.RichText, isPrimary: true },
  {
    id: 'bugs-status',
    name: 'Status',
    type: FieldType.SingleSelect,
    options: [option('b-todo', 'Todo'), option('b-doing', 'Doing'), option('b-done', 'Done')],
  },
  { id: 'bugs-priority', name: 'Priority', type: FieldType.SingleSelect, options: [todo, doing, done] },
]);
const sources = [tasks, archive, bugs];

function filterOf(patch: Partial<DashboardGlobalFilter>): DashboardGlobalFilter {
  return {
    id: 'gf:1',
    name: '',
    fieldType: FieldType.RichText,
    condition: TextFilterCondition.TextContains,
    content: '',
    targets: {},
    ...patch,
  };
}

describe('available property types', () => {
  it('lists the union of supported types in picker order', () => {
    expect(getAvailableFieldTypes(sources)).toEqual([
      FieldType.RichText,
      FieldType.Number,
      FieldType.SingleSelect,
      FieldType.DateTime,
      FieldType.Person,
    ]);
  });

  it('excludes Time, Relation, Rollup, AI and media properties', () => {
    [
      FieldType.Time,
      FieldType.Relation,
      FieldType.Rollup,
      FieldType.Summary,
      FieldType.Translate,
      FieldType.Media,
    ].forEach((type) => expect(GLOBAL_FILTER_FIELD_TYPES).not.toContain(type));
  });

  it('is empty without sources', () => {
    expect(getAvailableFieldTypes([])).toEqual([]);
  });
});

describe('target defaults', () => {
  it('maps every source with a property of the type to its first such property', () => {
    expect(buildDefaultTargets(sources, FieldType.RichText)).toEqual({
      'db-tasks': 'tasks-name',
      'db-archive': 'archive-title',
      'db-bugs': 'bugs-title',
    });
    expect(buildDefaultTargets(sources, FieldType.DateTime)).toEqual({ 'db-archive': 'archive-date' });
  });

  it('only maps select properties whose options match the primary one by id and name', () => {
    // Bugs' first select has the same names but other ids; its second select matches.
    expect(buildDefaultTargets(sources, FieldType.SingleSelect)).toEqual({
      'db-tasks': 'tasks-status',
      'db-archive': 'archive-state',
      'db-bugs': 'bugs-priority',
    });
  });

  it('creates a filter named after the primary property with the view-filter defaults', () => {
    const filter = createGlobalFilter(sources, FieldType.Number, 'Number');

    expect(filter).toEqual({
      id: expect.stringMatching(/^gf:/),
      name: 'Points',
      fieldType: FieldType.Number,
      condition: NumberFilterCondition.Equal,
      content: '',
      targets: { 'db-tasks': 'tasks-points' },
    });
    expect(createGlobalFilter([], FieldType.Checkbox, 'Checkbox')).toMatchObject({
      name: 'Checkbox',
      condition: CheckboxFilterCondition.IsChecked,
      content: '',
      targets: {},
    });
  });

  it('seeds date filters with today like a new view filter', () => {
    const filter = createGlobalFilter(sources, FieldType.DateTime, 'Date');

    expect(filter.condition).toBe(DateFilterCondition.DateStartsOn);
    expect(parseDateContent(filter.content).timestamp).toEqual(expect.any(Number));
  });
});

describe('target candidates', () => {
  const statusFilter = filterOf({
    fieldType: FieldType.SingleSelect,
    condition: SelectOptionFilterCondition.OptionIs,
    content: 'o-done',
    targets: { 'db-tasks': 'tasks-status' },
  });

  it('offers every property of the type for non-option types', () => {
    const filter = filterOf({ targets: { 'db-tasks': 'tasks-name' } });

    expect(getTargetCandidates(filter, sources, 'db-bugs').map((field) => field.id)).toEqual(['bugs-title']);
  });

  it('offers only compatible select properties outside the primary source', () => {
    expect(getTargetCandidates(statusFilter, sources, 'db-bugs').map((field) => field.id)).toEqual(['bugs-priority']);
    expect(getTargetCandidates(statusFilter, sources, 'db-tasks').map((field) => field.id)).toEqual(['tasks-status']);
  });

  it('offers nothing when the primary property cannot be read', () => {
    const filter = { ...statusFilter, targets: { 'db-missing': 'field' } };

    expect(getTargetCandidates(filter, sources, 'db-bugs')).toEqual([]);
  });

  it('offers only unmapped sources with a usable property for adding', () => {
    const tasksOnly = source('db-tasks', 'Tasks', [
      { id: 'tasks-status', name: 'Status', type: FieldType.SingleSelect, options: [todo] },
    ]);
    const compatible = source('db-copy', 'Copy', [
      { id: 'copy-status', name: 'Status', type: FieldType.SingleSelect, options: [todo, done] },
    ]);
    const unrelated = source('db-other', 'Other', [
      { id: 'other-kind', name: 'Kind', type: FieldType.SingleSelect, options: [option('k', 'Kind')] },
    ]);
    const all = [tasksOnly, compatible, unrelated];
    const filter = { ...statusFilter, targets: { 'db-tasks': 'tasks-status' } };

    expect(getAddableSources(filter, all).map((item) => item.databaseId)).toEqual(['db-copy']);
    // Without any mapping every source with the type can become the primary one.
    expect(getAddableSources({ ...filter, targets: {} }, all).map((item) => item.databaseId)).toEqual([
      'db-tasks',
      'db-copy',
      'db-other',
    ]);
  });

  it('lists mapped sources in mapping order, unloaded ones without properties', () => {
    const filter = filterOf({ targets: { 'db-bugs': 'bugs-title', 'db-gone': 'x', 'db-tasks': 'tasks-name' } });
    const mapped = getMappedSources(filter, sources, (databaseId) => `name of ${databaseId}`);

    expect(mapped.map((item) => item.databaseId)).toEqual(['db-bugs', 'db-gone', 'db-tasks']);
    expect(mapped[0]).toBe(bugs);
    expect(mapped[1]).toEqual({ databaseId: 'db-gone', name: 'name of db-gone', fields: [] });
  });
});

describe('editing targets', () => {
  it('adds a mapping without touching the primary one', () => {
    const filter = filterOf({ name: 'Name', targets: { 'db-tasks': 'tasks-name' } });
    const next = setGlobalFilterTarget(filter, sources, 'db-bugs', 'bugs-title');

    expect(Object.keys(next.targets)).toEqual(['db-tasks', 'db-bugs']);
    expect(next.name).toBe('Name');
    expect(countGlobalFilterSources(next)).toBe(2);
  });

  it('adds a source through its first compatible property', () => {
    const filter = filterOf({
      name: 'Status',
      fieldType: FieldType.SingleSelect,
      condition: SelectOptionFilterCondition.OptionIs,
      content: 'o-done',
      targets: { 'db-tasks': 'tasks-status' },
    });
    const next = addGlobalFilterSource(filter, sources, 'db-bugs');

    // Bugs' Status has other option ids, so its Priority is mapped.
    expect(next.targets).toEqual({ 'db-tasks': 'tasks-status', 'db-bugs': 'bugs-priority' });
    expect(next.content).toBe('o-done');
    expect(addGlobalFilterSource(next, sources, 'db-bugs')).toBe(next);
    expect(addGlobalFilterSource(filter, [tasks], 'db-bugs')).toBe(filter);

    const fresh = addGlobalFilterSource({ ...filter, name: '', targets: {} }, sources, 'db-archive');

    expect(fresh).toMatchObject({ name: 'State', targets: { 'db-archive': 'archive-state' }, content: 'o-done' });
  });

  it('returns the same filter when the mapping does not change', () => {
    const filter = filterOf({ targets: { 'db-tasks': 'tasks-name' } });

    expect(setGlobalFilterTarget(filter, sources, 'db-tasks', 'tasks-name')).toBe(filter);
    expect(removeGlobalFilterTarget(filter, sources, 'db-bugs')).toBe(filter);
  });

  it('re-validates select content and mappings when the primary property changes', () => {
    const filter = filterOf({
      name: 'Status',
      fieldType: FieldType.SingleSelect,
      condition: SelectOptionFilterCondition.OptionIs,
      content: 'o-todo,o-done',
      targets: { 'db-bugs': 'bugs-priority', 'db-tasks': 'tasks-status' },
    });
    const next = setGlobalFilterTarget(filter, sources, 'db-bugs', 'bugs-status');

    // The Bugs status options have other ids: selection and the Tasks mapping are dropped.
    expect(next.targets).toEqual({ 'db-bugs': 'bugs-status' });
    expect(next.content).toBe('');
    // A custom name is kept.
    expect(next.name).toBe('Status');
  });

  it('lets a default name follow the primary property', () => {
    const notes = source('db-notes', 'Notes', [
      { id: 'notes-title', name: 'Title', type: FieldType.RichText, isPrimary: true },
      { id: 'notes-body', name: 'Body', type: FieldType.RichText },
    ]);
    const all = [notes, bugs];
    const filter = filterOf({ name: 'Title', targets: { 'db-notes': 'notes-title', 'db-bugs': 'bugs-title' } });

    expect(setGlobalFilterTarget(filter, all, 'db-notes', 'notes-body').name).toBe('Body');
    expect(setGlobalFilterTarget({ ...filter, name: 'Search' }, all, 'db-notes', 'notes-body').name).toBe('Search');
    expect(setGlobalFilterTarget({ ...filter, name: '' }, all, 'db-notes', 'notes-body').name).toBe('Body');
    // Changing a non-primary mapping never renames.
    expect(setGlobalFilterTarget(filter, all, 'db-bugs', 'bugs-title-2').name).toBe('Title');
    expect(
      removeGlobalFilterTarget(
        { ...filter, name: 'Title', targets: { 'db-notes': 'notes-body', 'db-bugs': 'bugs-title' } },
        all,
        'db-notes'
      )
    ).toMatchObject({ name: 'Title', targets: { 'db-bugs': 'bugs-title' } });
    expect(
      removeGlobalFilterTarget(
        { ...filter, name: 'Body', targets: { 'db-notes': 'notes-body', 'db-bugs': 'bugs-title' } },
        all,
        'db-notes'
      )
    ).toMatchObject({ name: 'Title' });
  });

  it('promotes the next mapping when the primary one is removed', () => {
    const filter = filterOf({
      name: 'Kanban',
      fieldType: FieldType.SingleSelect,
      condition: SelectOptionFilterCondition.OptionIs,
      content: 'o-doing',
      targets: { 'db-tasks': 'tasks-status', 'db-archive': 'archive-state', 'db-bugs': 'bugs-priority' },
    });
    const next = removeGlobalFilterTarget(filter, sources, 'db-tasks');

    expect(getPrimaryTargetField(next, sources)?.id).toBe('archive-state');
    // Bugs' priority lacks the Archive-only option, so it no longer matches the primary.
    expect(next.targets).toEqual({ 'db-archive': 'archive-state' });
    expect(next.content).toBe('o-doing');
    expect(next.name).toBe('Kanban');
  });

  it('keeps the content when the last mapping is removed', () => {
    const filter = filterOf({ content: 'abc', targets: { 'db-tasks': 'tasks-name' } });
    const next = removeGlobalFilterTarget(filter, sources, 'db-tasks');

    expect(next.targets).toEqual({});
    expect(next.content).toBe('abc');
    expect(isGlobalFilterActive(next)).toBe(false);
  });

  it('prunes option content to the field options in option order', () => {
    const field = tasks.fields[1];

    expect(pruneOptionContent('o-done,missing,o-todo', field)).toBe('o-todo,o-done');
    expect(pruneOptionContent('o-done', undefined)).toBe('o-done');
  });
});

describe('mappings that no longer apply', () => {
  const statusFilter = filterOf({
    name: 'Status',
    fieldType: FieldType.SingleSelect,
    condition: SelectOptionFilterCondition.OptionIs,
    content: 'o-doing',
    targets: { 'db-tasks': 'tasks-status', 'db-archive': 'archive-state', 'db-bugs': 'bugs-priority' },
  });

  it('does not count a property that changed type or was deleted', () => {
    const converted = source('db-tasks', 'Tasks', [{ id: 'tasks-status', name: 'Status', type: FieldType.RichText }]);
    const withoutProperty = source('db-archive', 'Archive', []);

    expect(countGlobalFilterSources(statusFilter)).toBe(3);
    expect(countGlobalFilterSources(statusFilter, sources)).toBe(3);
    expect(isGlobalFilterTargetUsable(statusFilter, [converted], 'db-tasks')).toBe(false);
    expect(isGlobalFilterTargetUsable(statusFilter, [withoutProperty], 'db-archive')).toBe(false);
    // A source that is not loaded yet is trusted.
    expect(isGlobalFilterTargetUsable(statusFilter, [converted], 'db-bugs')).toBe(true);
    expect(countGlobalFilterSources(statusFilter, [converted, withoutProperty])).toBe(1);

    const textFilter = filterOf({ content: 'x', targets: { 'db-tasks': 'tasks-status' } });

    expect(isGlobalFilterActive(textFilter)).toBe(true);
    expect(isGlobalFilterActive({ ...textFilter, fieldType: FieldType.Number }, [converted])).toBe(false);
  });

  it('detaches the databases that lost their last widget', () => {
    const remaining = new Set(['db-archive', 'db-bugs']);
    const untouched = filterOf({ id: 'gf:2', targets: { 'db-archive': 'archive-title' } });
    const list = [statusFilter, untouched];
    const next = detachRemovedGlobalFilterSources(list, remaining, sources);

    // The primary Tasks mapping hands over to Archive (its name follows), which re-validates Bugs.
    expect(next[0]).toMatchObject({
      name: 'State',
      content: 'o-doing',
      targets: { 'db-archive': 'archive-state' },
    });
    expect(Object.keys(next[0].targets)).toEqual(['db-archive']);
    expect(next[1]).toBe(untouched);
    expect(detachRemovedGlobalFilterSources(list, new Set(['db-tasks', 'db-archive', 'db-bugs']), sources)).toBe(list);
    // Without the source properties the mappings are simply dropped.
    expect(detachRemovedGlobalFilterSources(list, new Set(['db-bugs']))[0].targets).toEqual({
      'db-bugs': 'bugs-priority',
    });
    expect(countGlobalFilterSources(detachRemovedGlobalFilterSources(list, new Set())[0])).toBe(0);
  });
});

describe('date content', () => {
  it('stores nothing for a cleared date instead of a null date', () => {
    expect(serializeDateContent(false, {})).toBe('');
    expect(serializeDateContent(true, {})).toBe('');
    expect(JSON.parse(serializeDateContent(false, { timestamp: 100 }))).toEqual({ timestamp: 100 });
    // A half range keeps the null start desktop can deserialize.
    expect(JSON.parse(serializeDateContent(true, { end: 200 }))).toEqual({ start: null, end: 200 });
    expect(JSON.parse(serializeDateContent(true, { start: 100 }))).toEqual({ start: 100 });
  });

  it('requires the dates its condition needs', () => {
    expect(hasRequiredDate(DateFilterCondition.DateStartsOn, JSON.stringify({ timestamp: 100 }))).toBe(true);
    expect(hasRequiredDate(DateFilterCondition.DateStartsOn, JSON.stringify({ timestamp: null }))).toBe(false);
    expect(hasRequiredDate(DateFilterCondition.DateStartsOn, '')).toBe(false);
    expect(hasRequiredDate(DateFilterCondition.DateEndsBetween, JSON.stringify({ start: 1, end: 2 }))).toBe(true);
    expect(hasRequiredDate(DateFilterCondition.DateStartsBetween, JSON.stringify({ start: 1 }))).toBe(false);
  });

  it('treats a date filter without its date as inactive', () => {
    const date = filterOf({
      fieldType: FieldType.DateTime,
      condition: DateFilterCondition.DateStartsOn,
      targets: { 'db-archive': 'archive-date' },
    });

    expect(isGlobalFilterActive({ ...date, content: JSON.stringify({ timestamp: null }) })).toBe(false);
    expect(isGlobalFilterActive({ ...date, content: JSON.stringify({ timestamp: 100 }) })).toBe(true);
    expect(isGlobalFilterActive({ ...date, condition: DateFilterCondition.DateStartIsEmpty })).toBe(true);
  });
});

describe('filter list updates', () => {
  const a = filterOf({ id: 'a' });
  const b = filterOf({ id: 'b' });

  it('replaces one filter and keeps identity when nothing changes', () => {
    const list = [a, b];

    expect(replaceGlobalFilter(list, 'b', (filter) => filter)).toBe(list);
    expect(replaceGlobalFilter(list, 'x', (filter) => ({ ...filter, name: 'x' }))).toBe(list);
    expect(replaceGlobalFilter(list, 'b', (filter) => ({ ...filter, name: 'B' }))[1].name).toBe('B');
  });

  it('removes a filter by id', () => {
    const list = [a, b];

    expect(removeGlobalFilter(list, 'a')).toEqual([b]);
    expect(removeGlobalFilter(list, 'x')).toBe(list);
  });
});

describe('conditions', () => {
  it('reuses the view filter condition lists', () => {
    expect(getGlobalFilterConditions(FieldType.RichText, 0, t).map((item) => item.value)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(getGlobalFilterConditions(FieldType.SingleSelect, 0, t).map((item) => item.value)).toEqual([
      SelectOptionFilterCondition.OptionIs,
      SelectOptionFilterCondition.OptionIsNot,
      SelectOptionFilterCondition.OptionIsEmpty,
      SelectOptionFilterCondition.OptionIsNotEmpty,
    ]);
    expect(getGlobalFilterConditions(FieldType.MultiSelect, 2, t)[0].value).toBe(
      SelectOptionFilterCondition.OptionContains
    );
    expect(getGlobalFilterConditions(FieldType.Checkbox, 0, t)).toEqual([
      { value: CheckboxFilterCondition.IsChecked, text: 'dashboard.globalFilters.isChecked' },
      { value: CheckboxFilterCondition.IsUnChecked, text: 'dashboard.globalFilters.isUnchecked' },
    ]);
  });

  it('lists end-date conditions for an end-date filter and hides empty checks on row times', () => {
    const endConditions = getGlobalFilterConditions(FieldType.DateTime, DateFilterCondition.DateEndsOn, t);

    expect(endConditions[0].value).toBe(DateFilterCondition.DateEndsOn);
    expect(endConditions.map((item) => item.value)).toContain(DateFilterCondition.DateEndIsEmpty);
    expect(
      getGlobalFilterConditions(FieldType.CreatedTime, DateFilterCondition.DateStartsOn, t).map((item) => item.value)
    ).not.toContain(DateFilterCondition.DateStartIsEmpty);
  });

  it('hides the value control for empty checks, relative dates and booleans', () => {
    expect(conditionHidesContent(FieldType.RichText, TextFilterCondition.TextIsEmpty)).toBe(true);
    expect(conditionHidesContent(FieldType.RichText, TextFilterCondition.TextIs)).toBe(false);
    expect(conditionHidesContent(FieldType.DateTime, DateFilterCondition.DateStartsToday)).toBe(true);
    expect(conditionHidesContent(FieldType.DateTime, DateFilterCondition.DateStartsBetween)).toBe(false);
    expect(conditionHidesContent(FieldType.Checkbox, CheckboxFilterCondition.IsChecked)).toBe(true);
  });

  it('converts date content between a single date and a range', () => {
    const single = filterOf({
      fieldType: FieldType.DateTime,
      condition: DateFilterCondition.DateStartsOn,
      content: JSON.stringify({ timestamp: 100 }),
    });
    const range = applyConditionChange(single, DateFilterCondition.DateStartsBetween);

    expect(JSON.parse(range.content)).toEqual({ start: 100, end: 100 });
    expect(JSON.parse(applyConditionChange(range, DateFilterCondition.DateStartsAfter).content)).toEqual({
      timestamp: 100,
    });
    expect(applyConditionChange(single, DateFilterCondition.DateStartsOn)).toBe(single);
    expect(applyConditionChange(single, DateFilterCondition.DateStartsToday).content).toBe(single.content);
  });
});

describe('chip label', () => {
  const options = { dateFormat: 'YYYY-MM-DD', t };
  const label = (filter: DashboardGlobalFilter, fallback = 'Fallback') =>
    getGlobalFilterChipText(
      filter,
      getGlobalFilterDescription(filter, { ...options, primaryField: getPrimaryTargetField(filter, sources) }),
      fallback
    );

  it('formats text filters like view filter chips', () => {
    const filter = filterOf({ name: 'Name', content: 'bug', targets: { 'db-tasks': 'tasks-name' } });

    expect(label(filter)).toBe('Name: grid.textFilter.contains bug');
    expect(label({ ...filter, condition: TextFilterCondition.TextIsNot })).toBe(
      'Name: grid.textFilter.choicechipPrefix.isNot bug'
    );
    expect(label({ ...filter, condition: TextFilterCondition.TextIsEmpty, content: '' })).toBe(
      'Name: grid.textFilter.choicechipPrefix.isEmpty'
    );
  });

  it('shows the bare name while the filter has no value or no source', () => {
    expect(label(filterOf({ name: 'Name', targets: { 'db-tasks': 'tasks-name' } }))).toBe('Name');
    expect(label(filterOf({ name: 'Name', content: 'bug' }))).toBe('Name');
    expect(label(filterOf({ name: '  ', content: 'bug' }), 'Text')).toBe('Text');
  });

  it('uses number symbols', () => {
    const filter = filterOf({
      name: 'Points',
      fieldType: FieldType.Number,
      condition: NumberFilterCondition.GreaterThanOrEqualTo,
      content: '3',
      targets: { 'db-tasks': 'tasks-points' },
    });

    expect(label(filter)).toBe('Points: ≥ 3');
  });

  it('names selected options from the primary property', () => {
    const filter = filterOf({
      name: 'Status',
      fieldType: FieldType.SingleSelect,
      condition: SelectOptionFilterCondition.OptionIs,
      content: 'o-done,o-todo',
      targets: { 'db-tasks': 'tasks-status' },
    });

    expect(label(filter)).toBe('Status: grid.selectOptionFilter.is Todo, Done');
    expect(label({ ...filter, targets: { 'db-missing': 'x' } })).toBe('Status: grid.selectOptionFilter.is (2)');
  });

  it('describes checkbox, person and date filters', () => {
    expect(
      label(
        filterOf({
          name: 'Done',
          fieldType: FieldType.Checkbox,
          condition: CheckboxFilterCondition.IsChecked,
          targets: { 'db-tasks': 'x' },
        })
      )
    ).toBe('Done: grid.checkboxFilter.isChecked');
    expect(
      label(
        filterOf({
          name: 'Done',
          fieldType: FieldType.Checkbox,
          condition: CheckboxFilterCondition.IsUnChecked,
          targets: { 'db-tasks': 'x' },
        })
      )
    ).toBe('Done: grid.checkboxFilter.isUnchecked');
    expect(
      label(
        filterOf({
          name: 'Owner',
          fieldType: FieldType.Person,
          condition: PersonFilterCondition.PersonContains,
          content: JSON.stringify(['p1', 'p2']),
          targets: { 'db-tasks': 'tasks-owner' },
        })
      )
    ).toBe('Owner: grid.personFilter.contains: grid.person.count(2)');

    const date = filterOf({
      name: 'Due',
      fieldType: FieldType.DateTime,
      condition: DateFilterCondition.DateStartsToday,
      targets: { 'db-archive': 'archive-date' },
    });

    expect(label(date)).toBe('Due: relativeDates.today');
    expect(
      label({
        ...date,
        condition: DateFilterCondition.DateStartsBetween,
        content: JSON.stringify({ start: 0, end: 86400 }),
      })
    ).toMatch(/^Due: grid\.dateFilter\.choicechipPrefix\.between \d{4}-\d{2}-\d{2} - \d{4}-\d{2}-\d{2}$/);
  });

  it('treats empty checks as active and valueless filters as inactive', () => {
    const base = filterOf({ fieldType: FieldType.Person, targets: { 'db-tasks': 'tasks-owner' } });

    expect(isGlobalFilterActive({ ...base, condition: PersonFilterCondition.PersonContains, content: '' })).toBe(false);
    expect(isGlobalFilterActive({ ...base, condition: PersonFilterCondition.PersonContains, content: '[]' })).toBe(
      false
    );
    expect(isGlobalFilterActive({ ...base, condition: PersonFilterCondition.PersonIsEmpty })).toBe(true);
  });
});

describe('reading source docs', () => {
  it('lists properties primary first, then in column order, with select options', () => {
    const doc = createSourceDoc(
      'db-1',
      [
        { id: 'f-status', name: 'Status', type: FieldType.SingleSelect, options: [todo, done] },
        { id: 'f-name', name: 'Name', type: FieldType.RichText, isPrimary: true },
        { id: 'f-points', name: 'Points', type: FieldType.Number },
      ],
      ['f-points', 'f-name', 'f-status']
    );

    expect(readGlobalFilterSourceFields(doc)).toEqual([
      { id: 'f-name', name: 'Name', type: FieldType.RichText, isPrimary: true, options: [] },
      { id: 'f-points', name: 'Points', type: FieldType.Number, isPrimary: false, options: [] },
      { id: 'f-status', name: 'Status', type: FieldType.SingleSelect, isPrimary: false, options: [todo, done] },
    ]);

    addField(doc, { id: 'f-done', name: 'Done', type: FieldType.Checkbox });
    expect(readGlobalFilterSourceFields(doc).map((field) => field.id)).toEqual([
      'f-name',
      'f-points',
      'f-status',
      'f-done',
    ]);
  });
});
