/**
 * Formulas people really write in Notion, run against a "Projects" database
 * whose cells are stored like AppFlowy stores them. Each case names its
 * source; changes from the original are noted next to the formula.
 *
 * Sources:
 *   NS   https://www.notion.com/help/formula-syntax
 *   NF   https://www.notion.com/help/formulas
 *   NG   https://www.notion.com/help/guides/write-formulas-that-extend-capabilities-of-databases
 *   N2   https://www.notion.com/help/guides/new-formulas-whats-changed
 *   TF   https://thomasjfrank.com/formulas/ (functions/add, dateBetween, dateAdd, dateEnd, test, replaceAll, ifs;
 *        data-types/person; 5-ways-to-build-a-habit-tracker-in-notion)
 *   VIP  https://www.notion.vip/insights/notion-s-essential-date-functions,
 *        https://www.notion.vip/insights/notion-formulas-prioritize-tasks-automatically
 *   Z    https://zapier.com/blog/notion-formulas/
 *   NT   https://notionthings.com/2023/09/07/build-better-formulas-with-notion-formulas-2-0/,
 *        https://notionthings.com/2022/01/13/word-count-page-count-functions/
 *   RG   https://redgregory.substack.com/p/4-essential-notion-date-formulas
 *   PT   https://blog.prototion.com/mastering-date-and-time-functions-in-notion-formulas/
 *   NA   https://noteapiconnector.com/notion-countdown-formula, …/notion-emoji-status-formula, …/notion-quarter-formula
 */
import dayjs, { Dayjs } from 'dayjs';

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { RollupCellValue } from '@/application/database-yjs/rollup/cache';

import { ReadFieldValueContext } from '../cell-values';
import { clearFormulaCompileCache } from '../compile';
import { evaluateFormulaCell } from '../evaluate';
import { readFormulaSchema } from '../schema';

import { CellSpec, checklistData, createFields, createRow, FieldSpec, mediaItem, selectOptions } from './fixture';

// ---------------------------------------------------------------------------
// The "Projects" database
// ---------------------------------------------------------------------------

const NOW = dayjs('2024-03-05T10:30:00');
const TODAY = NOW.startOf('day');

type DateValue = { start: Dayjs; end?: Dayjs; time?: boolean };
type Value = string | number | boolean | string[] | DateValue | null;

const PEOPLE: Record<string, string> = {
  'p-ada': 'Ada Lovelace',
  'p-grace': 'Grace Hopper',
  'p-alan': 'Alan Turing',
};
const USERS: Record<string, string> = { '1': 'Ada Lovelace', '2': 'Grace Hopper' };
const TASKS: Record<string, string> = {
  't-wireframes': 'Wireframes',
  't-copy': 'Copy',
  't-qa': 'QA',
};
const idOf = (names: Record<string, string>, name: string) =>
  Object.keys(names).find((id) => names[id] === name) ?? `unknown-${name}`;

const selectField = (names: string[]) => ({ content: selectOptions(names.map((name) => [`opt-${name}`, name])) });

const numberRollup = (calculation: CalculationType) => ({
  relation_field_id: 'Tasks',
  target_field_id: 'x',
  calculation_type: calculation,
  show_as: RollupDisplayMode.Calculated,
});

