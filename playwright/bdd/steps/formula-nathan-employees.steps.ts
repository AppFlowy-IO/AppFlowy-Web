/**
 * Real-world formulas on the local nathan@appflowy.io "5000_employees" grid.
 * Expected values are computed here from each row's raw data, independently
 * of the formula engine. Everything a scenario adds or edits is removed or
 * restored afterwards.
 */
import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import { expect, type BrowserContext, type Page, test } from '@playwright/test';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { typeTextIntoCell } from '../../support/field-type-helpers';
import {
  addFilterByFieldName,
  changeFilterCondition,
  deleteFilter,
  enterFilterText,
  TextFilterCondition,
} from '../../support/filter-test-helpers';
import {
  chooseShowAs,
  closeMenus,
  formulaInput,
  lastFieldId,
  openPropertyMenu,
  readGridFieldsDirect,
  renameField,
  saveFormula,
  SHOW_AS_IDS,
  startNewFormulaProperty,
} from '../../support/formula-test-helpers';
import { openRowDetail } from '../../support/row-detail-helpers';
import { RowDetailSelectors } from '../../support/selectors';
import { SPM0622_PASSWORD } from '../../support/spm0622-fixture';
import { setupPageErrorHandling } from '../../support/test-config';

dayjs.extend(advancedFormat);
dayjs.extend(weekOfYear);

const { After, Given, When, Then } = createBdd();

const NATHAN_EMAIL = process.env.NATHAN_EMAIL?.trim() || 'nathan@appflowy.io';
const NATHAN_PASSWORD = process.env.NATHAN_PASSWORD || SPM0622_PASSWORD;
const DATABASE_PATH =
  process.env.NATHAN_EMPLOYEES_PATH || '/app/997c87ed-1667-4a62-8c0a-a74ee1aadb4b/19c54663-cc94-4c6d-b564-b852560e2d27';
/** Properties a scenario adds; anything with this prefix is removed afterwards. */
const PREFIX = 'UC ';
/** Every column (the grid has ~35 before a scenario adds its own) is mounted at this width. */
const WIDE_VIEWPORT = { width: 12000, height: 1000 };
const SCREENSHOT_VIEWPORT = { width: 1600, height: 900 };
const FIELD_VISIBILITY_HIDDEN = 2;

// ---------------------------------------------------------------------------
// Scenario state and cleanup
// ---------------------------------------------------------------------------

interface ViewSnapshot {
  filterIds: string[];
  sortIds: string[];
  calculations: Array<{ id: string; type: number }>;
  visibility: Record<string, number | null>;
}

interface EmployeesState {
  snapshot?: ViewSnapshot;
  remembered: Map<string, number>;
  editedCells: Array<{ rowId: string; fieldId: string; data: string }>;
  rowPageId?: string;
  recording?: { context: BrowserContext; page: Page };
}

const states = new WeakMap<Page, EmployeesState>();

function stateOf(page: Page): EmployeesState {
  let state = states.get(page);

  if (!state) {
    state = { remembered: new Map(), editedCells: [] };
    states.set(page, state);
  }

  return state;
}

function mediaDir(): string | undefined {
  const dir = process.env.FORMULA_MEDIA_DIR;

  if (dir) mkdirSync(dir, { recursive: true });
  return dir;
}

async function allowTestHooks(context: BrowserContext) {
  await context.addInitScript(() => {
    (window as Window & { Cypress?: boolean }).Cypress = true;
  });
}

async function openDatabase(page: Page) {
  await page.goto(DATABASE_PATH, { waitUntil: 'domcontentloaded' });
  // The dev server occasionally fails the first route load; one reload recovers it.
  const loaded = await page
    .waitForFunction(
      () =>
        Boolean((window as any).__TEST_DATABASE_CONTEXT__?.databaseDoc) ||
        document.body.textContent?.includes('Couldn’t load this page'),
      null,
      { timeout: 120000 }
    )
    .then(() => page.evaluate(() => Boolean((window as any).__TEST_DATABASE_CONTEXT__?.databaseDoc)));

  if (!loaded) await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).__TEST_DATABASE_CONTEXT__?.databaseDoc), null, {
    timeout: 120000,
  });
  await expect(page.getByTestId('database-grid')).toBeVisible({ timeout: 120000 });
  // Every row order is listed once the view has loaded.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
          const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(ctx.activeViewId);
          const count = document.querySelector('[data-testid="database-grid"]')?.getAttribute('data-row-count');

          return Number(count) > 0 && Number(count) === view.get('row_orders').length;
        }),
      { timeout: 120000, intervals: [1000] }
    )
    .toBe(true);
}

