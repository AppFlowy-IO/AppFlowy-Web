import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { waitForDatabaseTestContext } from '../../support/relation-test-helpers';
import { BoardSelectors } from '../../support/selectors';

const { When, Then } = createBdd();

const BOARD_GROUP_ROW_PREFIX = 'board-group-visibility-';

const boardGroupSettingsMenu = (page: Page) => page.getByTestId('board-group-settings-menu');
const boardGroupByMenu = (page: Page) => page.getByTestId('board-group-by-menu');
// The eye icons and option tags share the row prefix; only rows carry the checkbox role.
const boardGroupRows = (page: Page) =>
  boardGroupSettingsMenu(page).locator(`[data-testid^="${BOARD_GROUP_ROW_PREFIX}"][role="menuitemcheckbox"]`);
const boardGroupRowByName = (page: Page, name: string) =>
  boardGroupRows(page).filter({ has: page.getByText(name, { exact: true }) });

async function ensureBoardGroupSettingsOpen(page: Page) {
  const menu = boardGroupSettingsMenu(page);

  if (await menu.isVisible()) return menu;

  const trigger = page.getByTestId('board-group-settings-trigger');

  if (!(await trigger.isVisible())) {
    await BoardSelectors.settingsButton(page).click();
    await expect(trigger).toBeVisible();
  }

  await trigger.click();
  await expect(menu).toBeVisible();

  return menu;
}

async function closeBoardGroupSettings(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(boardGroupSettingsMenu(page)).toHaveCount(0);
  await expect(
    page.locator('[data-slot="dropdown-menu-content"]:visible, [data-slot="dropdown-menu-sub-content"]:visible')
  ).toHaveCount(0);
}

async function openBoardGroupByMenu(page: Page) {
  await ensureBoardGroupSettingsOpen(page);
  const groupByMenu = boardGroupByMenu(page);

  if (!(await groupByMenu.isVisible())) {
    await page.getByTestId('board-group-by-trigger').click();
  }

  await expect(groupByMenu).toBeVisible();

  return groupByMenu;
}

/** Desktop _GroupVisibilityRow: one eye icon per row, mirrored by aria-checked, and no switch. */
async function expectBoardGroupEye(page: Page, name: string, shown: boolean) {
  await ensureBoardGroupSettingsOpen(page);
  const row = boardGroupRowByName(page, name);

  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-checked', String(shown));
  await expect(row.locator(`[data-testid^="${BOARD_GROUP_ROW_PREFIX}shown-"]`)).toHaveCount(shown ? 1 : 0);
  await expect(row.locator(`[data-testid^="${BOARD_GROUP_ROW_PREFIX}hidden-"]`)).toHaveCount(shown ? 0 : 1);
  await expect(row.locator('[role="switch"]')).toHaveCount(0);
}

async function boardGroupColumnId(page: Page, name: string) {
  await ensureBoardGroupSettingsOpen(page);
  const row = boardGroupRowByName(page, name);

  await expect(row).toHaveCount(1);
  const testId = await row.getAttribute('data-testid');
  const columnId = testId?.slice(BOARD_GROUP_ROW_PREFIX.length) ?? '';

  if (!columnId) throw new Error(`Could not resolve the column id of Board group "${name}"`);
  await closeBoardGroupSettings(page);

  return columnId;
}

/** `layout_settings["1"].shown_empty_group_ids` of the active view, as the Board page reads it. */
async function readShownEmptyGroupIds(page: Page): Promise<string[]> {
  await waitForDatabaseTestContext(page);

  return page.evaluate(() => {
    type YMapLike = { get: (key: string) => unknown };
    type YArrayLike = { toArray: () => unknown[] };
    const bridge = window as unknown as {
      __TEST_DATABASE_CONTEXT__?: { databaseDoc: { getMap: (name: string) => YMapLike }; activeViewId: string };
    };
    const ctx = bridge.__TEST_DATABASE_CONTEXT__;

    if (!ctx) return [];

    const read = (node: unknown, key: string): unknown =>
      node && typeof (node as YMapLike).get === 'function' ? (node as YMapLike).get(key) : undefined;
    const view = read(read(read(ctx.databaseDoc.getMap('data'), 'database'), 'views'), ctx.activeViewId);
    const stored = read(read(read(view, 'layout_settings'), '1'), 'shown_empty_group_ids');
    const ids = Array.isArray(stored)
      ? stored
      : stored && typeof (stored as YArrayLike).toArray === 'function'
        ? (stored as YArrayLike).toArray()
        : [];

    return ids.filter((id): id is string => typeof id === 'string');
  });
}

