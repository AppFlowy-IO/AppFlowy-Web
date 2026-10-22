import { expect, type BrowserContext, type Page, test } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { waitForGridReady } from '../../support/database-ui-helpers';
import { addFieldWithType } from '../../support/field-type-helpers';
import {
  addFilterByFieldName,
  getPrimaryFieldId,
  loginAndCreateGrid,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  FieldType,
  GridFieldSelectors,
  PageSelectors,
  PropertyMenuSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { waitForDatabaseDocReady } from '../../support/yjs-inject-helpers';

import type { Doc } from 'yjs';

const { Given, When, Then } = createBdd();
const conditions = { Is: 0, Before: 1, After: 2, 'On or before': 3, 'On or after': 4 } as const;
const relativeDays = ['Yesterday', 'Today', 'Tomorrow'] as const;
const stateByPage = new WeakMap<Page, { primaryFieldId: string; dateFieldId: string; now: number }>();

function stateFor(page: Page) {
  const state = stateByPage.get(page);

  if (!state) throw new Error('The real relative-date database has not been created');
  return state;
}

function conditionValue(label: string): number {
  if (!(label in conditions)) throw new Error(`Unknown date comparison: ${label}`);
  return conditions[label as keyof typeof conditions];
}

/** Only rollout authorization is controlled; database, auth, and sync traffic reach the real services. */
async function enableRelativeDateRollout(context: BrowserContext) {
  await context.route('**/api/server-info{,?**}', async (route) => {
    const headers = { ...route.request().headers() };

    // The capability override needs a body, including when the app revalidates its cached response.
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const response = await route.fetch({ headers });

    expect(response.ok(), 'Real Cloud server-info response').toBe(true);
    const body = await response.json();

    expect(body.code).toBe(0);
    await route.fulfill({
      response,
      json: { ...body, data: { ...body.data, enable_relative_date_comparisons: true } },
    });
  });
}

async function dismissFilterEditor(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('date-filter-relative-today')).toBeHidden();
}

interface StoredFilter {
  field_id?: string;
  condition?: number;
  content?: string;
  children?: StoredFilter[];
}

async function readDateComparison(page: Page, fieldId: string) {
  return page.evaluate((id) => {
    const win = window as Window & { __TEST_DATABASE_DOC__?: Doc; __TEST_DATABASE_VIEW_ID__?: string };
    const data = win.__TEST_DATABASE_DOC__?.getMap('data').toJSON() as
      | { database: { views: Record<string, { filters: StoredFilter[] }> } }
      | undefined;
    const filters = data?.database.views[win.__TEST_DATABASE_VIEW_ID__ ?? '']?.filters ?? [];
    const flatten = (nodes: StoredFilter[]): StoredFilter[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

    return flatten(filters)
      .filter((filter) => filter.field_id === id)
      .map((filter) => ({ condition: filter.condition, content: filter.content ? JSON.parse(filter.content) : null }));
  }, fieldId);
}

Given('a real Grid with Yesterday, Today, and Tomorrow tasks', async ({ page, request }) => {
  test.setTimeout(240_000);
  const now = Date.now();

  // Let Date.now advance with real timers so authentication and sync deadlines keep working.
  await page.clock.install({ time: now });
  await enableRelativeDateRollout(page.context());
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await PageSelectors.titleInput(page).first().fill('Relative date comparisons');
  await page.keyboard.press('Enter');
  const primaryFieldId = await getPrimaryFieldId(page);
  const dateFieldId = await addFieldWithType(page, FieldType.DateTime);

  expect(dateFieldId).not.toBe('');
  await GridFieldSelectors.fieldHeader(page, dateFieldId).last().click();
  await PropertyMenuSelectors.editPropertyMenuItem(page).first().click();
  const propertyName = page.locator('[data-radix-popper-content-wrapper]').last().locator('input').first();

  await propertyName.fill('Due Date');
  await page.keyboard.press('Escape');
  await expect(GridFieldSelectors.fieldHeader(page, dateFieldId).last()).toContainText('Due Date');
  const dates = await page.evaluate(() =>
    [-1, 0, 1].map((offset) => {
      const date = new Date();

      date.setDate(date.getDate() + offset);
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
    })
  );

  for (const [index, day] of relativeDays.entries()) {
    await typeTextIntoCell(page, primaryFieldId, index, `${day} task`);
    const cell = DatabaseGridSelectors.dataRowCellsForField(page, dateFieldId).nth(index);

    await cell.click();
    const input = page.getByTestId('datetime-date-input');

    await expect(input).toBeVisible();
    await input.fill(dates[index]);
    await input.press('Enter');
    await page.keyboard.press('Escape');
    await expect(cell).not.toHaveText('');
  }

  await expect(DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)).toHaveText(
    relativeDays.map((day) => `${day} task`)
  );
  stateByPage.set(page, { primaryFieldId, dateFieldId, now });
});