async function readSnapshot(page: Page): Promise<ViewSnapshot> {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(ctx.activeViewId);
    const ids = (key: string) =>
      ((view.get(key)?.toArray() ?? []) as Array<{ get: (key: string) => unknown }>).map((item) =>
        String(item.get('id'))
      );
    const visibility: Record<string, number | null> = {};

    view
      .get('field_orders')
      .toArray()
      .forEach(({ id }: { id: string }) => {
        const value = view.get('field_settings')?.get(id)?.get('visibility');

        visibility[id] = value === undefined || value === null ? null : Number(value);
      });

    return {
      filterIds: ids('filters'),
      sortIds: ids('sorts'),
      calculations: ((view.get('calculations')?.toArray() ?? []) as Array<{ get: (key: string) => unknown }>).map(
        (item) => ({ id: String(item.get('id')), type: Number(item.get('ty')) })
      ),
      visibility,
    };
  });
}

/** Removes "UC …" properties and anything added to the view since `snapshot`. */
async function restoreDatabase(page: Page, snapshot: ViewSnapshot | undefined, prefix: string) {
  await page.evaluate(
    ({ snapshot, prefix }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

      if (!ctx?.databaseDoc) return;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const fields = database.get('fields');
      const added = Array.from(fields.entries() as Iterable<[string, any]>)
        .filter(([, field]) => String(field.get('name') ?? '').startsWith(prefix))
        .map(([id]) => id);
      const removed = new Set(added);

      doc.transact(() => {
        added.forEach((id) => fields.delete(id));
        database.get('views').forEach((view: any) => {
          const orders = view.get('field_orders');

          for (let index = orders.length - 1; index >= 0; index -= 1) {
            if (removed.has(orders.get(index).id)) orders.delete(index, 1);
          }

          removed.forEach((id) => view.get('field_settings')?.delete(id));
        });
        if (!snapshot) return;
        const view = database.get('views').get(ctx.activeViewId);
        const prune = (key: string, keep: string[]) => {
          const list = view.get(key);

          if (!list) return;
          for (let index = list.length - 1; index >= 0; index -= 1) {
            if (!keep.includes(String(list.get(index).get('id')))) list.delete(index, 1);
          }
        };

        prune('filters', snapshot.filterIds);
        prune('sorts', snapshot.sortIds);
        prune(
          'calculations',
          snapshot.calculations.map((item) => item.id)
        );
        view.get('calculations')?.forEach((item: any) => {
          const before = snapshot.calculations.find((entry) => entry.id === String(item.get('id')));

          if (before && Number(item.get('ty')) !== before.type) item.set('ty', before.type);
        });
      });
    },
    { snapshot, prefix }
  );
  if (snapshot) await restoreVisibility(page, snapshot.visibility);
}

/** Puts every column's visibility back as it was in `visibility`. */
async function restoreVisibility(page: Page, visibility: ViewSnapshot['visibility']) {
  await page.evaluate((visibility) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(ctx.activeViewId);

    ctx.databaseDoc.transact(() => {
      Object.entries(visibility).forEach(([id, value]) => {
        const setting = view.get('field_settings')?.get(id);

        if (!setting) return;
        if (value === null) setting.delete('visibility');
        else if (Number(setting.get('visibility')) !== value) setting.set('visibility', value);
      });
    });
  }, visibility);
}

async function restoreEditedCells(page: Page, cells: EmployeesState['editedCells']) {
  if (cells.length === 0) return;
  await page.evaluate(async (cells) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

    for (const { rowId, fieldId, data } of [...cells].reverse()) {
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));
      const cell = rowDoc?.getMap('data').get('data')?.get('cells')?.get(fieldId);

      if (cell) rowDoc.transact(() => cell.set('data', data));
    }
  }, cells);
}

After({ tags: '@nathan-employees' }, async ({ page }) => {
  const state = states.get(page);

  await state?.recording?.context.close().catch(() => undefined);
  await restoreEditedCells(page, state?.editedCells ?? []).catch(() => undefined);
  await restoreDatabase(page, state?.snapshot, PREFIX).catch(() => undefined);
  // Let the cleanup reach the server before the page closes.
  await page.waitForTimeout(3000);
  states.delete(page);
});

