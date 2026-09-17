/**
 * Formula behaviour for every database field type: the static type a
 * `prop()` reference gets, the value read from a filled and an empty cell,
 * and the operations a formula typically applies to that type.
 */
import dayjs from 'dayjs';
import * as Y from 'yjs';

import {
  CalculationType,
  FieldType,
  FilterType,
  RollupDisplayMode,
  SortCondition,
} from '@/application/database-yjs/database.type';
import { filterBy } from '@/application/database-yjs/filter';
import { memberNames } from '@/application/database-yjs/formula/read-context';
import { Row } from '@/application/database-yjs/selector';
import { sortBy } from '@/application/database-yjs/sort';
import {
  MentionablePerson,
  MentionPersonRole,
  RowId,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDatabaseSort,
  YDatabaseSorts,
  YDoc,
  YjsDatabaseKey,
} from '@/application/types';

import { formulaTypeOfField, ReadFieldValueContext } from '../cell-values';
import { clearFormulaCompileCache, compileFormula } from '../compile';
import { evaluateFormulaCell } from '../evaluate';
import { FormulaCellResult } from '../formula.type';
import { collectFormulaExternalReferences } from '../references';
import { readFormulaSchema } from '../schema';
import { typeToString } from '../values';

import { createFields, createRow, FieldSpec, mediaItem, selectOptions } from './fixture';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const PERSON_ADA = '2f3c1c1e-0000-4000-8000-00000000000a';
const PERSON_GRACE = '2f3c1c1e-0000-4000-8000-00000000000b';
const ANONYMOUS = '00000000-0000-0000-0000-000000000000';
const JOINED = dayjs('2024-03-10T00:00:00');
const TRIP_END = dayjs('2024-03-17T00:00:00');
const CREATED = dayjs('2024-01-02T09:30:00');
const EDITED = dayjs('2024-02-05T16:45:00');
const NOW = dayjs('2024-03-01T12:00:00').valueOf();

/** Every field type, with the name a formula uses. */
const FIELDS: FieldSpec[] = [
  { id: 'f-text', name: 'Title', type: FieldType.RichText },
  { id: 'f-number', name: 'Price', type: FieldType.Number },
  { id: 'f-date', name: 'Due', type: FieldType.DateTime },
  {
    id: 'f-select',
    name: 'Status',
    type: FieldType.SingleSelect,
    typeOption: {
      content: selectOptions([
        ['st-todo', 'To do'],
        ['st-done', 'Done'],
      ]),
    },
  },
  {
    id: 'f-multi',
    name: 'Tags',
    type: FieldType.MultiSelect,
    typeOption: {
      content: selectOptions([
        ['tg-a', 'Urgent'],
        ['tg-b', 'Home'],
        ['tg-c', 'Work'],
      ]),
    },
  },
  { id: 'f-checkbox', name: 'Done', type: FieldType.Checkbox },
  { id: 'f-url', name: 'Link', type: FieldType.URL },
  { id: 'f-checklist', name: 'Steps', type: FieldType.Checklist },
  { id: 'f-edited', name: 'Edited', type: FieldType.LastEditedTime },
  { id: 'f-created', name: 'Created', type: FieldType.CreatedTime },
  { id: 'f-relation', name: 'Projects', type: FieldType.Relation, typeOption: { database_id: 'db-projects' } },
  { id: 'f-summary', name: 'Summary', type: FieldType.Summary },
  { id: 'f-translate', name: 'Translation', type: FieldType.Translate },
  { id: 'f-time', name: 'Duration', type: FieldType.Time },
  { id: 'f-media', name: 'Files', type: FieldType.Media },
  {
    id: 'f-person',
    name: 'Owner',
    type: FieldType.Person,
    typeOption: { persons: JSON.stringify([{ id: PERSON_GRACE, name: 'Grace (recorded)' }]) },
  },
  {
    id: 'f-rollup-sum',
    name: 'Budget',
    type: FieldType.Rollup,
    typeOption: {
      relation_field_id: 'f-relation',
      target_field_id: 'x',
      calculation_type: CalculationType.Sum,
      show_as: RollupDisplayMode.Calculated,
    },
  },
  {
    id: 'f-rollup-list',
    name: 'Project names',
    type: FieldType.Rollup,
    typeOption: {
      relation_field_id: 'f-relation',
      target_field_id: 'x',
      calculation_type: CalculationType.Count,
      show_as: RollupDisplayMode.OriginalList,
    },
  },
  { id: 'f-created-by', name: 'Author', type: FieldType.CreatedBy },
  { id: 'f-edited-by', name: 'Editor', type: FieldType.LastEditedBy },
];

