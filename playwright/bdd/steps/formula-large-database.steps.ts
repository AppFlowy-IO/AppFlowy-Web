import { existsSync, readFileSync, writeFileSync } from 'fs';

import { expect, type Page, test } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  EMPLOYEE_FIELDS,
  employeeRecords,
  type EmployeesCellDef,
  expectEmployeesOnServer,
  loadEmployeesFixture,
  seedEmployeesDatabase,
} from '../../support/employees-database';
import { loginAndCreateGrid } from '../../support/field-type-helpers';
import { deleteFilter } from '../../support/filter-test-helpers';
import { closeMenus, formulaInput, readGridFieldsDirect, typeFormula } from '../../support/formula-test-helpers';
import { FieldType } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

const { Given, When, Then } = createBdd();

// ---------------------------------------------------------------------------
// Seeded database, shared by the scenarios of one worker
// ---------------------------------------------------------------------------

interface SeededDatabase {
  apiUrl: string;
  baseUrl: string;
  email: string;
  url: string;
  /** Row ids in fixture order. */
  rowIds: string[];
}

/** Every column is mounted at this width, so all of them are read from the same rows. */
const WIDE_VIEWPORT = { width: 7200, height: 1000 };
/** Rows whose cells a scenario may edit; restored before every scenario. */
const RESTORED_ROWS = 3;

let seeded: SeededDatabase | undefined;

function rowLimit(): number | undefined {
  const limit = Number(process.env.EMPLOYEES_ROW_LIMIT);

  return Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

function readCachedDatabase(): SeededDatabase | undefined {
  const file = process.env.LARGE_DATABASE_CACHE;

  if (!file || !existsSync(file)) return undefined;
  const cached = JSON.parse(readFileSync(file, 'utf8')) as SeededDatabase;
  const expectedRows = rowLimit() ?? loadEmployeesFixture().rows.length;

  if (cached.apiUrl !== TestConfig.apiUrl || cached.baseUrl !== baseUrl() || cached.rowIds.length !== expectedRows) {
    return undefined;
  }

  return cached;
}

function baseUrl(): string {
  return process.env.BASE_URL || 'http://localhost:3000';
}

async function openSeededDatabase(page: Page, database: SeededDatabase) {
  await signInAndWaitForApp(page, page.request, database.email);
  await page.goto(database.url);
  await page.waitForFunction(() => Boolean((window as any).__TEST_DATABASE_CONTEXT__), null, { timeout: 120000 });
  await expect(page.getByTestId('database-grid')).toBeVisible({ timeout: 120000 });
}

/** Removes the properties, filters, sorts and calculations a scenario may have added. */
async function resetDatabaseSettings(page: Page) {
  await page.evaluate((fieldIds) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const doc = ctx.databaseDoc;
    const database = doc.getMap('data').get('database');
    const fields = database.get('fields');
    const keep = new Set(fieldIds);

    doc.transact(() => {
      Array.from(fields.keys() as Iterable<string>)
        .filter((id) => !keep.has(id))
        .forEach((id) => fields.delete(id));
      database.get('views').forEach((view: any) => {
        const orders = view.get('field_orders');

        for (let index = orders.length - 1; index >= 0; index -= 1) {
          if (!keep.has(orders.get(index).id)) orders.delete(index, 1);
        }

        const settings = view.get('field_settings');

        Array.from((settings?.keys() ?? []) as Iterable<string>)
          .filter((id) => !keep.has(id))
          .forEach((id) => settings.delete(id));
        ['filters', 'sorts', 'calculations'].forEach((key) => {
          const list = view.get(key);

          if (list?.length) list.delete(0, list.length);
        });
      });
    });
  }, loadEmployeesFixture().fields.map((field) => field.id));
}

/** Puts back the fixture cells of the first rows, which scenarios may edit. */
async function restoreEditedRows(page: Page, database: SeededDatabase) {
  const fixture = loadEmployeesFixture();
  const restored = database.rowIds.slice(0, RESTORED_ROWS).map((rowId, index) => ({
    rowId,
    cells: fixture.rows[index],
  }));

  await page.evaluate(
    async ({ fieldIds, restored }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

      for (const { rowId, cells } of restored) {
        // The grid's own row doc, so the restored value is what formulas and conversions read.
        const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));

        if (!rowDoc) throw new Error(`Row ${rowId} is not loaded`);
        const yCells = rowDoc.getMap('data').get('data')?.get('cells');

        if (!yCells) continue;
        rowDoc.transact(() => {
          cells.forEach((cell: { data: string }, index: number) => {
            const yCell = yCells.get(fieldIds[index]);

            if (yCell && yCell.get('data') !== cell.data) yCell.set('data', cell.data);
          });
        });
      }
    },
    { fieldIds: fixture.fields.map((field) => field.id), restored }
  );
}