Given("Nathan's 5000_employees database is open", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 30 * 60 * 1000));
  setupPageErrorHandling(page);
  await signInWithPasswordViaUi(page, NATHAN_EMAIL, NATHAN_PASSWORD);
  await page.setViewportSize(WIDE_VIEWPORT);
  await openDatabase(page);
  // Leftovers of an interrupted run.
  await restoreDatabase(page, undefined, PREFIX);
  stateOf(page).snapshot = await readSnapshot(page);
});

// ---------------------------------------------------------------------------
// Reading rows and computing expected values
// ---------------------------------------------------------------------------

/** Raw values of the employee properties, by property name. */
type RawEmployee = Record<string, string>;

interface EmployeeRow {
  rowId: string;
  /** 0-based position in the grid. */
  index: number;
  texts: Record<string, string>;
  raw: RawEmployee;
}

const INPUT_NAMES = [
  'Name',
  'Department',
  'Salary',
  'Email',
  'Active',
  'Skills',
  'Onboarding',
  'Join Date',
  'Job Title',
  'Manager',
  'Office',
  'Performance',
  'Bonus',
  'Years of Experience',
  'Phone',
  'LinkedIn',
  'Languages',
  'Remote',
];

/** Rendered rows with the text of `fieldIds` and the raw data of every employee property. */
async function renderedEmployees(page: Page, fieldIds: string[]): Promise<EmployeeRow[]> {
  const rows = await page.evaluate(
    ({ fieldIds, inputNames }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const database = ctx.databaseDoc.getMap('data').get('database');
      const fields = database.get('fields');
      const byName = new Map<string, { id: string; type: number; options: Map<string, string> }>();

      fields.forEach((field: any, id: string) => {
        const type = Number(field.get('ty'));
        const content = field.get('type_option')?.get(String(type))?.get('content');
        const options = new Map<string, string>();

        if (typeof content === 'string' && content) {
          try {
            (JSON.parse(content).options ?? []).forEach((option: { id: string; name: string }) =>
              options.set(option.id, option.name)
            );
          } catch {
            // Not a select field.
          }
        }

        byName.set(String(field.get('name')), { id, type, options });
      });

      const readCell = (cell: HTMLElement) => {
        const checkbox = cell.querySelector('[data-checked]');

        if (checkbox) return checkbox.getAttribute('data-checked') === 'true' ? 'Yes' : 'No';
        if (cell.querySelector('[data-testid="formula-checked-icon"]')) return 'Yes';
        if (cell.querySelector('[data-testid="formula-unchecked-icon"]')) return 'No';
        return (cell.textContent ?? '').trim();
      };

      return Array.from(document.querySelectorAll<HTMLElement>('[data-row-id][data-index]')).flatMap((wrapper) => {
        const row = wrapper.querySelector<HTMLElement>('[data-testid^="grid-row-"]');
        const rowId = wrapper.getAttribute('data-row-id') ?? '';
        const rowDoc = ctx.rowMap?.[rowId] ?? ctx.peekRowDocFromSeed?.(rowId);
        const data = rowDoc?.getMap('data').get('data');

        if (!row || !rowId || !data) return [];
        const texts: Record<string, string> = {};

        fieldIds.forEach((fieldId) => {
          const cell = row.querySelector<HTMLElement>(`.grid-row-cell[data-column-id="${fieldId}"]`);

          if (cell) texts[fieldId] = readCell(cell);
        });

        const raw: Record<string, string> = {
          __created: String(data.get('created_at') ?? ''),
          __edited: String(data.get('last_modified') ?? ''),
        };

        inputNames.forEach((name) => {
          const field = byName.get(name);
          const value = field ? data.get('cells')?.get(field.id)?.get('data') : undefined;
          const text = value === undefined || value === null ? '' : String(value);

          // Select cells store option ids; keep their names.
          raw[name] =
            field && field.options.size > 0
              ? text
                  .split(',')
                  .filter(Boolean)
                  .map((id) => field.options.get(id) ?? id)
                  .join(',')
              : text;
        });

        // The virtual list starts with the header row, so data rows begin at 1.
        return [{ rowId, index: Number(wrapper.getAttribute('data-index')) - 1, texts, raw }];
      });
    },
    { fieldIds, inputNames: INPUT_NAMES }
  );

  return rows.sort((a, b) => a.index - b.index);
}