function buildDatabase(formulas: Record<string, string>) {
  const fields = createFields([
    ...FIELDS,
    ...Object.entries(formulas).map(([name, expression]) => ({
      id: `formula-${name}`,
      name,
      type: FieldType.Formula,
      typeOption: { expression },
    })),
  ]);

  return { fields, schema: readFormulaSchema(fields) };
}

function filledRow() {
  return createRow(
    'row-filled',
    {
      'f-text': { type: FieldType.RichText, data: 'Launch plan' },
      'f-number': { type: FieldType.Number, data: '1250.5' },
      'f-date': {
        type: FieldType.DateTime,
        data: String(JOINED.unix()),
        extra: { is_range: true, end_timestamp: String(TRIP_END.unix()), include_time: false },
      },
      'f-select': { type: FieldType.SingleSelect, data: 'st-done' },
      'f-multi': { type: FieldType.MultiSelect, data: 'tg-a,tg-c' },
      'f-checkbox': { type: FieldType.Checkbox, data: 'Yes' },
      'f-url': { type: FieldType.URL, data: 'https://docs.appflowy.io/guide' },
      'f-checklist': {
        type: FieldType.Checklist,
        data: JSON.stringify({
          options: [
            { id: 'c1', name: 'Draft' },
            { id: 'c2', name: 'Review' },
            { id: 'c3', name: 'Ship' },
            { id: 'c4', name: 'Announce' },
          ],
          selected_option_ids: ['c1', 'c2', 'c3'],
        }),
      },
      'f-relation': { type: FieldType.Relation, data: { yArray: ['proj-1', 'proj-2', 'proj-3'] } },
      'f-summary': { type: FieldType.Summary, data: 'Ship the beta in March.' },
      'f-translate': { type: FieldType.Translate, data: 'Lancer la bêta en mars.' },
      'f-time': { type: FieldType.Time, data: '5400000' },
      'f-media': {
        type: FieldType.Media,
        data: { yArray: [mediaItem('m1', 'spec.pdf'), mediaItem('m2', 'mock.png')] },
      },
      'f-person': { type: FieldType.Person, data: JSON.stringify([PERSON_ADA, PERSON_GRACE, ANONYMOUS]) },
    },
    {
      createdAt: String(CREATED.unix()),
      lastModified: String(EDITED.unix()),
      createdBy: 101,
      lastEditedBy: '202',
    }
  ).row;
}

function emptyRow() {
  return createRow('row-empty', {}, {}).row;
}

const TITLES: Record<string, string> = { 'proj-1': 'Website', 'proj-2': 'Mobile app', 'proj-3': '' };

/** Resolvers as the app provides them once members, titles and rollups have loaded. */
const LOADED: ReadFieldValueContext = {
  getUserName: (uid) => ({ '101': 'Ada Lovelace', '202': 'Grace Hopper' }[uid]),
  getPersonName: (id) => ({ [PERSON_ADA]: 'Ada Lovelace' }[id]),
  getRelatedRowTitle: (_field, id) => TITLES[id],
  getRollupValue: (fieldId) =>
    fieldId === 'f-rollup-sum'
      ? { value: '$4,200', rawNumeric: 4200 }
      : fieldId === 'f-rollup-list'
      ? { value: 'Website, Mobile app', list: ['Website', 'Mobile app'] }
      : undefined,
};