Given('the 5000 employees database is open', async ({ page, request }) => {
  // Seeding and whole-grid checks take minutes.
  test.setTimeout(Math.max(test.info().timeout, 45 * 60 * 1000));
  await page.setViewportSize(WIDE_VIEWPORT);
  seeded ??= readCachedDatabase();

  if (seeded) {
    await openSeededDatabase(page, seeded);
  } else {
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);
    const rowIds = await seedEmployeesDatabase(page, { rowLimit: rowLimit() });

    await expectEmployeesOnServer(page, rowIds);
    seeded = { apiUrl: TestConfig.apiUrl, baseUrl: baseUrl(), email, url: page.url(), rowIds };
    if (process.env.LARGE_DATABASE_CACHE) {
      writeFileSync(process.env.LARGE_DATABASE_CACHE, JSON.stringify(seeded));
    }
  }

  await resetDatabaseSettings(page);
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(seeded.rowIds.length), {
    timeout: 120000,
  });
  // Restore only once the top rows are loaded, then confirm the grid shows the fixture again.
  const salaryId = EMPLOYEE_FIELDS.Salary;
  const expectedSalaries = employeeRecords()
    .slice(0, RESTORED_ROWS)
    .map((employee) => money(employee.Salary.data));

  await settledRows(page, 0, [salaryId]);
  await restoreEditedRows(page, seeded);
  await expect
    .poll(async () => {
      const rows = await renderedRows(page, [salaryId]);

      return expectedSalaries.map((_salary, index) => money(rows.find((row) => row.index === index)?.cells[salaryId] ?? ''));
    })
    .toEqual(expectedSalaries);
});

// ---------------------------------------------------------------------------
// Reading the grid
// ---------------------------------------------------------------------------

interface RenderedRow {
  rowId: string;
  index: number;
  cells: Record<string, string>;
}

/** Every rendered data row (0-based position in the grid) with the text of the given columns. */
async function renderedRows(page: Page, fieldIds: string[]): Promise<RenderedRow[]> {
  const rows = await page.evaluate((fieldIds) => {
    const readCell = (cell: HTMLElement) => {
      const checkbox = cell.querySelector('[data-checked]');

      if (checkbox) return checkbox.getAttribute('data-checked') === 'true' ? 'Yes' : 'No';
      if (cell.querySelector('[data-testid="formula-checked-icon"]')) return 'Yes';
      if (cell.querySelector('[data-testid="formula-unchecked-icon"]')) return 'No';
      const chips = cell.querySelectorAll('[data-testid^="select-option-cell-"] > div > div > div');

      if (chips.length > 0) return Array.from(chips, (chip) => (chip.textContent ?? '').trim()).join(', ');
      return (cell.textContent ?? '').trim();
    };

    return Array.from(document.querySelectorAll<HTMLElement>('[data-row-id][data-index]'))
      .map((wrapper) => {
        const row = wrapper.querySelector<HTMLElement>('[data-testid^="grid-row-"]');
        const rowId = wrapper.getAttribute('data-row-id') ?? '';

        if (!row || !rowId) return null;
        const cells: Record<string, string> = {};

        fieldIds.forEach((fieldId) => {
          const cell = row.querySelector<HTMLElement>(`.grid-row-cell[data-column-id="${fieldId}"]`);

          if (cell) cells[fieldId] = readCell(cell);
        });
        // The virtual list starts with the header row, so data rows begin at 1.
        return { rowId, index: Number(wrapper.getAttribute('data-index')) - 1, cells };
      })
      .filter((row): row is { rowId: string; index: number; cells: Record<string, string> } => row !== null);
  }, fieldIds);

  return rows.sort((a, b) => a.index - b.index);
}

/** Scrolls the grid body to a fraction of its height. */
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
 * Rendered rows at a scroll position once every listed column shows content
 * (row documents load lazily while scrolling).
 */