async function scrollGrid(page: Page, fraction: number) {
  await page.evaluate((fraction) => {
    const scroller = Array.from(document.querySelectorAll<HTMLElement>('.appflowy-custom-scroller, div'))
      .filter((element) => {
        const overflow = getComputedStyle(element).overflowY;

        return (overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight + 500;
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];

    if (scroller) scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * fraction;
  }, fraction);
}

/**
 * Rendered rows at a scroll position once they are loaded and stable: two
 * reads 1.5 s apart list the same rows with the same, non-empty texts (row
 * documents load lazily while scrolling, and every use case here has a
 * non-empty result).
 */
async function settledEmployees(page: Page, fraction: number, fieldIds: string[]): Promise<EmployeeRow[]> {
  const listed = Number(await page.getByTestId('database-grid').getAttribute('data-row-count'));
  const target = Math.round(fraction * Math.max(0, listed - 1));
  const signature = (rows: EmployeeRow[]) =>
    JSON.stringify(rows.map((row) => [row.rowId, fieldIds.map((id) => row.texts[id])]));
  let settled: EmployeeRow[] = [];

  await expect
    .poll(
      async () => {
        await scrollGrid(page, fraction);
        const before = await renderedEmployees(page, fieldIds);

        await page.waitForTimeout(1500);
        const after = await renderedEmployees(page, fieldIds);
        const ready =
          after.length > 3 &&
          after.some((row) => Math.abs(row.index - target) < 60) &&
          after.every((row) => fieldIds.every((id) => Boolean(row.texts[id]))) &&
          signature(before) === signature(after);

        if (ready) settled = after;
        return ready;
      },
      { timeout: 180000, intervals: [500, 1000, 2000], message: `rows at ${fraction * 100}% of the grid` }
    )
    .toBe(true);
  return settled;
}

const amount = (text: string | undefined) => (text ? Number(text) : 0);
const plainNumber = (value: number) => String(Number.isInteger(value) ? value : Number(value.toPrecision(15)));
const roundTo = (value: number, decimals: number) =>
  Math.round(Number((value * 10 ** decimals).toPrecision(15))) / 10 ** decimals;
const at = (seconds: string) => dayjs(Number(seconds) * 1000);
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const names = (value: string) => (value ? value.split(',') : []);
const checked = (value: string) => value === 'Yes';
const firstWord = (value: string) => value.split(' ')[0] ?? '';

function onboardingPercent(value: string): number | null {
  if (!value) return null;
  const checklist = JSON.parse(value) as { options?: unknown[]; selected_option_ids?: unknown[] };
  const options = checklist.options ?? [];

  return options.length === 0 ? 0 : Math.round(((checklist.selected_option_ids ?? []).length / options.length) * 100);
}

function tenure(e: RawEmployee): number {
  return dayjs().startOf('day').diff(at(e['Join Date']), 'year');
}

function seniority(e: RawEmployee): string {
  const years = amount(e['Years of Experience']);

  return years >= 10 ? 'Principal' : years >= 5 ? 'Senior' : 'Junior';
}

/** Expected text of each use-case property; a list allows for `now()` moving on. */
const EXPECTED: Record<string, (e: RawEmployee) => string | string[]> = {
  'UC First name': (e) => firstWord(e.Name),
  'UC Initials': (e) =>
    e.Name.split(' ')
      .map((word) => word.substring(0, 1))
      .join(''),
  'UC Total comp': (e) => usd.format(amount(e.Salary) + amount(e.Bonus)),
  'UC Pay mix': (e) => {
    const salary = amount(e.Salary);

    return `${plainNumber(salary > 0 ? roundTo((amount(e.Bonus) / salary) * 100, 1) : 0)}% bonus`;
  },
  'UC Band': (e) => {
    const salary = amount(e.Salary);

    return salary >= 150000 ? 'Senior band' : salary >= 100000 ? 'Mid band' : 'Junior band';
  },
  'UC Top earner': (e) => (amount(e.Salary) + amount(e.Bonus) > 200000 ? 'Top earner' : 'Standard'),
  'UC Tenure': (e) => `${tenure(e)} yrs`,
  'UC Next anniversary': (e) =>
    at(e['Join Date'])
      .add(tenure(e) + 1, 'year')
      .format('YYYY-MM-DD'),
  'UC Joined': (e) => `${at(e['Join Date']).format('ddd, D MMM, ')}${at(e['Join Date']).year()}`,
  'UC Joined quarter': (e) => {
    const joined = at(e['Join Date']);

    return `Q${Math.ceil((joined.month() + 1) / 3)} ${joined.year()}, ${joined.format('[week] wo')}`;
  },
  'UC Onboarding bar': (e) => {
    const percent = onboardingPercent(e.Onboarding);
    const filled = Math.floor((percent ?? 0) / 10);

    return `${'▓'.repeat(filled)}${'░'.repeat(10 - filled)} ${percent ?? ''}%`;
  },
  'UC Readiness': (e) =>
    !checked(e.Active) ? '⚪ Inactive' : onboardingPercent(e.Onboarding) === 100 ? '🟢 Ready' : '🟡 Onboarding',
  'UC Status': (e) => (checked(e.Active) ? '✅ Active' : '❌ Inactive'),
  'UC Where': (e) => (checked(e.Active) ? (checked(e.Remote) ? 'Remote' : `On-site in ${e.Office}`) : 'Inactive'),
  'UC Skills sentence': (e) => `${firstWord(e.Name)} has ${names(e.Skills).length} skills`,
  'UC Knows Python': (e) => (names(e.Skills).includes('Python') ? 'Yes' : 'No'),
  'UC Languages': (e) => [...names(e.Languages)].sort(collator.compare).join(' · '),
  'UC Website': (e) => `https://www.${e.Email.split('@').pop() ?? ''}`,
  'UC LinkedIn handle': (e) => e.LinkedIn.replace(/.*linkedin.com\/in\//g, ''),
  'UC Phone': (e) => `tel:${e.Phone.replace(/[^0-9+]/g, '')}`,
  'UC Stars': (e) => {
    const performance = amount(e.Performance);

    return performance >= 4.5 ? '⭐⭐⭐' : performance >= 3.5 ? '⭐⭐' : '⭐';
  },
  'UC Seniority': seniority,
  'UC Title line': (e) => `${e['Job Title']} (${seniority(e)})`,
  'UC Reports to': (e) => (e.Manager === '' ? 'No manager' : `Reports to ${firstWord(e.Manager)}`),
  'UC Days since edit': (e) => {
    const edited = at(e.__edited);

    // The cell was evaluated a little earlier than this check.
    return [dayjs().diff(edited, 'day'), dayjs().subtract(2, 'minute').diff(edited, 'day')].map(String);
  },
  'UC Created weekday': (e) => at(e.__created).format('dddd'),
};

async function useCaseColumns(page: Page) {
  const fields = await readGridFieldsDirect(page);

  return fields
    .filter((field) => field.name.startsWith(PREFIX))
    .map((field) => {
      const expected = EXPECTED[field.name];

      if (!expected) throw new Error(`No expected values for "${field.name}"`);
      return { ...field, expected };
    });
}

function mismatch(label: string, actual: string, expected: string | string[]): string | null {
  const allowed = Array.isArray(expected) ? expected : [expected];

  return allowed.includes(actual) ? null : `${label}: expected "${allowed.join('" or "')}", got "${actual}"`;
}

Then("the use-case formulas match each row's data at the top, middle and bottom of the grid", async ({ page }) => {
  const columns = await useCaseColumns(page);
  const problems: string[] = [];
  let checked = 0;

  expect(columns.length).toBeGreaterThan(0);
  for (const fraction of [0, 0.5, 1]) {
    const rows = await settledEmployees(
      page,
      fraction,
      columns.map((column) => column.id)
    );

    for (const row of rows) {
      checked += 1;
      for (const column of columns) {
        const problem = mismatch(
          `row ${row.index + 1} ${column.name}`,
          row.texts[column.id] ?? '',
          column.expected(row.raw)
        );

        if (problem) problems.push(problem);
      }
    }
  }

  expect(checked, 'rows compared').toBeGreaterThan(40);
  expect(problems.slice(0, 20), `${problems.length} mismatching cells`).toEqual([]);
});

// ---------------------------------------------------------------------------
// Row page
// ---------------------------------------------------------------------------

When('I open the row page of the first employee', async ({ page }) => {
  await closeMenus(page);
  await scrollGrid(page, 0);
  const [first] = await settledEmployees(page, 0, []);

  stateOf(page).rowPageId = first.rowId;
  await page.setViewportSize(SCREENSHOT_VIEWPORT);
  await openRowDetail(page, 0);
});

Then('the row page shows the use-case formulas for that employee', async ({ page }) => {
  const rowId = stateOf(page).rowPageId;

  if (!rowId) throw new Error('No row page is open');
  const columns = await useCaseColumns(page);
  const [employee] = (await renderedEmployees(page, [])).filter((row) => row.rowId === rowId);

  if (!employee) throw new Error('The first employee is no longer rendered');
  const modal = RowDetailSelectors.modal(page);

  await expect(modal.getByTestId(`formula-cell-${rowId}-${columns[0].id}`)).toBeAttached({ timeout: 30000 });
  for (const column of columns) {
    const cell = modal.getByTestId(`formula-cell-${rowId}-${column.id}`);

    await cell.scrollIntoViewIfNeeded();
    await expect
      .poll(
        async () => {
          const text = await cell.evaluate((element) => {
            if (element.querySelector('[data-testid="formula-checked-icon"]')) return 'Yes';
            if (element.querySelector('[data-testid="formula-unchecked-icon"]')) return 'No';
            return (element.textContent ?? '').trim();
          });

          return mismatch(column.name, text, column.expected(employee.raw));
        },
        { timeout: 15000, message: column.name }
      )
      .toBeNull();
  }

  await modal.getByTestId(`formula-cell-${rowId}-${columns[0].id}`).scrollIntoViewIfNeeded();
});

// ---------------------------------------------------------------------------
// Filters, sorts, edits
// ---------------------------------------------------------------------------

async function listedEmployees(page: Page): Promise<number> {
  return Number(await page.getByTestId('database-grid').getAttribute('data-row-count'));
}

When(
  'I filter {string} with the text condition {string} and value {string}',
  async ({ page }, name: string, condition: string, value: string) => {
    const conditions: Record<string, number> = {
      is: TextFilterCondition.TextIs,
      contains: TextFilterCondition.TextContains,
    };

    if (conditions[condition] === undefined) throw new Error(`Unknown text condition "${condition}"`);
    await addFilterByFieldName(page, name);
    await changeFilterCondition(page, conditions[condition]);
    await enterFilterText(page, value);
    await closeMenus(page);
  }
);

When('I remember the number of listed employees as {string}', async ({ page }, label: string) => {
  // Filtering runs over every row in the background; wait until the count settles.
  const reads: number[] = [];

  await expect
    .poll(
      async () => {
        reads.push(await listedEmployees(page));
        const [a, b, c] = reads.slice(-3);

        return reads.length >= 3 && a === b && b === c && c > 0 && c < 5000;
      },
      { timeout: 300000, intervals: [3000] }
    )
    .toBe(true);
  stateOf(page).remembered.set(label, reads[reads.length - 1]);
});

When('I remove the employees filters', async ({ page }) => {
  await closeMenus(page);
  await deleteFilter(page);
  await closeMenus(page);
  await expect(page.getByTestId('database-filter-condition')).toHaveCount(0, { timeout: 20000 });
});

Then('the grid lists as many employees as {string}', async ({ page }, label: string) => {
  const expected = stateOf(page).remembered.get(label);

  if (expected === undefined) throw new Error(`Nothing remembered as "${label}"`);
  await expect.poll(() => listedEmployees(page), { timeout: 300000, intervals: [2000] }).toBe(expected);
});

Then(
  'the listed employees at the top and bottom all have at least {int} years of experience',
  async ({ page }, years: number) => {
    for (const fraction of [0, 1]) {
      const rows = await settledEmployees(page, fraction, []);
      const junior = rows.filter((row) => amount(row.raw['Years of Experience']) < years);

      expect(junior.map((row) => `${row.raw.Name}: ${row.raw['Years of Experience']}`)).toEqual([]);
    }
  }
);

Then('the employees at the top and bottom are ordered by Salary plus Bonus, highest first', async ({ page }) => {
  const total = (row: EmployeeRow) => amount(row.raw.Salary) + amount(row.raw.Bonus);
  let top = 0;

  for (const fraction of [0, 1]) {
    // The sort runs in the background over every row; wait for its final order.
    await expect
      .poll(
        async () => {
          const rows = await settledEmployees(page, fraction, []);
          const ordered = rows.every((row, index) => index === 0 || total(rows[index - 1]) >= total(row));

          if (fraction === 0 && ordered) top = total(rows[0]);
          return ordered && (fraction === 0 || total(rows[rows.length - 1]) <= top);
        },
        { timeout: 300000, intervals: [2000, 5000], message: `sorted rows at ${fraction * 100}%` }
      )
      .toBe(true);
  }
});

async function fieldIdNamed(page: Page, name: string): Promise<string> {
  const field = (await readGridFieldsDirect(page)).find((entry) => entry.name === name);

  if (!field) throw new Error(`No property named "${name}"`);
  return field.id;
}

When("I change the first employee's {string} to {string}", async ({ page }, name: string, value: string) => {
  const fieldId = await fieldIdNamed(page, name);
  const [first] = await settledEmployees(page, 0, []);

  stateOf(page).editedCells.push({ rowId: first.rowId, fieldId, data: first.raw[name] ?? '' });
  await typeTextIntoCell(page, fieldId, 0, value);
});

async function firstEmployeeText(page: Page, name: string) {
  const fieldId = await fieldIdNamed(page, name);
  const [first] = await renderedEmployees(page, [fieldId]);

  return { text: first?.texts[fieldId], raw: first?.raw };
}

Then(
  "the first employee's {string} shows Salary plus Bonus within {int} seconds",
  async ({ page }, name: string, seconds: number) => {
    await expect
      .poll(
        async () => {
          const { text, raw } = await firstEmployeeText(page, name);

          return (
            raw !== undefined && text === plainNumber(amount(raw.Salary) + amount(raw.Bonus)) && raw.Bonus === '123456'
          );
        },
        { timeout: seconds * 1000, intervals: [50, 100] }
      )
      .toBe(true);
  }
);

Then(
  "the first employee's {string} shows {string} within {int} seconds",
  async ({ page }, name: string, expected: string, seconds: number) => {
    await expect
      .poll(async () => (await firstEmployeeText(page, name)).text, { timeout: seconds * 1000, intervals: [50, 100] })
      .toBe(expected);
  }
);

// ---------------------------------------------------------------------------
// Screenshots and the recorded walkthrough
// ---------------------------------------------------------------------------

/**
 * Hides every column except `visible` (by name) and properties starting with
 * `alsoPrefix`, touching only the columns whose visibility changes. Their
 * previous values stay in the page until `restoreColumns` puts them back.
 */
async function showOnlyColumns(page: Page, visible: string[], options: { alsoPrefix?: string } = {}): Promise<void> {
  await page.evaluate(
    ({ visible, alsoPrefix, hidden }) => {
      const testWindow = window as any;
      const ctx = testWindow.__TEST_DATABASE_CONTEXT__;
      const database = ctx.databaseDoc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);
      const fields = database.get('fields');
      const previous = new Map<string, unknown>();

      ctx.databaseDoc.transact(() => {
        view.get('field_orders').forEach(({ id }: { id: string }) => {
          const name = String(fields.get(id)?.get('name') ?? '');
          const setting = view.get('field_settings')?.get(id);
          const target = visible.includes(name) || Boolean(alsoPrefix && name.startsWith(alsoPrefix)) ? 0 : hidden;
          const current = setting?.get('visibility');

          if (!setting || Number(current ?? 0) === target) return;
          previous.set(id, current);
          setting.set('visibility', target);
        });
      });
      testWindow.__formulaColumnBackup = previous;
    },
    { visible, alsoPrefix: options.alsoPrefix, hidden: FIELD_VISIBILITY_HIDDEN }
  );
}

async function restoreColumns(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as any;
    const previous: Map<string, unknown> | undefined = testWindow.__formulaColumnBackup;
    const ctx = testWindow.__TEST_DATABASE_CONTEXT__;
    const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(ctx.activeViewId);

    if (!previous) return;
    ctx.databaseDoc.transact(() => {
      previous.forEach((value, id) => {
        const setting = view.get('field_settings')?.get(id);

        if (!setting) return;
        // Yjs cannot write a BigInt (desktop-written integers); the web writes numbers.
        if (value === undefined || value === null) setting.delete('visibility');
        else setting.set('visibility', typeof value === 'bigint' ? Number(value) : value);
      });
    });
    testWindow.__formulaColumnBackup = undefined;
  });
}