/** Input properties by name; field ids are the names. */
const INPUTS: Array<[name: string, type: FieldType, typeOption?: Record<string, unknown>]> = [
  ['Name', FieldType.RichText],
  ['First Name', FieldType.RichText],
  ['Last Name', FieldType.RichText],
  ['Notes', FieldType.RichText],
  ['Task ID', FieldType.RichText],
  ['Email', FieldType.RichText],
  ['Phone', FieldType.RichText],
  ['UTM Source', FieldType.RichText],
  ['UTM Medium', FieldType.RichText],
  ['UTM Campaign', FieldType.RichText],
  ['Net', FieldType.Number],
  ['Tax Rate', FieldType.Number],
  ['Pages Read', FieldType.Number],
  ['Total Pages', FieldType.Number],
  ['Reach', FieldType.Number],
  ['Impact Pts', FieldType.Number],
  ['Confidence', FieldType.Number],
  ['Effort Pts', FieldType.Number],
  ['Hourly Rate', FieldType.Number],
  ['Interval', FieldType.Number],
  ['Priority', FieldType.SingleSelect, selectField(['High', 'Medium', 'Low'])],
  ['Impact', FieldType.SingleSelect, selectField(['High', 'Medium', 'Low'])],
  ['Effort', FieldType.SingleSelect, selectField(['High', 'Medium', 'Low'])],
  ['Frequency', FieldType.SingleSelect, selectField(['Monthly', 'Annually', 'Weekly'])],
  ['Unit', FieldType.SingleSelect, selectField(['week', 'month'])],
  ['Status', FieldType.SingleSelect, selectField(['Not started', 'In Progress', 'Done'])],
  ['Tags', FieldType.MultiSelect, selectField(['Finance', 'Design', 'Urgent'])],
  ['Due', FieldType.DateTime],
  ['Sprint', FieldType.DateTime],
  ['Meeting', FieldType.DateTime],
  ['Birthday', FieldType.DateTime],
  ['Last Renewed', FieldType.DateTime],
  ['Done', FieldType.Checkbox],
  ['Important', FieldType.Checkbox],
  ['Urgent', FieldType.Checkbox],
  ['Exercise', FieldType.Checkbox],
  ['Reading', FieldType.Checkbox],
  ['Writing', FieldType.Checkbox],
  ['Meditation', FieldType.Checkbox],
  ['Website', FieldType.URL],
  ['Checklist', FieldType.Checklist],
  ['Last Edited', FieldType.LastEditedTime],
  ['Created', FieldType.CreatedTime],
  ['Tasks', FieldType.Relation, { database_id: 'db-tasks' }],
  ['AI Summary', FieldType.Summary],
  ['AI Translate', FieldType.Translate],
  ['Time Spent', FieldType.Time],
  ['Attachments', FieldType.Media],
  ['Assignees', FieldType.Person],
  ['Upvoted By', FieldType.Person],
  ['Subtasks Done', FieldType.Rollup, numberRollup(CalculationType.CountChecked)],
  ['Average Cost', FieldType.Rollup, numberRollup(CalculationType.Average)],
  [
    'Task Statuses',
    FieldType.Rollup,
    { relation_field_id: 'Tasks', target_field_id: 'x', calculation_type: 5, show_as: RollupDisplayMode.OriginalList },
  ],
  ['Created By', FieldType.CreatedBy],
  ['Last Edited By', FieldType.LastEditedBy],
];

/** Formula properties other formulas build on (VIP "prioritize tasks", NT word count). */
const FORMULAS: Record<string, string> = {
  'Impact Priority':
    'if(empty(prop("Impact")), toNumber(""), if(prop("Impact") == "Low", 3, if(prop("Impact") == "Medium", 2, 1)))',
  'Effort Priority':
    'if(empty(prop("Effort")), toNumber(""), if(prop("Effort") == "Low", 1, if(prop("Effort") == "Medium", 2, 3)))',
  'Total Priority': 'add(prop("Effort Priority"), prop("Impact Priority"))',
  'Word Count': 'if(length(prop("Notes")) > 0, length(replaceAll(prop("Notes"), "[^ ]", "")) + 1, 0)',
  Age: 'dateBetween(today(), prop("Birthday"), "years")',
};

const PROJECT: Record<string, Value> = {
  Name: 'Website Redesign',
  'First Name': 'Ada',
  'Last Name': 'Lovelace',
  Notes: 'Ship the new landing page',
  'Task ID': 'WEB-042',
  Email: 'ada@example.com',
  Phone: '+1 (555) 010-2030',
  'UTM Source': 'newsletter',
  'UTM Medium': 'email',
  'UTM Campaign': 'launch',
  Net: 1200,
  'Tax Rate': 0.08,
  'Pages Read': 45,
  'Total Pages': 60,
  Reach: 500,
  'Impact Pts': 2,
  Confidence: 0.8,
  'Effort Pts': 4,
  'Hourly Rate': 80,
  Interval: 2,
  Priority: 'High',
  Impact: 'High',
  Effort: 'Low',
  Frequency: 'Monthly',
  Unit: 'week',
  Status: 'In Progress',
  Tags: ['Finance', 'Design', 'Urgent'],
  Due: { start: dayjs('2024-03-10') },
  Sprint: { start: dayjs('2024-03-04'), end: dayjs('2024-03-15') },
  Meeting: { start: dayjs('2024-03-04T09:00'), end: dayjs('2024-03-04T14:30'), time: true },
  Birthday: { start: TODAY.subtract(34, 'year') },
  'Last Renewed': { start: dayjs('2024-01-31') },
  Done: false,
  Important: true,
  Urgent: false,
  Exercise: true,
  Reading: true,
  Writing: false,
  Meditation: true,
  Website: 'https://appflowy.io/pricing',
  Checklist: '3/4',
  Created: { start: dayjs('2024-02-20T08:15') },
  'Last Edited': { start: NOW },
  Tasks: ['Wireframes', 'Copy', 'QA'],
  'AI Summary': 'Redesign the marketing site. Launch in March.',
  'AI Translate': 'Refonte du site web',
  'Time Spent': 9_000_000,
  Attachments: ['brief.pdf', 'hero.png', 'theme.MP3'],
  Assignees: ['Ada Lovelace', 'Grace Hopper'],
  'Upvoted By': ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'],
  'Subtasks Done': 2,
  'Average Cost': 150,
  'Task Statuses': ['Done', 'Done', 'In Progress'],
  'Created By': 'Ada Lovelace',
  'Last Edited By': 'Grace Hopper',
};