When('I filter Due Date with {string} {string}', async ({ page }, operator: string, day: string) => {
  expect(relativeDays).toContain(day);
  const chip = DatabaseFilterSelectors.filterCondition(page);

  if ((await chip.count()) === 0) await addFilterByFieldName(page, 'Due Date');
  else await chip.click();
  await page.getByTestId('filter-condition-trigger').click();
  await page.getByTestId(`filter-condition-${conditionValue(operator)}`).click();
  await page.getByTestId('date-filter-date-picker').click();
  await page.getByTestId(`date-filter-relative-${day.toLowerCase()}`).click();
  await expect(page.getByTestId('date-filter-date-picker')).toHaveText(day);
  await dismissFilterEditor(page);
  await expect(chip).toContainText(day);
});

Then('the relative-date grid shows exactly {string}', async ({ page }, names: string) => {
  const { primaryFieldId } = stateFor(page);

  await expect(DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)).toHaveText(names.split(', '));
  await test.info().attach(`Visible rows: ${names}`, {
    body: await page.screenshot(), contentType: 'image/png',
  });
});

Then('the saved date comparison is {string} {string}', async ({ page }, operator: string, day: string) => {
  await expect.poll(() => readDateComparison(page, stateFor(page).dateFieldId)).toEqual([
    { condition: conditionValue(operator), content: { relative_date: day } },
  ]);
});

Then('a fresh browser reads the same date comparison and rows from Cloud', async ({ page, browser }) => {
  const state = stateFor(page);
  const expectedFilter = await readDateComparison(page, state.dateFieldId);
  const expectedRows = await DatabaseGridSelectors.dataRowCellsForField(page, state.primaryFieldId).allTextContents();

  await expect.poll(() => page.evaluate(async () => {
    const flush = (window as Window & { __TEST_FLUSH_ALL_SYNC__?: () => Promise<boolean> }).__TEST_FLUSH_ALL_SYNC__;

    return flush ? flush() : false;
  }), { message: 'Cell and filter edits reach Cloud before a fresh open', timeout: 30_000 }).toBe(true);
  // Exclude IndexedDB and give the separate browser its own device identity.
  const storageState = await page.context().storageState();

  for (const origin of storageState.origins) {
    origin.localStorage = origin.localStorage.filter(({ name }) => name !== 'x-device-id');
  }

  const freshContext = await browser.newContext({ storageState });
  const freshPage = await freshContext.newPage();

  try {
    const config = await page.evaluate(() => window.__APP_CONFIG__);

    await freshContext.addInitScript((runtimeConfig) => {
      window.__APP_CONFIG__ = runtimeConfig;
      (window as Window & { Cypress?: boolean }).Cypress = true;
    }, config);
    await enableRelativeDateRollout(freshContext);

    await freshPage.clock.install({ time: state.now });
    await freshPage.goto(page.url());
    await waitForGridReady(freshPage);
    await waitForDatabaseDocReady(freshPage);
    expect(await freshPage.evaluate(() => localStorage.getItem('x-device-id'))).not.toBe(
      await page.evaluate(() => localStorage.getItem('x-device-id'))
    );
    await expect.poll(() => readDateComparison(freshPage, state.dateFieldId), { timeout: 30_000 }).toEqual(expectedFilter);
    await expect(DatabaseGridSelectors.dataRowCellsForField(freshPage, state.primaryFieldId)).toHaveText(expectedRows);
    await test.info().attach('Fresh Cloud open without IndexedDB', {
      body: await freshPage.screenshot(), contentType: 'image/png',
    });
  } catch (error) {
    await test.info().attach('Failed fresh Cloud open', {
      body: await freshPage.screenshot(), contentType: 'image/png',
    });
    throw error;
  } finally {
    await freshContext.close();
  }
});

When('I reload the relative-date database', async ({ page }) => {
  await page.reload();
  await waitForGridReady(page);
});

When('I switch the date comparison to advanced filters', async ({ page }) => {
  await DatabaseFilterSelectors.filterCondition(page).click();
  await page.getByTestId('filter-more-options-button').click();
  await page.getByRole('menuitem', { name: /switch to advanced filter/i }).click();
  await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible();
  await page.keyboard.press('Escape');
});

When('I choose {string} in the advanced date comparison', async ({ page }, day: string) => {
  expect(relativeDays).toContain(day);
  await DatabaseFilterSelectors.advancedFiltersBadge(page).click();
  await page.getByTestId('advanced-filter-date-input').click();
  await page.getByTestId(`date-filter-relative-${day.toLowerCase()}`).click();
  await expect(page.getByTestId('advanced-filter-date-input')).toHaveText(day);
  await dismissFilterEditor(page);
});

When('I return to the database on the next day', async ({ page }) => {
  const tomorrow = await page.evaluate(() => {
    const date = new Date();

    date.setDate(date.getDate() + 1);
    return date.getTime();
  });

  await page.clock.setSystemTime(tomorrow);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
});
