import { BrowserContext, expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { BoardSelectors, DatabaseViewSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();

type BoardHiddenGroupsState = {
  secondContext?: BrowserContext;
  secondPage?: Page;
};

const stateByPage = new WeakMap<Page, BoardHiddenGroupsState>();

After(async ({ page }) => {
  const state = stateByPage.get(page);

  if (state?.secondPage && !state.secondPage.isClosed()) {
    await state.secondPage.evaluate(() => {
      const watchedWindow = window as typeof window & {
        __boardVisibilityWatches?: Record<string, { observer: MutationObserver }>;
      };

      Object.values(watchedWindow.__boardVisibilityWatches ?? {}).forEach(({ observer }) => observer.disconnect());
      delete watchedWindow.__boardVisibilityWatches;
    });
  }
  await state?.secondContext?.close();
  stateByPage.delete(page);
});

Given('a Board database is open for group behavior testing', async ({ page, request }) => {
  setupPageErrorHandling(page);
  stateByPage.set(page, {});

  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Board', {
    createWaitMs: 7000,
    verify: async (currentPage) => {
      await expect(BoardSelectors.boardContainer(currentPage)).toHaveCount(1);
      await expect(BoardSelectors.boardContainer(currentPage)).toBeVisible({ timeout: 15000 });
      await expect(BoardSelectors.mainColumns(currentPage)).toHaveCount(1);
      await expect(BoardSelectors.mainColumns(currentPage)).toBeVisible({ timeout: 15000 });
      await expect.poll(() => BoardSelectors.cards(currentPage).count(), { timeout: 15000 }).toBeGreaterThan(0);
    },
  });
});