Then('the Board Group entry shows {string} as the current field', async ({ page }, fieldName: string) => {
  const trigger = page.getByTestId('board-group-settings-trigger');

  if (!(await trigger.isVisible())) {
    await BoardSelectors.settingsButton(page).click();
  }

  await expect(trigger).toBeVisible();
  await expect(trigger.getByTestId('board-group-settings-field')).toHaveText(fieldName);
});

Then('the Board Group by submenu ticks {string}', async ({ page }, fieldName: string) => {
  await ensureBoardGroupSettingsOpen(page);
  await expect(page.getByTestId('board-group-by-current-field')).toHaveText(fieldName);

  const groupByMenu = await openBoardGroupByMenu(page);
  const selectedField = groupByMenu.getByTestId('board-group-by-field').filter({
    has: page.getByTestId('board-group-by-field-name').getByText(fieldName, { exact: true }),
  });

  await expect(selectedField).toHaveCount(1);
  await expect(selectedField.getByTestId('board-group-by-field-selected')).toHaveCount(1);
  await expect(groupByMenu.getByTestId('board-group-by-field-selected')).toHaveCount(1);
  await expect(groupByMenu.getByTestId('board-group-by-none')).toHaveCount(0);
});

Then('the Board Groups list has no bulk visibility actions', async ({ page }) => {
  const menu = await ensureBoardGroupSettingsOpen(page);

  await expect(menu.getByTestId('board-show-all-groups')).toHaveCount(0);
  await expect(menu.getByTestId('board-hide-all-groups')).toHaveCount(0);
  await expect(menu.locator('[data-testid^="board-group-visibility-switch-"]')).toHaveCount(0);
  await expect(menu.getByText('Show ungrouped items')).toHaveCount(0);
  await expect(boardGroupRows(page).first()).toBeVisible();
  await expect(boardGroupRows(page).locator('[role="switch"]')).toHaveCount(0);
});

Then('the Board Groups list offers exactly {string}', async ({ page }, names: string) => {
  const expected = names.split(',').map((name) => name.trim());

  await ensureBoardGroupSettingsOpen(page);
  await expect(boardGroupRows(page)).toHaveCount(expected.length);
  for (const name of expected) {
    await expect(boardGroupRowByName(page, name)).toHaveCount(1);
  }
});

Then('the Board Groups list shows {string} as {word}', async ({ page }, name: string, state: string) => {
  expect(['shown', 'hidden']).toContain(state);
  await expectBoardGroupEye(page, name, state === 'shown');
});

When('I toggle the Board Groups row {string}', async ({ page }, name: string) => {
  await ensureBoardGroupSettingsOpen(page);
  const row = boardGroupRowByName(page, name);

  await expect(row).toHaveCount(1);
  const wasShown = (await row.getAttribute('aria-checked')) === 'true';

  await row.click();
  // Desktop keeps the menu open and the eye follows the rendered column set.
  await expectBoardGroupEye(page, name, !wasShown);
  await closeBoardGroupSettings(page);
});

When('I hide the {string} Board column from its column menu', async ({ page }, groupName: string) => {
  const column = BoardSelectors.columnByName(page, groupName);

  await expect(column).toHaveCount(1);
  await expect(column).toBeVisible();
  // The header's first button opens the column menu; the second adds a card.
  await column.locator('.column-header button:not([data-testid="board-add-card"])').first().click();

  const menu = page.locator('[data-slot="popover-content"]:visible');

  await expect(menu).toBeVisible();
  await menu.getByText('Hide', { exact: true }).click();
  await expect(column).toHaveCount(0);
});

Then('the Board shows the column named {string}', async ({ page }, groupName: string) => {
  const column = BoardSelectors.columnByName(page, groupName);

  await expect(column).toHaveCount(1);
  await expect(column).toBeVisible();
});

Then(
  'the Board layout setting lists {string} among its shown empty groups',
  async ({ page }, groupName: string) => {
    const columnId = await boardGroupColumnId(page, groupName);

    await expect.poll(() => readShownEmptyGroupIds(page), { timeout: 10_000 }).toContain(columnId);
  }
);

Then(
  'the Board layout setting does not list {string} among its shown empty groups',
  async ({ page }, groupName: string) => {
    const columnId = await boardGroupColumnId(page, groupName);

    await expect.poll(() => readShownEmptyGroupIds(page), { timeout: 10_000 }).not.toContain(columnId);
  }
);