const TYPES = new Map(INPUTS.map(([name, type]) => [name, type]));
const unix = (value: Dayjs) => String(value.unix());

function cellOf(name: string, value: Value): CellSpec | undefined {
  const type = TYPES.get(name);

  if (type === undefined) throw new Error(`Unknown fixture property ${name}`);
  if (value === null) return undefined;
  switch (type) {
    case FieldType.DateTime: {
      const { start, end, time } = value as DateValue;

      return {
        type,
        data: unix(start),
        extra: { is_range: Boolean(end), end_timestamp: end ? unix(end) : undefined, include_time: Boolean(time) },
      };
    }

    case FieldType.SingleSelect:
      return { type, data: `opt-${value as string}` };
    case FieldType.MultiSelect:
      return { type, data: (value as string[]).map((name) => `opt-${name}`).join(',') };
    case FieldType.Checkbox:
      return { type, data: value ? 'Yes' : 'No' };
    case FieldType.Checklist: {
      const [done, total] = String(value).split('/').map(Number);

      return { type, data: checklistData(done, total) };
    }

    case FieldType.Relation:
      return { type, data: { yArray: (value as string[]).map((title) => idOf(TASKS, title)) } };
    case FieldType.Media:
      return { type, data: { yArray: (value as string[]).map((file, index) => mediaItem(`m${index}`, file)) } };
    case FieldType.Person:
      return { type, data: JSON.stringify((value as string[]).map((person) => idOf(PEOPLE, person))) };
    default:
      return { type, data: String(value) };
  }
}

const ROW_VALUES = new Set([
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
]);

/** Evaluates `expression` for the project row with `changes` applied. */
function formula(expression: string, changes: Record<string, Value> = {}): string {
  const values = { ...PROJECT, ...changes };
  const fields = createFields([
    ...INPUTS.map(([name, type, typeOption]): FieldSpec => ({ id: name, name, type, typeOption })),
    ...Object.entries({ ...FORMULAS, Probe: expression }).map(
      ([name, source]): FieldSpec => ({ id: name, name, type: FieldType.Formula, typeOption: { expression: source } })
    ),
  ]);
  const cells: Record<string, CellSpec> = {};

  INPUTS.forEach(([name, type]) => {
    if (ROW_VALUES.has(type) || type === FieldType.Rollup) return;
    const cell = cellOf(name, values[name]);

    if (cell) cells[name] = cell;
  });

  const at = (name: string) => (values[name] ? unix((values[name] as DateValue).start) : undefined);
  const uid = (name: string) => (values[name] ? idOf(USERS, values[name] as string) : undefined);
  const { row } = createRow('project', cells, {
    createdAt: at('Created'),
    lastModified: at('Last Edited'),
    createdBy: uid('Created By'),
    lastEditedBy: uid('Last Edited By'),
  });
  const context: ReadFieldValueContext = {
    getUserName: (id) => USERS[id],
    getPersonName: (id) => PEOPLE[id],
    getRelatedRowTitle: (_field, id) => TASKS[id],
    getRollupValue: (fieldId): RollupCellValue | undefined => {
      const value = values[fieldId];

      if (value === null || value === undefined) return undefined;
      return Array.isArray(value)
        ? { value: value.join(', '), list: value }
        : { value: String(value), rawNumeric: Number(value) };
    },
  };
  const result = evaluateFormulaCell({
    ...context,
    schema: readFormulaSchema(fields),
    field: fields.get('Probe'),
    fieldId: 'Probe',
    row,
    rowId: 'project',
    now: () => NOW.valueOf(),
  });

  if (result.error) throw new Error(result.error);
  return result.text;
}

type Case = [title: string, expression: string, changes: Record<string, Value>, expected: string];

function cases(list: Case[]) {
  it.each(list)('%s', (_title, expression, changes, expected) => {
    expect(formula(expression, changes)).toBe(expected);
  });
}

beforeEach(() => {
  clearFormulaCompileCache();
});

// ---------------------------------------------------------------------------
// Use cases by property type
// ---------------------------------------------------------------------------