function run(
  expression: string,
  row: YDatabaseRow = filledRow(),
  context: ReadFieldValueContext = LOADED
): FormulaCellResult {
  const { fields, schema } = buildDatabase({ probe: expression });

  return evaluateFormulaCell({
    ...context,
    schema,
    field: fields.get('formula-probe'),
    fieldId: 'formula-probe',
    row,
    rowId: 'row-filled',
    now: () => NOW,
  });
}

function typeOf(expression: string): string {
  const { schema } = buildDatabase({});

  return typeToString(compileFormula(expression, schema, 'formula-probe').resultType);
}

beforeEach(() => {
  clearFormulaCompileCache();
});

// ---------------------------------------------------------------------------
// Coverage guard
// ---------------------------------------------------------------------------

describe('formula field type coverage', () => {
  it('has a case for every field type', () => {
    const covered = new Set([...FIELDS.map((field) => field.type), FieldType.Formula]);
    const all = Object.values(FieldType).filter((value): value is FieldType => typeof value === 'number');

    expect(all.filter((type) => !covered.has(type))).toEqual([]);
  });

  it.each([
    ['Title', 'text'],
    ['Price', 'number'],
    ['Due', 'date'],
    ['Status', 'text'],
    ['Tags', 'list<text>'],
    ['Done', 'boolean'],
    ['Link', 'text'],
    ['Steps', 'number'],
    ['Edited', 'date'],
    ['Created', 'date'],
    ['Projects', 'list<text>'],
    ['Summary', 'text'],
    ['Translation', 'text'],
    ['Duration', 'number'],
    ['Files', 'list<text>'],
    ['Owner', 'list<text>'],
    ['Budget', 'number'],
    ['Project names', 'list<text>'],
    ['Author', 'list<text>'],
    ['Editor', 'list<text>'],
  ])('prop("%s") is typed %s', (name, type) => {
    expect(typeOf(`prop("${name}")`)).toBe(type);
  });

  it('types a rollup by its settings', () => {
    const fields = createFields([
      {
        id: 'r-number',
        name: 'n',
        type: FieldType.Rollup,
        typeOption: { calculation_type: CalculationType.Average, show_as: RollupDisplayMode.Calculated },
      },
      {
        id: 'r-unique',
        name: 'u',
        type: FieldType.Rollup,
        typeOption: { calculation_type: CalculationType.Count, show_as: RollupDisplayMode.UniqueList },
      },
      {
        id: 'r-text',
        name: 't',
        type: FieldType.Rollup,
        typeOption: { calculation_type: CalculationType.DateRange, show_as: RollupDisplayMode.Calculated },
      },
    ]);
    const [number, unique, textRollup] = readFormulaSchema(fields);

    expect(typeToString(formulaTypeOfField(number))).toBe('number');
    expect(typeToString(formulaTypeOfField(unique))).toBe('list<text>');
    expect(typeToString(formulaTypeOfField(textRollup))).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// Per field type
// ---------------------------------------------------------------------------

describe('Text', () => {
  it('reads, transforms and measures text', () => {
    expect(run('prop("Title")').text).toBe('Launch plan');
    expect(run('upper(prop("Title")) + "!"').text).toBe('LAUNCH PLAN!');
    expect(run('prop("Title").length()').text).toBe('11');
    expect(run('contains(prop("Title"), "plan")').rawBoolean).toBe(true);
  });

  it('reads an empty cell as empty', () => {
    expect(run('prop("Title")', emptyRow())).toMatchObject({ text: '', resultType: 'text' });
    expect(run('empty(prop("Title"))', emptyRow()).rawBoolean).toBe(true);
  });
});

describe('Number', () => {
  it('computes with the number', () => {
    expect(run('prop("Price")').rawNumeric).toBe(1250.5);
    expect(run('round(prop("Price") * 1.08, 2)').text).toBe('1350.54');
    expect(run('prop("Price") > 1000 ? "High" : "Low"').text).toBe('High');
    expect(run('formatNumber(prop("Price"), "usd", 2)').text).toBe('$1,250.50');
  });

  it('treats an empty number as empty and as 0 in arithmetic', () => {
    expect(run('prop("Price")', emptyRow()).text).toBe('');
    expect(run('prop("Price") + 1', emptyRow()).text).toBe('1');
    expect(run('empty(prop("Price"))', emptyRow()).rawBoolean).toBe(true);
  });
});

describe('Date', () => {
  it('reads a date range and its parts', () => {
    expect(run('formatDate(dateStart(prop("Due")), "YYYY-MM-DD")').text).toBe('2024-03-10');
    expect(run('formatDate(dateEnd(prop("Due")), "YYYY-MM-DD")').text).toBe('2024-03-17');
    expect(run('dateBetween(dateEnd(prop("Due")), dateStart(prop("Due")), "days")').text).toBe('7');
    expect(run('dateBetween(dateStart(prop("Due")), now(), "days")').text).toBe('8');
    expect(run('formatDate(dateAdd(prop("Due"), 1, "months"), "MMM D")').text).toBe('Apr 10');
  });

  it('is empty without a date', () => {
    expect(run('prop("Due")', emptyRow()).text).toBe('');
    expect(run('if(empty(prop("Due")), "No date", "Scheduled")', emptyRow()).text).toBe('No date');
  });
});

describe('Select', () => {
  it('reads the option name', () => {
    expect(run('prop("Status")').text).toBe('Done');
    expect(run('prop("Status") == "Done"').rawBoolean).toBe(true);
    expect(run('ifs(prop("Status") == "Done", "✅", prop("Status") == "To do", "🕒", "❔")').text).toBe('✅');
  });

  it('is empty without an option', () => {
    expect(run('prop("Status")', emptyRow()).text).toBe('');
  });
});

describe('Multi-select', () => {
  it('reads the option names as a list', () => {
    expect(run('prop("Tags")').text).toBe('Urgent, Work');
    expect(run('prop("Tags").length()').text).toBe('2');
    expect(run('prop("Tags").includes("Urgent")').rawBoolean).toBe(true);
    expect(run('prop("Tags").map(lower(current)).join("/")').text).toBe('urgent/work');
  });

  it('is an empty list without options', () => {
    expect(run('prop("Tags").length()', emptyRow()).text).toBe('0');
    expect(run('empty(prop("Tags"))', emptyRow()).rawBoolean).toBe(true);
  });
});

describe('Checkbox', () => {
  it('reads a boolean', () => {
    expect(run('prop("Done")')).toMatchObject({ resultType: 'boolean', rawBoolean: true, text: 'Yes' });
    expect(run('if(prop("Done"), "Complete", "Open")').text).toBe('Complete');
    expect(run('not prop("Done")').rawBoolean).toBe(false);
  });

  it('is unchecked without a value', () => {
    expect(run('prop("Done")', emptyRow()).rawBoolean).toBe(false);
  });
});

describe('URL', () => {
  it('reads the address as text', () => {
    expect(run('prop("Link")').text).toBe('https://docs.appflowy.io/guide');
    expect(run('replace(prop("Link"), "https://", "")').text).toBe('docs.appflowy.io/guide');
    expect(run('test(prop("Link"), "^https://")').rawBoolean).toBe(true);
    expect(run('split(prop("Link"), "/").at(2)').text).toBe('docs.appflowy.io');
  });

  it('is empty without an address', () => {
    expect(run('prop("Link")', emptyRow()).text).toBe('');
  });
});

describe('Checklist', () => {
  it('reads the percentage of done items', () => {
    expect(run('prop("Steps")').rawNumeric).toBe(75);
    expect(run('prop("Steps") == 100 ? "Complete" : format(prop("Steps")) + "%"').text).toBe('75%');
    expect(run('repeat("■", floor(prop("Steps") / 25)) + repeat("□", 4 - floor(prop("Steps") / 25))').text).toBe('■■■□');
  });

  it('is empty without items', () => {
    expect(run('prop("Steps")', emptyRow()).text).toBe('');
  });
});

describe('Created time and Last edited time', () => {
  it('read the row timestamps', () => {
    expect(run('formatDate(prop("Created"), "YYYY-MM-DD HH:mm")').text).toBe('2024-01-02 09:30');
    expect(run('formatDate(prop("Edited"), "YYYY-MM-DD HH:mm")').text).toBe('2024-02-05 16:45');
    expect(run('dateBetween(prop("Edited"), prop("Created"), "days")').text).toBe('34');
    expect(run('prop("Created")').resultType).toBe('date');
  });

  it('are empty without timestamps', () => {
    expect(run('prop("Created")', emptyRow()).text).toBe('');
    expect(run('prop("Edited")', emptyRow()).text).toBe('');
  });
});

describe('Relation', () => {
  it('reads the related rows as their titles', () => {
    expect(run('prop("Projects").length()').text).toBe('3');
    expect(run('prop("Projects").filter(not empty(current)).join(" + ")').text).toBe('Website + Mobile app');
    expect(run('prop("Projects").includes("Website")').rawBoolean).toBe(true);
  });

  it('keeps the count while titles are loading', () => {
    const loading = { ...LOADED, getRelatedRowTitle: () => undefined };

    expect(run('prop("Projects").length()', filledRow(), loading).text).toBe('3');
    expect(run('prop("Projects").join(",")', filledRow(), loading).text).toBe(',,');
    expect(run('prop("Projects").join(",")', filledRow(), {}).text).toBe(',,');
  });

  it('is an empty list without related rows', () => {
    expect(run('prop("Projects").length()', emptyRow()).text).toBe('0');
    expect(run('empty(prop("Projects"))', emptyRow()).rawBoolean).toBe(true);
  });
});

describe('AI Summary and AI Translate', () => {
  it('read the generated text', () => {
    expect(run('prop("Summary")').text).toBe('Ship the beta in March.');
    expect(run('contains(prop("Summary"), "beta")').rawBoolean).toBe(true);
    expect(run('prop("Translation").length()').text).toBe('23');
  });

  it('are empty before generation', () => {
    expect(run('prop("Summary")', emptyRow()).text).toBe('');
    expect(run('empty(prop("Translation"))', emptyRow()).rawBoolean).toBe(true);
  });
});

describe('Time', () => {
  it('reads the time in milliseconds', () => {
    expect(run('prop("Duration")').rawNumeric).toBe(5_400_000);
    expect(run('prop("Duration") / 60000').text).toBe('90');
    expect(
      run('format(floor(prop("Duration") / 3600000)) + "h " + format(prop("Duration") / 60000 % 60) + "m"').text
    ).toBe('1h 30m');
  });

  it('reads typed durations and clock times', () => {
    const typed = createRow('row-typed', { 'f-time': { type: FieldType.Time, data: '2h15m' } }).row;
    const clock = createRow('row-clock', { 'f-time': { type: FieldType.Time, data: '08:30' } }).row;

    expect(run('prop("Duration") / 60000', typed).text).toBe('135');
    expect(run('prop("Duration") / 60000', clock).text).toBe('510');
  });

  it('is empty without a time', () => {
    expect(run('prop("Duration")', emptyRow()).text).toBe('');
  });
});

describe('Files & media', () => {
  it('reads the file names', () => {
    expect(run('prop("Files")').text).toBe('spec.pdf, mock.png');
    expect(run('prop("Files").length()').text).toBe('2');
    expect(run('prop("Files").some(test(current, "\\\\.pdf$"))').rawBoolean).toBe(true);
  });

  it('is an empty list without files', () => {
    expect(run('prop("Files").length()', emptyRow()).text).toBe('0');
  });
});

describe('Person', () => {
  it('reads member names, then names the field recorded', () => {
    expect(run('prop("Owner")').text).toBe('Ada Lovelace, Grace (recorded), Anonymous');
    expect(run('prop("Owner").length()').text).toBe('3');
    expect(run('prop("Owner").includes("Ada Lovelace")').rawBoolean).toBe(true);
    expect(run('prop("Owner").first()').text).toBe('Ada Lovelace');
  });

  it('keeps unknown members as blank names', () => {
    expect(run('prop("Owner").join("|")', filledRow(), {}).text).toBe('|Grace (recorded)|Anonymous');
  });

  it('is an empty list without people', () => {
    expect(run('prop("Owner").length()', emptyRow()).text).toBe('0');
    expect(run('empty(prop("Owner"))', emptyRow()).rawBoolean).toBe(true);
  });
});

describe('Rollup', () => {
  it('reads a numeric rollup as a number', () => {
    expect(run('prop("Budget")').rawNumeric).toBe(4200);
    expect(run('prop("Budget") / 2').text).toBe('2100');
    expect(run('prop("Budget") > 4000').rawBoolean).toBe(true);
  });

  it('reads a list rollup as a list', () => {
    expect(run('prop("Project names").length()').text).toBe('2');
    expect(run('prop("Project names").sort().join(" & ")').text).toBe('Mobile app & Website');
  });

  it('is empty until the rollup is computed', () => {
    expect(run('prop("Budget")', filledRow(), {}).text).toBe('');
    expect(run('prop("Budget") + 1', filledRow(), {}).text).toBe('1');
    expect(run('prop("Project names").length()', filledRow(), {}).text).toBe('0');
  });
});

describe('Created by and Last edited by', () => {
  it('read member names', () => {
    expect(run('prop("Author")').text).toBe('Ada Lovelace');
    expect(run('prop("Editor").first()').text).toBe('Grace Hopper');
    expect(run('prop("Author").first() == prop("Editor").first()').rawBoolean).toBe(false);
  });

  it('fall back to the user id like the cell', () => {
    expect(run('prop("Author")', filledRow(), {}).text).toBe('User 101');
  });

  it('are empty lists without an actor', () => {
    expect(run('prop("Author").length()', emptyRow()).text).toBe('0');
    expect(run('empty(prop("Editor"))', emptyRow()).rawBoolean).toBe(true);
  });
});

describe('Formula', () => {
  it('reads another formula with its result type', () => {
    const { fields, schema } = buildDatabase({
      subtotal: 'prop("Price") * 2',
      label: 'format(prop("subtotal")) + " for " + prop("Title")',
      probe: 'prop("label")',
    });
    const result = evaluateFormulaCell({
      ...LOADED,
      schema,
      field: fields.get('formula-probe'),
      fieldId: 'formula-probe',
      row: filledRow(),
      rowId: 'row-filled',
    });

    expect(result).toMatchObject({ text: '2501 for Launch plan', resultType: 'text' });
    expect(typeToString(compileFormula('prop("subtotal")', schema, 'formula-probe').resultType)).toBe('number');
  });

  it('passes names, titles and rollups through to nested formulas', () => {
    const { fields, schema } = buildDatabase({
      people: 'prop("Owner").first() + " / " + prop("Author").first()',
      probe: 'prop("people") + " / " + prop("Projects").first() + " / " + format(prop("Budget"))',
    });
    const result = evaluateFormulaCell({
      ...LOADED,
      schema,
      field: fields.get('formula-probe'),
      fieldId: 'formula-probe',
      row: filledRow(),
      rowId: 'row-filled',
    });

    expect(result.text).toBe('Ada Lovelace / Ada Lovelace / Website / 4200');
  });
});

// ---------------------------------------------------------------------------
// External references and member names
// ---------------------------------------------------------------------------

describe('formula external references', () => {
  it('finds people, relations and rollups directly and through other formulas', () => {
    const { fields, schema } = buildDatabase({
      budget: 'prop("f-rollup-sum") * 2',
      plain: 'prop("f-number") + 1',
      probe: 'prop("formula-budget") + prop("f-relation").length() + prop("f-created-by").length()',
    });
    const references = collectFormulaExternalReferences(fields.get('formula-probe'), schema);

    expect(references.people).toBe(true);
    expect(references.relations.map((entry) => entry.id)).toEqual(['f-relation']);
    expect(references.rollups.map((entry) => entry.id)).toEqual(['f-rollup-sum']);
    expect(collectFormulaExternalReferences(fields.get('formula-plain'), schema)).toEqual({
      people: false,
      relations: [],
      rollups: [],
    });
  });

  it('stops at formula cycles', () => {
    const { fields, schema } = buildDatabase({ a: 'prop("formula-b")', b: 'prop("formula-a") + prop("f-person")' });

    expect(collectFormulaExternalReferences(fields.get('formula-a'), schema).people).toBe(true);
  });
});

describe('member names', () => {
  const member = (overrides: Partial<MentionablePerson>): MentionablePerson => ({
    uid: '1',
    person_id: 'p-1',
    name: '',
    email: '',
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    role: MentionPersonRole.Member,
    invited: false,
    last_mentioned_at: null,
    ...overrides,
  });

  it('look people up by uid and person id, falling back to the email', () => {
    const names = memberNames([
      member({ uid: 101, person_id: 'p-ada', name: ' Ada ' }),
      member({ uid: '202', person_id: 'p-grace', name: '', email: 'grace@example.com' }),
    ]);

    expect(names.getUserName('101')).toBe('Ada');
    expect(names.getPersonName('p-grace')).toBe('grace@example.com');
    expect(names.getUserName('999')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Filters and sorts read the same values
// ---------------------------------------------------------------------------

function filterOn(fieldId: string, condition: number, content: string): YDatabaseFilters {
  const doc = new Y.Doc();
  const filter = doc.getMap('filter') as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, 'filter-1');
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content);
  return { toArray: () => [filter], length: 1 } as unknown as YDatabaseFilters;
}

function sortOn(fieldId: string, condition: SortCondition): YDatabaseSorts {
  const doc = new Y.Doc();
  const sort = doc.getMap('sort') as YDatabaseSort;

  sort.set(YjsDatabaseKey.id, 'sort-1');
  sort.set(YjsDatabaseKey.field_id, fieldId);
  sort.set(YjsDatabaseKey.condition, condition);
  return { toArray: () => [sort] } as YDatabaseSorts;
}

describe('formula filters and sorts over related data', () => {
  const { fields } = buildDatabase({ project: 'prop("Projects").first()', budget: 'prop("Budget")' });
  const rows: Row[] = [
    { id: 'r1', height: 36 },
    { id: 'r2', height: 36 },
  ];
  const docs: Record<RowId, YDoc> = {
    r1: createRow('r1', { 'f-relation': { type: FieldType.Relation, data: { yArray: ['proj-1'] } } }).doc,
    r2: createRow('r2', { 'f-relation': { type: FieldType.Relation, data: { yArray: ['proj-2'] } } }).doc,
  };
  const context = (rowId: string): ReadFieldValueContext => ({
    getRelatedRowTitle: (_field, id) => TITLES[id],
    getRollupValue: () => ({ value: '', rawNumeric: rowId === 'r1' ? 10 : 5 }),
  });

  it('filters by related titles', () => {
    // TextFilterCondition.TextContains = 2
    const filtered = filterBy(rows, filterOn('formula-project', 2, 'mobile'), fields, docs, {
      getFormulaContext: context,
    });

    expect(filtered.map((row) => row.id)).toEqual(['r2']);
  });

  it('sorts by rollup results', () => {
    const sorted = sortBy(rows, sortOn('formula-budget', SortCondition.Ascending), fields, docs, {
      getFormulaContext: context,
    });

    expect(sorted.map((row) => row.id)).toEqual(['r2', 'r1']);
  });

  it('treats unresolved related data as empty', () => {
    // TextFilterCondition.TextIsEmpty = 6
    const filtered = filterBy(rows, filterOn('formula-project', 6, ''), fields, docs);

    expect(filtered.map((row) => row.id)).toEqual(['r1', 'r2']);
  });
});