async function saveScreenshot(page: Page, name: string) {
  const dir = mediaDir();

  if (!dir) return;
  // The local server is older than the web app; its banner is not part of the feature.
  const dismiss = page.getByRole('button', { name: 'Dismiss compatibility warning' });

  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

When('I save a screenshot {string} of the columns {string}', async ({ page }, name: string, columns: string) => {
  if (!mediaDir()) return;
  await closeMenus(page);
  await page.setViewportSize(SCREENSHOT_VIEWPORT);
  await showOnlyColumns(
    page,
    columns.split(',').map((column) => column.trim())
  );

  await scrollGrid(page, 0);
  await page.waitForTimeout(2500);
  await saveScreenshot(page, name);
  // Put the columns back and read the grid wide again.
  await restoreColumns(page);
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.waitForTimeout(1000);
});

When('I save a screenshot {string}', async ({ page }, name: string) => {
  await saveScreenshot(page, name);
});

function recordingOf(page: Page): Page {
  const recording = stateOf(page).recording;

  if (!recording) throw new Error('No recording window is open');
  return recording.page;
}

Given("a recording window on Nathan's 5000_employees database", async ({ page, browser }) => {
  const dir = mediaDir() ?? test.info().outputPath('recording');
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir, size: { width: 1440, height: 900 } },
    storageState: await page.context().storageState(),
  });

  await allowTestHooks(context);
  const recorded = await context.newPage();

  setupPageErrorHandling(recorded);
  stateOf(page).recording = { context, page: recorded };
  await openDatabase(recorded);
  await showOnlyColumns(recorded, ['Name', 'Active', 'Salary', 'Bonus', 'Skills'], { alsoPrefix: PREFIX });
  // The cleanup window restores these columns from the scenario's snapshot.
  const dismiss = recorded.getByRole('button', { name: 'Dismiss compatibility warning' });

  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  await recorded.waitForTimeout(2000);
});