describe('Text', () => {
  const words = FORMULAS['Word Count'];

  cases([
    ['full name (NG)', 'prop("First Name") + " " + prop("Last Name")', {}, 'Ada Lovelace'],
    ['word count (NT)', words, {}, '5'],
    ['word count of empty notes (NT)', words, { Notes: null }, '0'],
    ['ID prefix (NS)', 'prop("Task ID").split("-").first()', {}, 'WEB'],
    ['ID number as text (NS)', 'prop("Task ID").split("-").last()', {}, '042'],
    ['ID number (NS)', 'toNumber(prop("Task ID").split("-").last())', {}, '42'],
    [
      'invoice number (Z)',
      '"INV-" + substring(prop("First Name"), 0, 1) + substring(prop("Last Name"), 0, 1) + "-" + formatDate(prop("Due"), "MMM") + formatDate(prop("Due"), "YYYY")',
      {},
      'INV-AL-Mar2024',
    ],
    [
      'sentence with a count (TF replaceAll)',
      'prop("Name") + " has " + prop("Tags").length() + " tags."',
      {},
      'Website Redesign has 3 tags.',
    ],
  ]);
});

describe('Number', () => {
  const total = 'let(tax, prop("Net") * prop("Tax Rate"), prop("Net") + tax)';
  const stars =
    'lets(p, prop("Pages Read") / prop("Total Pages"), substring("★★★★★★★★★★", 0, p * 10) + substring("☆☆☆☆☆☆☆☆☆☆", 0, (1 - p) * 10) + " " + round(p * 100) + "%")';

  cases([
    ['total with tax (N2)', total, {}, '1296'],
    ['total with tax as currency (NG)', `formatNumber(${total}, "usd", 2)`, {}, '$1,296.00'],
    ['RICE score (NF)', 'prop("Reach") * prop("Impact Pts") * prop("Confidence") / prop("Effort Pts")', {}, '200'],
    // Same 9-symbol quirk as the original: substring() truncates 7.5 and 2.5.
    ['star progress bar (Z)', stars, {}, '★★★★★★★☆☆ 75%'],
    ['star progress bar at half (Z)', stars, { 'Pages Read': 30 }, '★★★★★☆☆☆☆☆ 50%'],
    ['revenue label (NS, without style())', '"Revenue: " + formatNumber(prop("Net"), "usd", 0)', {}, 'Revenue: $1,200'],
    [
      'revenue label, millions (NS)',
      '"Revenue: " + formatNumber(prop("Net"), "usd", 0)',
      { Net: 1234567 },
      'Revenue: $1,234,567',
    ],
  ]);
});

describe('Select and Status', () => {
  const renewal =
    'ifs(prop("Frequency") == "Monthly", dateAdd(prop("Last Renewed"), 1, "months"), prop("Frequency") == "Annually", dateAdd(prop("Last Renewed"), 1, "years"))';
  const overdue = 'if(and(today() > prop("Due"), prop("Status") != "Done"), "Overdue", "")';
  const yesterday = { start: TODAY.subtract(1, 'day') };

  cases([
    ['is high priority (NS)', 'prop("Priority") == "High"', {}, 'Yes'],
    ['is not high priority (NS)', 'prop("Priority") == "High"', { Priority: 'Low' }, 'No'],
    ['impact rank (VIP)', FORMULAS['Impact Priority'], {}, '1'],
    ['impact rank of Low (VIP)', FORMULAS['Impact Priority'], { Impact: 'Low' }, '3'],
    ['impact rank without impact (VIP)', FORMULAS['Impact Priority'], { Impact: null }, ''],
    // Z nests if(); ifs() without a default is blank when nothing matches (TF ifs).
    ['monthly renewal at month end (Z)', renewal, {}, '02/29/2024'],
    ['annual renewal (Z)', renewal, { Frequency: 'Annually' }, '01/31/2025'],
    ['no renewal rule (Z)', renewal, { Frequency: 'Weekly' }, ''],
    ['overdue (NF)', overdue, { Due: yesterday }, 'Overdue'],
    ['done is never overdue (NF)', overdue, { Due: yesterday, Status: 'Done' }, ''],
    ['due today is not overdue with today() (NF)', overdue, { Due: { start: TODAY } }, ''],
    ['due today is overdue with now() (NF)', overdue.replace('today()', 'now()'), { Due: { start: TODAY } }, 'Overdue'],
  ]);
});

describe('Multi-select', () => {
  cases([
    ['tag count (NS)', 'prop("Tags").length()', {}, '3'],
    ['has tag (NS)', 'prop("Tags").includes("Finance")', {}, 'Yes'],
    ['lacks tag (NS)', 'prop("Tags").includes("Finance")', { Tags: ['Design'] }, 'No'],
    ['flag urgent (TF ifs)', 'ifs(prop("Tags").includes("Urgent"), "🔥")', {}, '🔥'],
    ['sorted tags (N2)', 'prop("Tags").sort().join(", ")', {}, 'Design, Finance, Urgent'],
  ]);
});