async function settledRows(page: Page, fraction: number, fieldIds: string[]): Promise<RenderedRow[]> {
  const listed = Number(await page.getByTestId('database-grid').getAttribute('data-row-count'));
  const target = Math.round(fraction * Math.max(0, listed - 1));

  await scrollGrid(page, fraction);
  await expect
    .poll(
      async () => {
        await scrollGrid(page, fraction);
        const rows = await renderedRows(page, fieldIds);

        return (
          rows.length > 3 &&
          // The virtualizer has caught up with the scroll position...
          rows.some((row) => Math.abs(row.index - target) < 60) &&
          // ...and every listed column has content.
          rows.every((row) => fieldIds.every((id) => row.cells[id] !== undefined && row.cells[id] !== ''))
        );
      },
      { timeout: 120000, intervals: [500, 1000, 2000], message: `rows at ${fraction * 100}% of the grid` }
    )
    .toBe(true);
  // Let formula columns catch up with rows that loaded last.
  await page.waitForTimeout(1500);
  return renderedRows(page, fieldIds);
}

async function fieldIdByName(page: Page, name: string): Promise<string> {
  const field = (await readGridFieldsDirect(page)).find((entry) => entry.name === name);

  if (!field) throw new Error(`No property named "${name}"`);
  return field.id;
}

function fixtureIndexByRowId(): Map<string, number> {
  if (!seeded) throw new Error('The employees database is not seeded');
  return new Map(seeded.rowIds.map((rowId, index) => [rowId, index]));
}