Given('another web client opens the same Board database', async ({ page, browser }) => {
  const state = stateByPage.get(page) ?? {};
  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState({ indexedDB: true }),
    viewport: { width: 1440, height: 900 },
  });
  const secondPage = await secondContext.newPage();

  state.secondContext = secondContext;
  state.secondPage = secondPage;
  stateByPage.set(page, state);
  setupPageErrorHandling(secondPage);

  await secondPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(BoardSelectors.boardContainer(secondPage)).toHaveCount(1, { timeout: 30000 });
  await expect(BoardSelectors.boardContainer(secondPage)).toBeVisible({ timeout: 30000 });
  await expect(BoardSelectors.mainColumns(secondPage)).toHaveCount(1, { timeout: 30000 });
  await expect(BoardSelectors.mainColumns(secondPage)).toBeVisible({ timeout: 30000 });

  const toggle = BoardSelectors.hiddenGroupsToggle(secondPage);

  await expect(toggle).toHaveCount(1, { timeout: 30000 });
  await expect(toggle).toBeVisible({ timeout: 30000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

Given('an empty Board group named {string} exists', async ({ page }, groupName: string) => {
  const addGroupButton = BoardSelectors.addGroupButton(page);

  await expect(addGroupButton).toHaveCount(1);
  await expect(addGroupButton).toBeVisible();
  await addGroupButton.click();

  const input = BoardSelectors.addGroupInput(page);
  const submit = BoardSelectors.addGroupSubmit(page);

  await expect(input).toHaveCount(1);
  await expect(input).toBeVisible();
  await expect(submit).toHaveCount(1);
  await expect(submit).toBeVisible();
  await input.fill(groupName);
  await input.press('Enter');
  await expect(input).toHaveCount(0);

  await expectExactEmptyBoardColumn(page, groupName);
});

When('I enable Hide empty groups for the Board', async ({ page }) => {
  const { toggleRow, toggleSwitch } = await openBoardGroupSettings(page);

  await expect(toggleRow).toHaveCount(1);
  await expect(toggleRow).toBeVisible();
  await expect(toggleSwitch).toHaveCount(1);
  await expect(toggleSwitch).toBeVisible();
  await expect(toggleSwitch).not.toBeChecked();
  await toggleRow.click();
  await expect(toggleSwitch).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const reopenedSettings = await openBoardGroupSettings(page);

  await expect(reopenedSettings.toggleSwitch).toHaveCount(1);
  await expect(reopenedSettings.toggleSwitch).toBeVisible();
  await expect(reopenedSettings.toggleSwitch).toBeChecked();

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

Then('Hide empty groups remains enabled for the Board', async ({ page }) => {
  const { menu, toggleRow, toggleSwitch } = await openBoardGroupSettings(page);

  await expect(menu).toHaveCount(1);
  await expect(menu).toBeVisible();
  await expect(toggleRow).toHaveCount(1);
  await expect(toggleRow).toBeVisible();
  await expect(toggleSwitch).toHaveCount(1);
  await expect(toggleSwitch).toBeVisible();
  await expect(toggleSwitch).toBeChecked();

  await closeBoardGroupSettings(page);
});

When('I expand the Board Hidden Groups section', async ({ page }) => {
  const toggle = BoardSelectors.hiddenGroupsToggle(page);

  await expect(toggle).toHaveCount(1);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

Then('the Board has no visible column named {string}', async ({ page }, groupName: string) => {
  await expect(BoardSelectors.columnByName(page, groupName)).toHaveCount(0);
});

Then('Hidden Groups has exactly one {string} row with only a show action', async ({ page }, groupName: string) => {
  await expectExactHiddenGroupAction(page, groupName, 'show');
});

When('I click the show action for hidden Board group {string}', async ({ page }, groupName: string) => {
  await clickExactHiddenGroupAction(page, groupName, 'show');
});

Then('the Board has exactly one visible empty column named {string}', async ({ page }, groupName: string) => {
  await expectExactEmptyBoardColumn(page, groupName);
});

Then('Hidden Groups has exactly one {string} row with only a hide action', async ({ page }, groupName: string) => {
  await expectExactHiddenGroupAction(page, groupName, 'hide');
});

When('I click the hide action for shown Board group {string}', async ({ page }, groupName: string) => {
  await clickExactHiddenGroupAction(page, groupName, 'hide');
});

Then('the other web client has no visible column named {string}', async ({ page }, groupName: string) => {
  await expect(BoardSelectors.columnByName(requireSecondPage(page), groupName)).toHaveCount(0, { timeout: 30000 });
});

Then('the other web client has exactly one visible empty column named {string}', async ({ page }, groupName: string) => {
  await expectExactEmptyBoardColumn(requireSecondPage(page), groupName, 30000);
});

Then(
  "the other web client's Hidden Groups has exactly one {string} row with only a show action",
  async ({ page }, groupName: string) => {
    await expectExactHiddenGroupAction(requireSecondPage(page), groupName, 'show', 30000);
  }
);

Then(
  "the other web client's Hidden Groups has exactly one {string} row with only a hide action",
  async ({ page }, groupName: string) => {
    await expectExactHiddenGroupAction(requireSecondPage(page), groupName, 'hide', 30000);
  }
);

When('I open Board Group settings', async ({ page }) => {
  const { menu } = await openBoardGroupSettings(page);

  await expect(menu).toHaveCount(1);
  await expect(menu).toBeVisible();
});

Then('Board Group settings expose no ungrouping action', async ({ page }) => {
  const menu = boardGroupSettingsMenu(page);

  await expect(menu).toHaveCount(1);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'None', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Delete grouping', exact: true })).toHaveCount(0);
});

Then('Board Group settings show exactly one selected field named {string}', async ({ page }, fieldName: string) => {
  const menu = boardGroupSettingsMenu(page);
  const fieldRows = menu.getByTestId('board-group-by-field');
  const selectedField = fieldRows.filter({
    has: page.getByTestId('board-group-by-field-name').getByText(fieldName, { exact: true }),
  });

  await expect(menu).toHaveCount(1);
  await expect(menu).toBeVisible();
  await expect(selectedField).toHaveCount(1);
  await expect(selectedField).toBeVisible();
  await expect(selectedField.getByTestId('board-group-by-field-selected')).toHaveCount(1);
  await expect(menu.getByTestId('board-group-by-field-selected')).toHaveCount(1);
});

When('I close Board Group settings', async ({ page }) => {
  await closeBoardGroupSettings(page);
});

When('I add another Board view from the database tab bar', async ({ page }) => {
  const viewTabs = DatabaseViewSelectors.viewTab(page);
  const previousTabCount = await viewTabs.count();
  const previousActiveTabId = await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid');
  const addViewButton = DatabaseViewSelectors.addViewButton(page);

  await expect(addViewButton).toHaveCount(1);
  await expect(addViewButton).toBeVisible();
  await addViewButton.click();

  const menu = page.locator('[data-slot="dropdown-menu-content"]:visible');
  const boardOption = menu.getByRole('menuitem', { name: 'Board', exact: true });

  await expect(menu).toHaveCount(1);
  await expect(menu).toBeVisible();
  await expect(boardOption).toHaveCount(1);
  await expect(boardOption).toBeVisible();
  await boardOption.click();

  await expect(viewTabs).toHaveCount(previousTabCount + 1);
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveCount(1);
  await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Board');
  await expect(DatabaseViewSelectors.activeViewTab(page)).not.toHaveAttribute('data-testid', previousActiveTabId ?? '');
  await expect(BoardSelectors.boardContainer(page)).toHaveCount(1);
  await expect(BoardSelectors.boardContainer(page)).toBeVisible();
  await expect(BoardSelectors.mainColumns(page)).toHaveCount(1);
  await expect(BoardSelectors.mainColumns(page)).toBeVisible();
});

When(
  'I add a Board card named {string} to the {string} column',
  async ({ page }, cardName: string, groupName: string) => {
    const column = BoardSelectors.columnByName(page, groupName);

    await expect(column).toHaveCount(1);
    await expect(column).toBeVisible();
    await column.getByText('New', { exact: true }).click();
    await page.keyboard.type(cardName);
    await page.keyboard.press('Enter');
    await expect(column.locator('.board-card').filter({ hasText: cardName })).toHaveCount(1, { timeout: 15_000 });
  }
);

Then(
  'the other web client has exactly one {string} card in the {string} column',
  async ({ page }, cardName: string, groupName: string) => {
    const column = BoardSelectors.columnByName(requireSecondPage(page), groupName);

    await expect(column).toHaveCount(1, { timeout: 30_000 });
    await expect(column).toBeVisible({ timeout: 30_000 });
    await expect(column.locator('.board-card').filter({ hasText: cardName })).toHaveCount(1, { timeout: 30_000 });
  }
);

When(
  'the other web client starts watching Board group {string} for visibility flicker',
  async ({ page }, groupName: string) => {
    const secondPage = requireSecondPage(page);

    await expect(BoardSelectors.columnByName(secondPage, groupName)).toHaveCount(0);
    await secondPage.evaluate((watchedGroupName) => {
      const watchedWindow = window as typeof window & {
        __boardVisibilityWatches?: Record<string, { everVisible: boolean; observer: MutationObserver }>;
      };
      const isVisible = () =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="board-column"]')].some((column) => {
          const name = column.querySelector<HTMLElement>('[data-testid="board-column-name"]');

          return name?.textContent?.trim() === watchedGroupName && column.getClientRects().length > 0;
        });
      const containsWatchedColumn = (node: Node) => {
        if (!(node instanceof Element)) return false;
        const columns = [
          ...(node.matches('[data-testid="board-column"]') ? [node] : []),
          ...node.querySelectorAll('[data-testid="board-column"]'),
        ];

        return columns.some(
          (column) =>
            column.querySelector<HTMLElement>('[data-testid="board-column-name"]')?.textContent?.trim() ===
            watchedGroupName
        );
      };
      const watch = {
        everVisible: false,
        observer: new MutationObserver((records) => {
          const added = records.some((record) => [...record.addedNodes].some(containsWatchedColumn));

          watch.everVisible ||= added || isVisible();
        }),
      };

      watch.everVisible = isVisible();
      watch.observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
        childList: true,
        subtree: true,
      });
      watchedWindow.__boardVisibilityWatches ??= {};
      watchedWindow.__boardVisibilityWatches[watchedGroupName] = watch;
    }, groupName);
  }
);

Then('Board group {string} never became visible on the other web client', async ({ page }, groupName: string) => {
  const everVisible = await requireSecondPage(page).evaluate((watchedGroupName) => {
    const watchedWindow = window as typeof window & {
      __boardVisibilityWatches?: Record<string, { everVisible: boolean }>;
    };

    return watchedWindow.__boardVisibilityWatches?.[watchedGroupName]?.everVisible;
  }, groupName);

  expect(everVisible, `Board group "${groupName}" became visible during remote row hydration`).toBe(false);
});

async function expectExactEmptyBoardColumn(page: Page, groupName: string, timeout = 5000) {
  const column = BoardSelectors.columnByName(page, groupName);

  await expect(column).toHaveCount(1, { timeout });
  await expect(column).toBeVisible({ timeout });
  await expect(column.getByTestId('board-column-name').getByText(groupName, { exact: true })).toHaveCount(1, {
    timeout,
  });
  await expect(column.locator('.board-card')).toHaveCount(0, { timeout });
}

async function expectExactHiddenGroupAction(page: Page, groupName: string, action: 'show' | 'hide', timeout = 5000) {
  const row = BoardSelectors.hiddenGroupByName(page, groupName);
  const expectedAction = hiddenGroupAction(row, action);
  const oppositeAction = hiddenGroupAction(row, action === 'show' ? 'hide' : 'show');

  await expect(row).toHaveCount(1, { timeout });
  await expect(row).toBeVisible({ timeout });
  await expect(row.getByTestId('board-hidden-group-name').getByText(groupName, { exact: true })).toHaveCount(1, {
    timeout,
  });
  await row.hover();
  await expect(expectedAction).toHaveCount(1, { timeout });
  await expect(expectedAction).toBeVisible({ timeout });
  await expect(oppositeAction).toHaveCount(0, { timeout });
}

async function clickExactHiddenGroupAction(page: Page, groupName: string, action: 'show' | 'hide') {
  const row = BoardSelectors.hiddenGroupByName(page, groupName);

  await expectExactHiddenGroupAction(page, groupName, action);
  await hiddenGroupAction(row, action).click();
}

function hiddenGroupAction(row: Locator, action: 'show' | 'hide') {
  return row.getByTestId(`board-hidden-group-${action}`);
}

function requireSecondPage(page: Page) {
  const secondPage = stateByPage.get(page)?.secondPage;

  if (!secondPage) {
    throw new Error('Expected another web client to have opened the Board database');
  }

  return secondPage;
}

async function openBoardGroupSettings(page: Page) {
  const settingsButton = BoardSelectors.settingsButton(page);

  await expect(settingsButton).toHaveCount(1);
  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const groupSettingsTrigger = page.getByTestId('board-group-settings-trigger');

  await expect(groupSettingsTrigger).toHaveCount(1);
  await expect(groupSettingsTrigger).toBeVisible();
  await groupSettingsTrigger.click();

  return {
    menu: boardGroupSettingsMenu(page),
    toggleRow: page.getByTestId('board-hide-empty-groups-toggle'),
    toggleSwitch: page.getByTestId('board-hide-empty-groups-switch'),
  };
}

async function closeBoardGroupSettings(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(boardGroupSettingsMenu(page)).toHaveCount(0);
}

function boardGroupSettingsMenu(page: Page) {
  return page.getByTestId('board-group-settings-menu');
}
