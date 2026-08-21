import { expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { expandSpaceByName } from '../../support/page-utils';
import {
  DropdownSelectors,
  HeaderSelectors,
  PageSelectors,
  SidebarSelectors,
  SpaceSelectors,
  ViewActionSelectors,
} from '../../support/selectors';
import { setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, Before } = createBdd();

const EVA_EMAIL = 'eva@appflowy.io';
const EVA_PASSWORD = 'AppFlowy!@123';
const EVA_PERMISSION_SPACE_NAME = 'Annie space';
const MENU_ACTIONS = {
  Rename: (page: Page) => ViewActionSelectors.renameButton(page),
  'Change icon': (page: Page) => ViewActionSelectors.changeIconButton(page),
  'Lock page': (page: Page) => page.getByTestId('more-page-lock'),
  Duplicate: (page: Page) => ViewActionSelectors.duplicateButton(page),
  'Move to': (page: Page) => ViewActionSelectors.moveToButton(page),
  'Find and replace': (page: Page) => page.getByTestId('more-page-find-and-replace'),
  Delete: (page: Page) => ViewActionSelectors.deleteButton(page),
  'Version history': (page: Page) => page.getByTestId('more-page-version-history'),
  'Open in a new tab': (page: Page) => ViewActionSelectors.openNewTabButton(page),
} satisfies Record<string, (page: Page) => Locator>;
const SPACE_MENU_ACTIONS = {
  'Manage Space': (page: Page) => page.getByTestId('space-action-manage'),
  'Duplicate Space': (page: Page) => page.getByTestId('space-action-duplicate'),
  'Create a new space': (page: Page) => page.getByTestId('create-new-space-button'),
  Delete: (page: Page) => page.getByTestId('space-action-delete'),
} satisfies Record<string, (page: Page) => Locator>;

type MenuActionLabel = keyof typeof MENU_ACTIONS;
type SpaceMenuActionLabel = keyof typeof SPACE_MENU_ACTIONS;

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

Given('the seeded Eva page action permission fixture exists', async () => {
  // This BDD suite intentionally reuses the local Eva/Annie permission fixture.
});

Given('I sign in as seeded Eva', async ({ page }) => {
  await signInWithPasswordViaUi(page, EVA_EMAIL, EVA_PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
  await expandSpaceByName(page, EVA_PERMISSION_SPACE_NAME);
});

When("I open Eva's sidebar more menu for {string}", async ({ page }, pageName: string) => {
  await openSidebarMoreMenuForPage(page, pageName);
});

When("I open Eva's space more menu for {string}", async ({ page }, spaceName: string) => {
  await openSpaceMoreMenu(page, spaceName);
});

When("I open Eva's page {string}", async ({ page }, pageName: string) => {
  await openPageFromSidebar(page, pageName);
});

When("I open Eva's page more menu", async ({ page }) => {
  await openPageMoreMenu(page);
});

When("I close Eva's sidebar more menu", async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(ViewActionSelectors.popover(page)).toHaveCount(0);
});

When("I close Eva's page more menu", async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(DropdownSelectors.content(page)).toHaveCount(0);
});

Then("Eva's sidebar more menu shows only {string}", async ({ page }, expectedActions: string) => {
  await expect(ViewActionSelectors.popover(page)).toBeVisible({ timeout: 15000 });
  await assertMoreMenuShowsOnly(page, ViewActionSelectors.popover(page), expectedActions);
});

Then("Eva's page more menu shows only {string}", async ({ page }, expectedActions: string) => {
  const menu = DropdownSelectors.content(page).last();

  await expect(menu).toBeVisible({ timeout: 15000 });
  await assertMoreMenuShowsOnly(page, menu, expectedActions);
});

