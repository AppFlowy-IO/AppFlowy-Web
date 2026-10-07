import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { EditorSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then } = createBdd();

const HEADERS = {
  row: {
    label: 'Header row',
    className: /\benable-header-row\b/,
    trigger: '.simple-table-row-trigger-container .simple-table-action-btn',
    cells: 'tr:first-child > td[data-block-type="simple_table_cell"]',
  },
  column: {
    label: 'Header column',
    className: /\benable-header-column\b/,
    trigger: '.simple-table-col-trigger-container .simple-table-action-btn',
    cells: 'tr > td[data-block-type="simple_table_cell"]:first-child',
  },
} as const;

function header(axis: string) {
  if (axis !== 'row' && axis !== 'column') throw new Error(`Unknown simple table axis: ${axis}`);
  return HEADERS[axis];
}

function enabled(state: string) {
  if (state !== 'enabled' && state !== 'disabled') throw new Error(`Unknown simple table header state: ${state}`);
  return state === 'enabled';
}

function table(page: Page) {
  return page.locator('.simple-table').first();
}

function cell(page: Page, rowIndex: number, columnIndex: number) {
  return table(page).locator(`td[data-row-index="${rowIndex}"][data-cell-index="${columnIndex}"]`);
}

function menu(page: Page) {
  return page.locator('.simple-table-context-menu:visible');
}

function headerSwitch(page: Page, axis: string) {
  return menu(page).getByRole('switch', { name: header(axis).label, exact: true });
}

async function themeHeaderFill(page: Page) {
  return page.evaluate(() => {
    if (document.documentElement.dataset.darkMode === 'true') return 'rgba(255, 255, 255, 0.03)';
    const style = document.createElement('span').style;

    style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--fill-content-hover').trim();
    return style.backgroundColor;
  });
}

Given('a blank simple table test document is open', async ({ page, request }) => {
  // A single-seat local server can opt into an existing account; CI keeps isolated users.
  const email = process.env.APPFLOWY_E2E_SIMPLE_TABLE_EMAIL || generateRandomEmail();

  await signInAndWaitForApp(page, request, email);
  await createDocumentPageAndNavigate(page);
  const editor = EditorSelectors.slateEditor(page);

  await expect(editor).toBeVisible();
  await editor.click();
});

Given('the simple table uses the {string} theme', async ({ page }, theme: string) => {
  if (theme !== 'light' && theme !== 'dark') throw new Error(`Unknown simple table theme: ${theme}`);
  await page.emulateMedia({ colorScheme: theme });
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', String(theme === 'dark'));
});

When('I open the simple table {string} menu for index {int}', async ({ page }, axis: string, index: number) => {
  const settings = header(axis);
  const targetCell = cell(page, axis === 'row' ? index : 0, axis === 'column' ? index : 0);

  await expect(targetCell).toBeVisible();
  await targetCell.hover();
  const trigger = table(page).locator(settings.trigger);

  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).toHaveCSS('opacity', '1');
});

When('I enable the simple table {string} header switch', async ({ page }, axis: string) => {
  await headerSwitch(page, axis).check();
});

When('I click the simple table {string} header label', async ({ page }, axis: string) => {
  await menu(page).getByText(header(axis).label, { exact: true }).click();
});

When('I toggle the simple table {string} header with Space', async ({ page }, axis: string) => {
  const control = headerSwitch(page, axis);

  await control.focus();
  await control.press('Space');
});

When('I close the simple table menu', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(table(page).locator('.simple-table-menu-selection:visible')).toHaveCount(0);
});

When('I reload the document containing the simple table', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(table(page)).toBeVisible();
});

Then('the simple table {string} header switch is {string}', async ({ page }, axis: string, state: string) => {
  const control = headerSwitch(page, axis);

  await expect(control).toBeVisible();
  await expect(control).toBeChecked({ checked: enabled(state) });
});