describe('Date', () => {
  const inDays = (days: number) => ({ start: TODAY.add(days, 'day') });
  const countdown =
    'if(dateBetween(prop("Due"), today(), "days") < 0, "Overdue", dateBetween(prop("Due"), today(), "days") + " days left")';
  const urgency =
    'ifs(dateBetween(prop("Due"), today(), "days") <= 3, "🔴 Urgent", dateBetween(prop("Due"), today(), "days") <= 7, "🟡 Soon", "🟢 On track")';
  const sprintState =
    'if(dateBetween(dateStart(prop("Sprint")), today(), "days") > 0, "Future Events", if(dateBetween(dateEnd(prop("Sprint")), today(), "days") >= 0, "Currently Active", "Past Events"))';
  const sprint = (from: number, to: number) => ({ start: TODAY.add(from, 'day'), end: TODAY.add(to, 'day') });
  const quarter = '"Q" + format(ceil(month(prop("Due")) / 3)) + " " + formatDate(prop("Due"), "YYYY")';
  const next = 'dateAdd(prop("Due"), prop("Interval"), prop("Unit") + "s")';

  cases([
    ['days until due (NG)', 'dateBetween(prop("Due"), today(), "days")', { Due: inDays(3) }, '3'],
    ['days past due (VIP)', 'dateBetween(prop("Due"), today(), "days")', { Due: inDays(-2) }, '-2'],
    // now() is mid-morning, so a due date 3 days out is 2 whole days away (as in Notion).
    ['days until due with now() (NG)', 'dateBetween(prop("Due"), now(), "days")', { Due: inDays(3) }, '2'],
    ['countdown (NA)', countdown, { Due: inDays(5) }, '5 days left'],
    ['countdown past due (NA)', countdown, { Due: inDays(-1) }, 'Overdue'],
    ['urgency: urgent (NA)', urgency, { Due: inDays(2) }, '🔴 Urgent'],
    ['urgency: soon (NA)', urgency, { Due: inDays(6) }, '🟡 Soon'],
    ['urgency: on track (NA)', urgency, { Due: inDays(10) }, '🟢 On track'],
    ['age (VIP)', 'dateBetween(today(), prop("Birthday"), "years")', {}, '34'],
    [
      'age the day before a birthday (VIP)',
      'dateBetween(today(), prop("Birthday"), "years")',
      { Birthday: { start: TODAY.subtract(34, 'year').add(1, 'day') } },
      '33',
    ],
    ['sprint length (VIP)', 'dateBetween(dateEnd(prop("Sprint")), dateStart(prop("Sprint")), "days")', {}, '11'],
    [
      'meeting length (RG)',
      'format(dateBetween(dateEnd(prop("Meeting")), dateStart(prop("Meeting")), "hours")) + "h:" + format(dateBetween(dateEnd(prop("Meeting")), dateStart(prop("Meeting")), "minutes") % 60) + "m"',
      {},
      '5h:30m',
    ],
    ['future range (TF dateEnd)', sprintState, { Sprint: sprint(1, 5) }, 'Future Events'],
    ['active range (TF dateEnd)', sprintState, { Sprint: sprint(-2, 2) }, 'Currently Active'],
    ['past range (TF dateEnd)', sprintState, { Sprint: sprint(-5, -1) }, 'Past Events'],
    ['quarter (NA)', quarter, {}, 'Q1 2024'],
    ['quarter in August (NA)', quarter, { Due: { start: dayjs('2024-08-01') } }, 'Q3 2024'],
    ['recurring next due (TF dateAdd)', next, {}, '03/24/2024'],
    ['recurring next due by month (TF dateAdd)', next, { Unit: 'month' }, '05/10/2024'],
    ['week of year (TF formatDate)', 'formatDate(prop("Due"), "wo")', {}, '11th'],
    ['day of week (NS)', 'day(prop("Due"))', {}, '7'],
    [
      'day name greeting (N2)',
      'ifs(formatDate(prop("Due"), "dddd") == "Sunday", "Rest day 😴", "Keep going!")',
      {},
      'Rest day 😴',
    ],
    ['month heading (PT)', 'formatDate(prop("Due"), "[Month of] MMMM, YYYY")', {}, 'Month of March, 2024'],
    ['two-week range (N2)', 'dateRange(prop("Due"), dateAdd(prop("Due"), 2, "weeks"))', {}, '03/10/2024 → 03/24/2024'],
    ['date in a sentence (TF add)', '"Due " + prop("Due")', {}, 'Due Mar 10, 2024'],
  ]);
});