Then("Eva's space more menu shows only {string}", async ({ page }, expectedActions: string) => {
  const expectedLabels = parseExpectedSpaceLabels(expectedActions);
  const popover = ViewActionSelectors.popover(page);

  await expect(popover).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('space-action-permission-loading')).toHaveCount(0, { timeout: 15000 });
  await expect(popover.locator('[role="menuitem"]:visible')).toHaveCount(expectedLabels.size);

  for (const [label, locatorForPage] of Object.entries(SPACE_MENU_ACTIONS) as [
    SpaceMenuActionLabel,
    (page: Page) => Locator,
  ][]) {
    const locator = locatorForPage(page);

    if (expectedLabels.has(label)) {
      await expect(locator).toBeVisible({ timeout: 15000 });
    } else {
      await expect(locator).toHaveCount(0);
    }
  }
});

async function assertMoreMenuShowsOnly(page: Page, popover: Locator, expectedActions: string): Promise<void> {
  const expectedLabels = parseExpectedLabels(expectedActions);

  await expect(page.getByTestId('more-actions-permission-loading')).toHaveCount(0, { timeout: 15000 });
  await expect(popover.locator('[role="menuitem"]:visible')).toHaveCount(expectedLabels.size);

  for (const [label, locatorForPage] of Object.entries(MENU_ACTIONS) as [
    MenuActionLabel,
    (page: Page) => Locator,
  ][]) {
    const locator = locatorForPage(page);

    if (expectedLabels.has(label)) {
      await expect(locator).toBeVisible({ timeout: 15000 });
    } else {
      await expect(locator).toHaveCount(0);
    }
  }
}

async function openSidebarMoreMenuForPage(page: Page, pageName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, pageName);

  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.scrollIntoViewIfNeeded();
  await pageItem.hover({ force: true });

  const moreActionsButton = pageItem.getByTestId('page-more-actions').first();

  await expect(moreActionsButton).toBeVisible({ timeout: 10000 });
  await moreActionsButton.click({ force: true });
  await expect(ViewActionSelectors.popover(page)).toBeVisible({ timeout: 15000 });
}

async function openSpaceMoreMenu(page: Page, spaceName: string): Promise<void> {
  const spaceItem = SpaceSelectors.itemByName(page, spaceName);

  await expect(spaceItem).toBeVisible({ timeout: 30000 });
  await spaceItem.scrollIntoViewIfNeeded();
  await spaceItem.hover({ force: true });

  const moreActionsButton = spaceItem.getByTestId('inline-more-actions').first();

  await expect(moreActionsButton).toBeVisible({ timeout: 10000 });
  await moreActionsButton.click({ force: true });
  await expect(ViewActionSelectors.popover(page)).toBeVisible({ timeout: 15000 });
}

async function openPageFromSidebar(page: Page, pageName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, pageName);

  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.scrollIntoViewIfNeeded();
  await pageItem.getByTestId('page-name').click({ force: true });
  await expect(page.locator('main').getByText(pageName, { exact: true }).first()).toBeVisible({ timeout: 30000 });
}

async function openPageMoreMenu(page: Page): Promise<void> {
  const moreActionsButton = HeaderSelectors.moreActionsButton(page);

  await expect(moreActionsButton).toBeVisible({ timeout: 15000 });
  await moreActionsButton.click({ force: true });
  await expect(DropdownSelectors.content(page).last()).toBeVisible({ timeout: 15000 });
}

function parseExpectedLabels(expectedActions: string): Set<MenuActionLabel> {
  const labels = expectedActions
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);

  for (const label of labels) {
    if (!isMenuActionLabel(label)) {
      throw new Error(`Unknown Eva more-action menu label: ${label}`);
    }
  }

  return new Set(labels);
}

function parseExpectedSpaceLabels(expectedActions: string): Set<SpaceMenuActionLabel> {
  const labels = expectedActions
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);

  for (const label of labels) {
    if (!isSpaceMenuActionLabel(label)) {
      throw new Error(`Unknown Eva space more-action menu label: ${label}`);
    }
  }

  return new Set(labels);
}

function isMenuActionLabel(label: string): label is MenuActionLabel {
  return label in MENU_ACTIONS;
}

function isSpaceMenuActionLabel(label: string): label is SpaceMenuActionLabel {
  return label in SPACE_MENU_ACTIONS;
}