When(
  /^I write the formula "(.*)" as "([^"]*)" in the recording window$/,
  async ({ page }, expression: string, name: string) => {
    const recorded = recordingOf(page);

    await startNewFormulaProperty(recorded);
    // Typed at a readable pace so the recording shows autocomplete and the live preview.
    await formulaInput(recorded).pressSequentially(expression, { delay: 45 });
    await expect(recorded.getByTestId('formula-preview-value')).not.toHaveText('', { timeout: 10000 });
    await recorded.waitForTimeout(1200);
    await saveScreenshot(recorded, `05-editor-${name.replace(/\W+/g, '-').toLowerCase()}`);
    await saveFormula(recorded);
    await renameField(recorded, await lastFieldId(recorded), name);
    await recorded.waitForTimeout(1500);
  }
);

When(
  'I show {string} as a bar divided by {int} with its number in the recording window',
  async ({ page }, name: string, divisor: number) => {
    const recorded = recordingOf(page);
    const fieldId = await fieldIdNamed(recorded, name);

    await chooseShowAs(recorded, fieldId, SHOW_AS_IDS.Bar);
    await openPropertyMenu(recorded, fieldId);
    const input = recorded.getByTestId('rollup-visualization-divisor').last();

    await input.click();
    await input.fill(String(divisor));
    const showNumber = recorded.getByTestId('rollup-visualization-show-number').last();

    if ((await showNumber.getAttribute('aria-checked')) !== 'true') await showNumber.click();
    await expect(showNumber).toHaveAttribute('aria-checked', 'true');
    await recorded.waitForTimeout(1000);
    await saveScreenshot(recorded, '06-show-as-bar-menu');
    await closeMenus(recorded);
    await recorded.waitForTimeout(1500);
  }
);