describe('Checkbox', () => {
  const matrix =
    'if(prop("Important"), if(prop("Urgent"), "Do", "Schedule"), if(prop("Urgent"), "Delegate", "Eliminate"))';
  const readiness =
    'if(prop("Done"), "✅ Done", if(empty(prop("Assignees")) or empty(prop("Due")), "❌ Incomplete", "🟡 Ready"))';

  cases([
    ['Eisenhower: schedule (VIP)', matrix, {}, 'Schedule'],
    ['Eisenhower: do (VIP)', matrix, { Urgent: true }, 'Do'],
    ['Eisenhower: delegate (VIP)', matrix, { Important: false, Urgent: true }, 'Delegate'],
    ['Eisenhower: eliminate (VIP)', matrix, { Important: false }, 'Eliminate'],
    ['emoji status (NA)', 'if(prop("Done"), "✅", "❌")', {}, '❌'],
    ['emoji status when done (NA)', 'if(prop("Done"), "✅", "❌")', { Done: true }, '✅'],
    ['unset checkbox is unchecked (NA)', 'if(prop("Done"), "✅", "❌")', { Done: null }, '❌'],
    [
      'habit score (TF habit tracker)',
      'round((prop("Exercise").toNumber() + prop("Reading").toNumber() + prop("Writing").toNumber() + prop("Meditation").toNumber()) / 4 * 100) / 100',
      {},
      '0.75',
    ],
    ['readiness (NA)', readiness, {}, '🟡 Ready'],
    ['readiness without assignees (NA)', readiness, { Assignees: [] }, '❌ Incomplete'],
    ['readiness without a due date (NA)', readiness, { Due: null }, '❌ Incomplete'],
    ['readiness when done (NA)', readiness, { Done: true }, '✅ Done'],
    ['boolean joined as text (TF add)', '1 + prop("Important")', {}, '1true'],
  ]);
});

describe('URL, email and phone', () => {
  const utm =
    'ifs(empty(prop("Website")), "", empty(prop("UTM Source")) or empty(prop("UTM Medium")) or empty(prop("UTM Campaign")), "You must enter medium, source and campaign name.", prop("Website") + "?utm_source=" + prop("UTM Source") + "&utm_medium=" + prop("UTM Medium") + "&utm_campaign=" + prop("UTM Campaign"))';
  const domain = 'replaceAll(replaceAll(replaceAll(prop("Website"), ".*www.", ""), ".*https://", ""), "[/].*", "")';

  cases([
    ['UTM link (NG)', utm, {}, 'https://appflowy.io/pricing?utm_source=newsletter&utm_medium=email&utm_campaign=launch'],
    [
      'UTM link without a campaign (NG)',
      utm,
      { 'UTM Campaign': null },
      'You must enter medium, source and campaign name.',
    ],
    ['UTM link without a URL (NG)', utm, { Website: null }, ''],
    ['domain (community)', domain, {}, 'appflowy.io'],
    ['domain behind www (community)', domain, { Website: 'https://www.appflowy.io/blog/x?ref=nav' }, 'appflowy.io'],
    ['has email (NS)', '!empty(prop("Email"))', {}, 'Yes'],
    ['no email (NS)', '!empty(prop("Email"))', { Email: null }, 'No'],
    // Unknown escapes keep their backslash, as in Notion.
    ['website from email (Z)', '"https://www." + match(prop("Email"), "(?<=@)(.*\\w)")', {}, 'https://www.example.com'],
    ['tel: link (NS, without link())', '"tel:" + replaceAll(prop("Phone"), "[^0-9+]", "")', {}, 'tel:+15550102030'],
  ]);
});

describe('Files & media', () => {
  const kinds =
    'prop("Attachments").map(if(test(current, "([jJ][pP][eE]?[gG]|[gG][iI][fF]|[pP][nN][gG])"), "🌅 Image", if(test(current, "([mM][pP]3|[wW][aA][vV]|[aA][iI][fF]{2})"), "🎧 Audio", "📝 Text"))).join(", ")';

  cases([
    ['file count (TF)', 'prop("Attachments").length()', {}, '3'],
    ['no files (TF)', 'prop("Attachments").length()', { Attachments: [] }, '0'],
    ['file kinds (TF test)', kinds, {}, '📝 Text, 🌅 Image, 🎧 Audio'],
    ['missing file (NA)', 'if(empty(prop("Attachments")), "❌", "✅")', { Attachments: [] }, '❌'],
    ['has file (NA)', 'if(empty(prop("Attachments")), "❌", "✅")', {}, '✅'],
  ]);
});

