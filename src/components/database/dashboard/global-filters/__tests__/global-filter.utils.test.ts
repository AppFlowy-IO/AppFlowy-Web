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
  getGlobalFilterConditions,
  hasRequiredDate,
  isGlobalFilterActive,
  parseDateContent,
  serializeDateContent,
  Translate,
} from '../global-filter.conditions';
import {
  countUsableTargets,
  createGlobalFilterForField,
  detachRemovedGlobalFilterSources,
  findSingleTargetFilter,
  getAddableSources,
  getMappedSources,
  getPrimaryTargetField,
  getTargetCandidates,
  getUsableTargets,
  GLOBAL_FILTER_FIELD_TYPES,
  isGlobalFilterTargetUsable,
  removeGlobalFilter,
  removeGlobalFilterTarget,
  replaceGlobalFilter,
  setGlobalFilterTarget,
} from '../global-filter.utils';
import { readGlobalFilterSourceFields } from '../global-filter.source-fields';

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

describe('property types', () => {
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
});

describe('a filter for one property', () => {
  it('maps exactly that property, named after it, with the view-filter default condition', () => {
    const filter = createGlobalFilterForField('db-tasks', tasks.fields[2], 'Number');

    expect(filter).toEqual({
      id: expect.stringMatching(/^gf:/),
      name: 'Points',
      fieldType: FieldType.Number,
      condition: NumberFilterCondition.Equal,
      content: '',
      targets: { 'db-tasks': 'tasks-points' },
    });
    // No auto-mapping of the other sources, even when they have the type.
    expect(Object.keys(createGlobalFilterForField('db-tasks', tasks.fields[0], 'Text').targets)).toEqual(['db-tasks']);
    expect(
      createGlobalFilterForField('db-x', { id: 'f', name: '', type: FieldType.Checkbox }, 'Checkbox')
    ).toMatchObject({
      name: 'Checkbox',
      condition: CheckboxFilterCondition.IsChecked,
      content: '',
    });
  });

  it('starts every type without a value, dates too', () => {
    const date = createGlobalFilterForField('db-archive', archive.fields[2], 'Date');

    expect(date.condition).toBe(DateFilterCondition.DateStartsOn);
    expect(date.content).toBe('');
    expect(parseDateContent(date.content)).toEqual({});
    expect(isGlobalFilterActive(date)).toBe(false);
  });

  it('finds the filter whose only mapping is that property', () => {
    const single = filterOf({ id: 'single', targets: { 'db-tasks': 'tasks-name' } });
    const shared = filterOf({ id: 'shared', targets: { 'db-tasks': 'tasks-name', 'db-bugs': 'bugs-title' } });

    expect(findSingleTargetFilter([shared, single], 'db-tasks', 'tasks-name')).toBe(single);
    expect(findSingleTargetFilter([shared], 'db-tasks', 'tasks-name')).toBeUndefined();
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

  it('offers every select property of the type: options are matched by name', () => {
    expect(getTargetCandidates(statusFilter, sources, 'db-bugs').map((field) => field.id)).toEqual([
      'bugs-status',
      'bugs-priority',
    ]);
    expect(getTargetCandidates(statusFilter, sources, 'db-tasks').map((field) => field.id)).toEqual(['tasks-status']);
    expect(
      getTargetCandidates({ ...statusFilter, targets: { 'db-missing': 'field' } }, sources, 'db-bugs')
    ).toHaveLength(2);
  });

  it('offers every unmapped source with a property of the type for adding', () => {
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

    expect(getAddableSources(filter, all).map((item) => item.databaseId)).toEqual(['db-copy', 'db-other']);
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
    expect(countUsableTargets(next)).toBe(2);
  });

  it('returns the same filter when the mapping does not change', () => {
    const filter = filterOf({ targets: { 'db-tasks': 'tasks-name' } });

    expect(setGlobalFilterTarget(filter, sources, 'db-tasks', 'tasks-name')).toBe(filter);
    expect(removeGlobalFilterTarget(filter, sources, 'db-bugs')).toBe(filter);
  });

  it('keeps the selection, its names and the other mappings when the primary property changes', () => {
    const filter = filterOf({
      name: 'Priority',
      fieldType: FieldType.SingleSelect,
      condition: SelectOptionFilterCondition.OptionIs,
      content: 'o-todo,o-done',
      optionNames: ['Todo', 'Done'],
      targets: { 'db-bugs': 'bugs-priority', 'db-tasks': 'tasks-status' },
    });
    const next = setGlobalFilterTarget(filter, sources, 'db-bugs', 'bugs-status');

    expect(next.targets).toEqual({ 'db-bugs': 'bugs-status', 'db-tasks': 'tasks-status' });
    expect(next.content).toBe('o-todo,o-done');
    expect(next.optionNames).toEqual(['Todo', 'Done']);
    // A default name follows the primary property; a custom one is kept.
    expect(next.name).toBe('Status');
    expect(setGlobalFilterTarget({ ...filter, name: 'Board' }, sources, 'db-bugs', 'bugs-status').name).toBe('Board');
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
    // The other mappings stay: options are matched by name per source.
    expect(next.targets).toEqual({ 'db-archive': 'archive-state', 'db-bugs': 'bugs-priority' });
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

    expect(countUsableTargets(statusFilter)).toBe(3);
    expect(countUsableTargets(statusFilter, sources)).toBe(3);
    expect(isGlobalFilterTargetUsable(statusFilter, [converted], 'db-tasks')).toBe(false);
    expect(isGlobalFilterTargetUsable(statusFilter, [withoutProperty], 'db-archive')).toBe(false);
    // A source that is not loaded yet is trusted.
    expect(isGlobalFilterTargetUsable(statusFilter, [converted], 'db-bugs')).toBe(true);
    expect(countUsableTargets(statusFilter, [converted, withoutProperty])).toBe(1);

    const textFilter = filterOf({ content: 'x', targets: { 'db-tasks': 'tasks-status' } });

    expect(isGlobalFilterActive(textFilter)).toBe(true);
    expect(isGlobalFilterActive({ ...textFilter, fieldType: FieldType.Number }, [converted])).toBe(false);
  });

  it('detaches the databases that lost their last widget', () => {
    const remaining = new Set(['db-archive', 'db-bugs']);
    const untouched = filterOf({ id: 'gf:2', targets: { 'db-archive': 'archive-title' } });
    const list = [statusFilter, untouched];
    const next = detachRemovedGlobalFilterSources(list, remaining, sources);

    // The primary Tasks mapping hands over to Archive (its name follows); Bugs stays.
    expect(next[0]).toMatchObject({
      name: 'State',
      content: 'o-doing',
      targets: { 'db-archive': 'archive-state', 'db-bugs': 'bugs-priority' },
    });
    expect(Object.keys(next[0].targets)).toEqual(['db-archive', 'db-bugs']);
    expect(next[1]).toBe(untouched);
    expect(detachRemovedGlobalFilterSources(list, new Set(['db-tasks', 'db-archive', 'db-bugs']), sources)).toBe(list);
    // Without the source properties the mappings are simply dropped.
    expect(detachRemovedGlobalFilterSources(list, new Set(['db-bugs']))[0].targets).toEqual({
      'db-bugs': 'bugs-priority',
    });
    expect(countUsableTargets(detachRemovedGlobalFilterSources(list, new Set())[0])).toBe(0);
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

  it('hides the value control for empty checks, date presets and booleans', () => {
    expect(conditionHidesContent(FieldType.RichText, TextFilterCondition.TextIsEmpty)).toBe(true);
    expect(conditionHidesContent(FieldType.RichText, TextFilterCondition.TextIs)).toBe(false);
    expect(conditionHidesContent(FieldType.DateTime, DateFilterCondition.DateStartsToday)).toBe(true);
    // "Is relative to today" shows its builder.
    expect(conditionHidesContent(FieldType.DateTime, DateFilterCondition.DateStartsRelative)).toBe(false);
    expect(conditionHidesContent(FieldType.CreatedTime, DateFilterCondition.DateEndsRelative)).toBe(false);
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

  it('starts a relative condition at This week and clears it on the way back', () => {
    const single = filterOf({
      fieldType: FieldType.DateTime,
      condition: DateFilterCondition.DateStartsOn,
      content: JSON.stringify({ timestamp: 100 }),
    });
    const relative = applyConditionChange(single, DateFilterCondition.DateStartsRelative);

    expect(JSON.parse(relative.content)).toEqual({
      relative_direction: 'this',
      relative_amount: 1,
      relative_unit: 'week',
    });
    expect(isGlobalFilterActive({ ...relative, targets: { 'db-archive': 'archive-date' } })).toBe(true);
    // The end side keeps the spec.
    expect(applyConditionChange(relative, DateFilterCondition.DateEndsRelative).content).toBe(relative.content);
    expect(applyConditionChange(relative, DateFilterCondition.DateStartsAfter).content).toBe('');
  });

  it('lists the relative condition right after "Is between"', () => {
    const values = getGlobalFilterConditions(FieldType.DateTime, DateFilterCondition.DateStartsOn, t).map(
      (item) => item.value
    );

    expect(values.slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, DateFilterCondition.DateStartsRelative, 6, 7]);
    expect(
      getGlobalFilterConditions(FieldType.DateTime, DateFilterCondition.DateEndsOn, t).map((item) => item.value)
    ).toContain(DateFilterCondition.DateEndsRelative);
  });
});

describe('active filters', () => {
  it('treats empty checks as active and valueless filters as inactive', () => {
    const base = filterOf({ fieldType: FieldType.Person, targets: { 'db-tasks': 'tasks-owner' } });

    expect(isGlobalFilterActive({ ...base, condition: PersonFilterCondition.PersonContains, content: '' })).toBe(false);
    expect(isGlobalFilterActive({ ...base, condition: PersonFilterCondition.PersonContains, content: '[]' })).toBe(
      false
    );
    expect(isGlobalFilterActive({ ...base, condition: PersonFilterCondition.PersonIsEmpty })).toBe(true);
  });

  it('lists the usable mappings with their source and property', () => {
    const converted = source('db-tasks', 'Tasks', [{ id: 'tasks-status', name: 'Status', type: FieldType.RichText }]);
    const filter = filterOf({
      fieldType: FieldType.SingleSelect,
      targets: { 'db-tasks': 'tasks-status', 'db-archive': 'archive-state', 'db-unloaded': 'x' },
    });

    expect(
      getUsableTargets(filter, [converted, archive]).map((target) => [target.databaseId, target.field?.name ?? null])
    ).toEqual([
      ['db-archive', 'State'],
      ['db-unloaded', null],
    ]);
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