Then('the recording window shows the columns {string}', async ({ page }, columns: string) => {
  const recorded = recordingOf(page);

  for (const column of columns.split(',').map((entry) => entry.trim())) {
    await expect(
      recorded.locator('[data-testid^="grid-field-header-"]').filter({ hasText: column }).first()
    ).toBeVisible({ timeout: 20000 });
  }

  await recorded.waitForTimeout(2000);
  await saveScreenshot(recorded, '07-recorded-grid');
});

When('I save the recording', async ({ page, browser }) => {
  const state = stateOf(page);
  const recording = state.recording;

  if (!recording) throw new Error('No recording window is open');
  const video = recording.page.video();

  await recording.page.waitForTimeout(1500);
  await recording.context.close();
  state.recording = undefined;
  const dir = mediaDir();

  if (video && dir) copyFileSync(await video.path(), join(dir, 'formula-walkthrough.webm'));
  // Clean up from a fresh window: the recording's changes may not have reached this page yet.
  const cleanup = await browser.newContext({ storageState: await page.context().storageState() });

  await allowTestHooks(cleanup);
  const cleanupPage = await cleanup.newPage();

  await openDatabase(cleanupPage);
  await restoreDatabase(cleanupPage, state.snapshot, PREFIX);
  await cleanupPage.waitForTimeout(3000);
  await cleanup.close();
});