describe('Person, Created by and Last edited by', () => {
  cases([
    ['upvote count (NF)', 'prop("Upvoted By").length()', {}, '3'],
    ['upvote count, function style (NG)', 'length(prop("Upvoted By"))', {}, '3'],
    ['names as text (N2)', 'prop("Assignees").map(current.format()).join(", ")', {}, 'Ada Lovelace, Grace Hopper'],
    ['is assigned (TF person)', 'prop("Assignees").includes("Grace Hopper")', {}, 'Yes'],
    ['is not assigned (TF person)', 'prop("Assignees").includes("Alan Turing")', {}, 'No'],
    [
      'unassigned (NA)',
      'if(empty(prop("Assignees")), "Unassigned", prop("Assignees").join(", "))',
      { Assignees: [] },
      'Unassigned',
    ],
    ['author (N2, first() for name())', 'prop("Created By").first()', {}, 'Ada Lovelace'],
    ['edited by someone else (TF person)', 'prop("Last Edited By") != prop("Created By")', {}, 'Yes'],
    [
      'edited by the author (TF person)',
      'prop("Last Edited By") != prop("Created By")',
      { 'Last Edited By': 'Ada Lovelace' },
      'No',
    ],
    ['last touched by (N2)', '"Last touched by " + prop("Last Edited By").first()', {}, 'Last touched by Grace Hopper'],
  ]);
});

describe('Relation and Rollup', () => {
  const progress =
    'if(!prop("Tasks").empty(), floor(100 * prop("Subtasks Done") / prop("Tasks").length()) / 100, prop("Done").toNumber())';
  const completion =
    'let(pct, round(prop("Task Statuses").filter(current == "Done").length() / prop("Task Statuses").length() * 100), ifs(pct == 100, "✅ All tasks complete", pct > 0, "⚠️ In progress (" + pct + ")%", "❌ Not started"))';

  cases([
    ['task count (NF)', 'prop("Tasks").length()', {}, '3'],
    ['task titles (N2)', 'prop("Tasks").join(", ")', {}, 'Wireframes, Copy, QA'],
    ['has QA task (N2)', 'prop("Tasks").includes("QA")', {}, 'Yes'],
    ['sub-item progress (RG)', progress, {}, '0.66'],
    ['progress without sub-items (RG)', progress, { Tasks: [], Done: true }, '1'],
    ['annual cost (NS)', 'prop("Average Cost") * 12', {}, '1800'],
    // Notion joins the number into the text directly: "(" + percentComplete + ")%".
    ['completion in progress (N2)', completion, {}, '⚠️ In progress (67)%'],
    ['completion done (N2)', completion, { 'Task Statuses': ['Done', 'Done'] }, '✅ All tasks complete'],
    ['completion not started (N2)', completion, { 'Task Statuses': ['Not started'] }, '❌ Not started'],
    ['all sub-tasks done (NF)', 'prop("Task Statuses").every(current == "Done")', {}, 'No'],
    [
      'all sub-tasks done when they are (NF)',
      'prop("Task Statuses").every(current == "Done")',
      { 'Task Statuses': ['Done'] },
      'Yes',
    ],
    ['rollup not computed yet', 'prop("Average Cost") * 12', { 'Average Cost': null }, '0'],
  ]);
});

describe('Created time and Last edited time', () => {
  cases([
    ['lead time (PT)', 'dateBetween(prop("Due"), prop("Created"), "days")', {}, '18'],
    ['Moment year token (PT)', 'formatDate(prop("Created"), "ddd, D MMM, Y")', {}, 'Tue, 20 Feb, 2024'],
    ['day of year (PT)', 'formatDate(prop("Created"), "DDDo [day of] YYYY")', {}, '51st day of 2024'],
    ['follow-up date (PT)', 'dateAdd(prop("Created"), 5, "days")', {}, '02/25/2024 8:15 AM'],
    ['ISO week label (PT)', 'formatDate(prop("Created"), "YYYY-[W]W, Wo [week]")', {}, '2024-W8, 8th week'],
    ['days since edit (community)', 'dateBetween(now(), prop("Last Edited"), "days")', {}, '0'],
    [
      'days since an older edit (community)',
      'dateBetween(now(), prop("Last Edited"), "days")',
      { 'Last Edited': { start: NOW.subtract(3, 'day').subtract(1, 'hour') } },
      '3',
    ],
    [
      'stale page (community)',
      'if(dateBetween(now(), prop("Last Edited"), "days") > 30, "Stale", "Fresh")',
      { 'Last Edited': { start: NOW.subtract(31, 'day') } },
      'Stale',
    ],
    ['edited today (RG)', 'formatDate(prop("Last Edited"), "MM DD YYYY") == formatDate(now(), "MM DD YYYY")', {}, 'Yes'],
  ]);
});