Then('the simple table {string} header is {string}', async ({ page }, axis: string, state: string) => {
  if (enabled(state)) {
    await expect(table(page)).toHaveClass(header(axis).className);
  } else {
    await expect(table(page)).not.toHaveClass(header(axis).className);
  }
});

Then('the simple table {string} header cells use the theme header fill', async ({ page }, axis: string) => {
  const cells = table(page).locator(header(axis).cells);
  const count = await cells.count();
  const backgroundColor = await themeHeaderFill(page);

  expect(count).toBeGreaterThan(1);
  expect(backgroundColor).not.toBe('');
  await expect
    .poll(() => cells.evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);

      return { backgroundColor: style.backgroundColor, fontWeight: style.fontWeight };
    })))
    .toEqual(Array.from({ length: count }, () => ({ backgroundColor, fontWeight: '600' })));
});

Then('simple table cell {int}, {int} has the default background', async ({ page }, rowIndex: number, columnIndex: number) => {
  await expect(cell(page, rowIndex, columnIndex)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

Then('the simple table cells have no header styling', async ({ page }) => {
  await expect(table(page)).not.toHaveClass(HEADERS.row.className);
  await expect(table(page)).not.toHaveClass(HEADERS.column.className);
  const cells = table(page).locator('td[data-block-type="simple_table_cell"]');
  const count = await cells.count();

  expect(count).toBeGreaterThan(1);
  await expect
    .poll(() => cells.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor)))
    .toEqual(Array.from({ length: count }, () => 'rgba(0, 0, 0, 0)'));
});

Then('the simple table menu has no header switch', async ({ page }) => {
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('switch')).toHaveCount(0);
  await expect(menu(page).getByText(/^Header (row|column)$/)).toHaveCount(0);
});

Then('the simple table menu still offers Color and Align', async ({ page }) => {
  await expect(menu(page).getByRole('button', { name: 'Color', exact: true })).toBeVisible();
  await expect(menu(page).getByRole('button', { name: 'Align', exact: true })).toBeVisible();
});

Then('the simple table {string} menu selection has the design blue border', async ({ page, $testInfo }, axis: string) => {
  const settings = header(axis);
  const selection = table(page).locator(`.simple-table-menu-selection.${axis}`);

  await expect(selection).toBeVisible();
  await expect(selection).toHaveCSS('border-top-width', '2px');
  await expect(selection).toHaveCSS('border-right-width', '2px');
  await expect(selection).toHaveCSS('border-bottom-width', '2px');
  await expect(selection).toHaveCSS('border-left-width', '2px');
  await expect(selection).toHaveCSS('border-color', 'rgb(0, 188, 240)');
  await expect(selection).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(table(page).locator(settings.trigger)).toHaveCSS('border-color', 'rgb(0, 188, 240)');
  await expect(table(page).locator('.simple-table-menu-selection:visible')).toHaveCount(1);
  const box = await selection.boundingBox();
  const gridBox = await table(page).locator('table').boundingBox();

  expect(box).not.toBeNull();
  expect(gridBox).not.toBeNull();
  if (!box || !gridBox) throw new Error('The table selection has no bounds');
  expect(axis === 'row' ? box.width : box.height).toBeCloseTo(axis === 'row' ? gridBox.width : gridBox.height, 0);

  const icons = menu(page).locator('.simple-table-menu-icon');

  expect(await icons.count()).toBeGreaterThan(5);
  for (const icon of await icons.all()) {
    if (await icon.locator('img').count()) {
      await expect(icon.locator('img')).toHaveJSProperty('naturalWidth', 16);
      expect(await icon.locator('img').evaluate((element) => getComputedStyle(element).filter)).not.toBe('none');
    } else {
      expect(await icon.evaluate((element) => getComputedStyle(element).maskImage)).not.toBe('none');
    }
  }

  await $testInfo.attach(`${axis}-menu`, { body: await page.screenshot(), contentType: 'image/png' });
});