const money = (text: string) => Number(text.replace(/[^0-9.-]/g, '') || 0);
const plainNumber = (value: number) => String(Number(value.toFixed(10)));
const pad = (value: number) => String(value).padStart(2, '0');
const localDate = (seconds: string) => new Date(Number(seconds) * 1000);
const usDate = (date: Date) => `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function optionNames(fieldName: string): Map<string, string> {
  const field = loadEmployeesFixture().fields.find((entry) => entry.name === fieldName);
  const content = field?.type_options[String(field.field_type)]?.content;
  const options = content ? (JSON.parse(String(content)).options as Array<{ id: string; name: string }>) : [];

  return new Map(options.map((option) => [option.id, option.name]));
}

function selectNames(fieldName: string, cell: EmployeesCellDef): string {
  const names = optionNames(fieldName);

  return cell.data
    .split(',')
    .filter(Boolean)
    .map((id) => names.get(id) ?? id)
    .join(', ');
}

function checklistPercent(cell: EmployeesCellDef): number {
  if (!cell.data) return 0;
  const checklist = JSON.parse(cell.data) as { options: unknown[]; selected_option_ids: unknown[] };

  return checklist.options.length === 0
    ? 0
    : Math.round((checklist.selected_option_ids.length / checklist.options.length) * 100);
}

type Employee = Record<string, EmployeesCellDef>;

/** What each fixture column shows in the grid. */
const NATIVE_TEXT: Record<string, (employee: Employee) => string> = {
  Name: (e) => e.Name.data,
  Department: (e) => selectNames('Department', e.Department),
  Salary: (e) => String(money(e.Salary.data)),
  Email: (e) => e.Email.data,
  Active: (e) => (e.Active.data === 'Yes' ? 'Yes' : 'No'),
  Skills: (e) => selectNames('Skills', e.Skills),
  Onboarding: (e) => `${checklistPercent(e.Onboarding)}%`,
  'Join Date': (e) => (e['Join Date'].data ? usDate(localDate(e['Join Date'].data)) : ''),
  'Job Title': (e) => e['Job Title'].data,
  Manager: (e) => e.Manager.data,
  Office: (e) => selectNames('Office', e.Office),
  Performance: (e) => e.Performance.data,
  Bonus: (e) => String(money(e.Bonus.data)),
  'Years of Experience': (e) => e['Years of Experience'].data,
  Phone: (e) => e.Phone.data,
  Languages: (e) => selectNames('Languages', e.Languages),
  Remote: (e) => (e.Remote.data === 'Yes' ? 'Yes' : 'No'),
};
/** Number columns render with their format ("$185,000", "3.0"); compare their values. */
const NUMERIC_COLUMNS = new Set(['Salary', 'Bonus', 'Performance', 'Years of Experience']);

const totalPay = (e: Employee) => money(e.Salary.data) + money(e.Bonus.data);

/** What each formula of the "every field type" scenario shows, by property name. */
const FORMULA_TEXT: Record<string, (employee: Employee) => string> = {
  'Upper name': (e) => e.Name.data.toUpperCase(),
  'Dept and office': (e) => `${selectNames('Department', e.Department)} / ${selectNames('Office', e.Office)}`,
  'Total pay': (e) => plainNumber(totalPay(e)),
  'Rating x2': (e) => plainNumber(Number(e.Performance.data || 0) * 2),
  Status: (e) => (e.Active.data === 'Yes' ? 'Active' : 'Inactive'),
  'Email domain': (e) => e.Email.data.split('@').pop() ?? '',
  'Skill list': (e) => selectNames('Skills', e.Skills),
  'Skill count': (e) => String(e.Skills.data.split(',').filter(Boolean).length),
  'Onboarded percent': (e) => String(checklistPercent(e.Onboarding)),
  Joined: (e) => (e['Join Date'].data ? usDate(localDate(e['Join Date'].data)) : ''),
  'First anniversary': (e) => {
    if (!e['Join Date'].data) return '';
    const date = localDate(e['Join Date'].data);

    date.setFullYear(date.getFullYear() + 1);
    return isoDate(date);
  },
  'Created day': (e) => isoDate(localDate(e['Created at'].data)),
  'Edited after': (e) => (Number(e['Last modified'].data) >= Number(e['Created at'].data) ? 'Yes' : 'No'),
  'Annual pay': (e) => plainNumber(totalPay(e) * 12),
};

async function expectColumnsMatch(
  page: Page,
  columns: Array<{ fieldId: string; label: string; expected: (employee: Employee) => string; numeric?: boolean }>
) {
  const employees = employeeRecords();
  const byRowId = fixtureIndexByRowId();
  const mismatches: string[] = [];
  let checked = 0;

  for (const fraction of [0, 0.5, 1]) {
    const rows = await settledRows(
      page,
      fraction,
      columns.map((column) => column.fieldId)
    );

    for (const row of rows) {
      const index = byRowId.get(row.rowId);

      if (index === undefined) continue;
      checked += 1;
      for (const column of columns) {
        const actual = row.cells[column.fieldId] ?? '';
        const expected = column.expected(employees[index]);
        const same = column.numeric ? money(actual) === money(expected) : actual === expected;

        if (!same) mismatches.push(`row ${index + 1} ${column.label}: expected "${expected}", got "${actual}"`);
      }
    }
  }

  expect(checked, 'rows compared').toBeGreaterThan(20);
  expect(mismatches.slice(0, 20), `${mismatches.length} mismatching cells`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

async function expectListedRows(page: Page, count: number) {
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(count), {
    timeout: 300000,
  });
}

Then('the grid lists every seeded row', async ({ page }) => {
  if (!seeded) throw new Error('The employees database is not seeded');
  await expectListedRows(page, seeded.rowIds.length);
});

Then('the grid lists the seeded rows whose Salary is above {int}', async ({ page }, threshold: number) => {
  if (!seeded) throw new Error('The employees database is not seeded');
  const expected = employeeRecords()
    .slice(0, seeded.rowIds.length)
    .filter((employee) => money(employee.Salary.data) > threshold).length;

  await expectListedRows(page, expected);
});

Then('the rows at the top, middle and bottom match the fixture', async ({ page }) => {
  await expectColumnsMatch(
    page,
    Object.entries(NATIVE_TEXT).map(([name, expected]) => ({
      fieldId: EMPLOYEE_FIELDS[name as keyof typeof EMPLOYEE_FIELDS],
      label: name,
      expected,
      numeric: NUMERIC_COLUMNS.has(name),
    }))
  );
});

Then('the formula properties match the fixture at the top, middle and bottom', async ({ page }) => {
  const fields = await readGridFieldsDirect(page);
  const columns = fields
    .filter((field) => field.type === FieldType.Formula)
    .map((field) => {
      const expected = FORMULA_TEXT[field.name];

      if (!expected) throw new Error(`No expected values for the formula "${field.name}"`);
      return { fieldId: field.id, label: field.name, expected };
    });

  expect(columns.length).toBe(Object.keys(FORMULA_TEXT).length);
  await expectColumnsMatch(page, columns);
});

Then('every listed row at the top and bottom has a Salary above {int}', async ({ page }, threshold: number) => {
  for (const fraction of [0, 1]) {
    const rows = await settledRows(page, fraction, [EMPLOYEE_FIELDS.Salary]);
    const low = rows.filter((row) => money(row.cells[EMPLOYEE_FIELDS.Salary]) <= threshold);

    expect(low.map((row) => row.cells[EMPLOYEE_FIELDS.Salary]), `rows at ${fraction * 100}%`).toEqual([]);
  }
});

Then('the rows at the top and bottom are ordered by Salary plus Bonus, highest first', async ({ page }) => {
  if (!seeded) throw new Error('The employees database is not seeded');
  const totals = employeeRecords()
    .slice(0, seeded.rowIds.length)
    .map(totalPay)
    .sort((a, b) => b - a);
  const byRowId = fixtureIndexByRowId();
  const employees = employeeRecords();

  for (const fraction of [0, 1]) {
    // The sort runs in the background over every row; wait for its final order.
    await expect
      .poll(
        async () => {
          const rows = await settledRows(page, fraction, [EMPLOYEE_FIELDS.Salary]);

          return rows.every((row) => {
            const index = byRowId.get(row.rowId);

            return index !== undefined && totalPay(employees[index]) === totals[row.index];
          });
        },
        { timeout: 300000, intervals: [2000, 5000], message: `sorted rows at ${fraction * 100}%` }
      )
      .toBe(true);
  }
});

Then('row {int} of {string} shows {string} within {int} seconds', async ({ page }, row: number, name: string, text: string, seconds: number) => {
  const fieldId = await fieldIdByName(page, name);

  await scrollGrid(page, 0);
  await expect
    .poll(async () => (await renderedRows(page, [fieldId])).find((entry) => entry.index === row - 1)?.cells[fieldId], {
      timeout: seconds * 1000,
      intervals: [50, 100],
    })
    .toBe(text);
});

// ---------------------------------------------------------------------------
// Filters, calculations, conversion, editor
// ---------------------------------------------------------------------------

When('I remove the large database filters', async ({ page }) => {
  await closeMenus(page);
  await deleteFilter(page);
  await closeMenus(page);
  await expect(page.getByTestId('database-filter-condition')).toHaveCount(0, { timeout: 20000 });
});

const CALCULATIONS: Record<string, number> = { Sum: 4, Average: 0, 'Count all': 5 };

function calculationCell(page: Page, fieldId: string) {
  return page.getByTestId(`grid-calculate-cell-${fieldId}`).last();
}

When('I set the large database calculation of {string} to {string}', async ({ page }, name: string, calculation: string) => {
  const fieldId = await fieldIdByName(page, name);
  const type = CALCULATIONS[calculation];

  if (type === undefined) throw new Error(`Unknown calculation "${calculation}"`);
  await closeMenus(page);
  // The calculation row is the last virtual row of the grid.
  await expect
    .poll(
      async () => {
        await scrollGrid(page, 1);
        return calculationCell(page, fieldId).count();
      },
      { timeout: 60000, intervals: [500] }
    )
    .toBeGreaterThan(0);
  await calculationCell(page, fieldId).evaluate((element) => (element as HTMLElement).click());
  const option = page.getByTestId(`calculation-option-${type}`).last();

  await expect(option).toBeAttached({ timeout: 10000 });
  await option.evaluate((element) => (element as HTMLElement).click());
  await closeMenus(page);
});

Then('the {string} and {string} calculations show the same total', async ({ page }, first: string, second: string) => {
  const firstId = await fieldIdByName(page, first);
  const secondId = await fieldIdByName(page, second);
  const read = async (fieldId: string) =>
    money((await calculationCell(page, fieldId).locator('span').last().textContent()) ?? '');

  await scrollGrid(page, 1);
  await expect
    .poll(
      async () => {
        await scrollGrid(page, 1);
        const [a, b] = [await read(firstId), await read(secondId)];

        return a > 0 && a === b;
      },
      { timeout: 120000, intervals: [1000] }
    )
    .toBe(true);
});

Then('the property {string} is a Number property within {int} seconds', async ({ page }, name: string, seconds: number) => {
  await expect
    .poll(async () => (await readGridFieldsDirect(page)).find((field) => field.name === name)?.type, {
      timeout: seconds * 1000,
      intervals: [1000],
    })
    .toBe(FieldType.Number);
});

Then('{string} matches the fixture Salary at the top, middle and bottom', async ({ page }, name: string) => {
  await expectColumnsMatch(page, [
    { fieldId: await fieldIdByName(page, name), label: name, expected: NATIVE_TEXT.Salary, numeric: true },
  ]);
});

When(/^I type the formula "(.*)" in under (\d+) seconds$/, async ({ page }, expression: string, seconds: string) => {
  const started = Date.now();

  await typeFormula(page, expression);
  await expect(formulaInput(page)).toHaveValue(expression);
  expect(Date.now() - started, 'time to type the formula').toBeLessThan(Number(seconds) * 1000);
});