describe('Formulas using other formulas', () => {
  const stars =
    'if(prop("Total Priority") == 2, "⭐⭐⭐⭐⭐", if(prop("Total Priority") == 3, "⭐⭐⭐⭐", if(prop("Total Priority") == 4, "⭐⭐⭐", if(prop("Total Priority") == 5, "☕☕", "?"))))';
  const pages = 'if(prop("Word Count") > 0, round(prop("Word Count") / 500 * 100) / 100, 0)';
  const longNotes = (words: number) => Array.from({ length: words }, () => 'word').join(' ');
  // TF dateBetween, verbatim apart from property names and today().
  const readableAge =
    'lets(ageDays, dateBetween(today(), prop("Birthday"), "days"), ageMonths, dateBetween(today(), prop("Birthday"), "months"), ageYears, dateBetween(today(), prop("Birthday"), "years"), prop("First Name") + " is " + ifs(!ageYears and !ageMonths, ageDays + " day" + ifs(ageDays != 1, "s"), !ageYears, ageMonths + " month" + ifs(ageMonths != 1, "s"), ageYears + " year" + ifs(ageYears != 1, "s")) + " old.")';
  const born = (amount: number, unit: dayjs.ManipulateType) => ({ Birthday: { start: TODAY.subtract(amount, unit) } });

  cases([
    ['total priority (VIP)', 'prop("Total Priority")', {}, '2'],
    ['priority stars (VIP)', stars, {}, '⭐⭐⭐⭐⭐'],
    ['priority stars for low impact, high effort (VIP)', stars, { Impact: 'Low', Effort: 'High' }, '?'],
    ['priority stars for medium impact and effort (VIP)', stars, { Impact: 'Medium', Effort: 'Medium' }, '⭐⭐⭐'],
    ['page count (NT)', pages, { Notes: longNotes(1000) }, '2'],
    ['page count, partial (NT)', pages, { Notes: longNotes(1234) }, '2.47'],
    [
      'age sentence (TF)',
      'prop("Name") + " is " + prop("Age") + " years old."',
      {},
      'Website Redesign is 34 years old.',
    ],
    ['readable age in years (TF)', readableAge, {}, 'Ada is 34 years old.'],
    ['readable age of one year (TF)', readableAge, born(1, 'year'), 'Ada is 1 year old.'],
    ['readable age in months (TF)', readableAge, born(3, 'month'), 'Ada is 3 months old.'],
    ['readable age in days (TF)', readableAge, born(20, 'day'), 'Ada is 20 days old.'],
    ['readable age of one day (TF)', readableAge, born(1, 'day'), 'Ada is 1 day old.'],
  ]);
});

describe('AppFlowy-only properties', () => {
  const bar = 'substring("▒▒▒▒▒▒▒▒▒▒", 0, round(prop("Checklist") / 10)) + " " + prop("Checklist") + "%"';
  const status =
    'ifs(prop("Checklist") == 100, "✅ All tasks complete", prop("Checklist") > 0, "⚠️ In progress", "❌ Not started")';
  const hours =
    'format(floor(prop("Time Spent") / 3600000)) + "h:" + format(floor(prop("Time Spent") / 60000) % 60) + "m"';

  cases([
    ['checklist bar (NT)', bar, {}, '▒▒▒▒▒▒▒▒ 75%'],
    ['checklist bar at a third (NT)', bar, { Checklist: '1/3' }, '▒▒▒ 33%'],
    ['checklist status (N2)', status, {}, '⚠️ In progress'],
    ['checklist complete (N2)', status, { Checklist: '2/2' }, '✅ All tasks complete'],
    ['checklist not started (N2)', status, { Checklist: '0/2' }, '❌ Not started'],
    ['no checklist (N2)', status, { Checklist: null }, '❌ Not started'],
    ['time as h:m (RG)', hours, {}, '2h:30m'],
    ['time as h:m, odd minutes (RG)', hours, { 'Time Spent': 5_580_000 }, '1h:33m'],
    ['typed time as h:m (RG)', hours, { 'Time Spent': '1h33m' }, '1h:33m'],
    ['decimal hours (RG)', 'round(100 * (prop("Time Spent") / 60000 / 60)) / 100', {}, '2.5'],
    [
      'billable amount (NG)',
      'formatNumber(prop("Time Spent") / 3600000 * prop("Hourly Rate"), "usd", 2)',
      {},
      '$200.00',
    ],
    ['AI summary word count (NT)', FORMULAS['Word Count'].replace(/Notes/g, 'AI Summary'), {}, '7'],
    ['AI translation length (NS)', 'prop("AI Translate").length()', {}, '19'],
    [
      'AI summary missing (NA)',
      'if(empty(prop("AI Summary")), "❌ Missing", "✅ Complete")',
      { 'AI Summary': null },
      '❌ Missing',
    ],
    ['AI summary mentions launch (NS)', 'contains(lower(prop("AI Summary")), "launch")', {}, 'Yes'],
  ]);
});
