import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4 } from 'uuid';

import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { BoardSelectors, DatabaseGridSelectors, DatabaseViewSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then } = createBdd();

const cardNamesByPage = new WeakMap<Page, string>();

Given('a board database with a card is open', async ({ page, request }) => {
  const currentCardName = `ImageLink-${uuidv4().slice(0, 6)}`;

  cardNamesByPage.set(page, currentCardName);

  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Board', {
    createWaitMs: 7000,
    verify: async (p) => {
      await expect(BoardSelectors.boardContainer(p)).toBeVisible({ timeout: 15000 });
      await expect(BoardSelectors.cards(p).first()).toBeVisible({ timeout: 15000 });
    },
  });

  await addNewCard(page, currentCardName);
  await expect(cardByName(page, currentCardName)).toBeVisible({ timeout: 15000 });
});

When('I add image link {string} to the card row page', async ({ page }, imageUrl: string) => {
  const currentCardName = getCurrentCardName(page);

  await cardByName(page, currentCardName).click({ force: true });
  await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15000 });

  await focusRowDocumentEditor(page);
  await page.keyboard.type('/image', { delay: 30 });

  const imageCommand = page.getByTestId('slash-menu-image');

  await expect(imageCommand).toBeVisible({ timeout: 10000 });
  await imageCommand.click({ force: true });

  const popover = page.locator('.MuiPopover-root:visible').last();

  await expect(popover).toBeVisible({ timeout: 10000 });
  await popover.getByText('Embed link', { exact: true }).click({ force: true });

  const input = popover.getByPlaceholder('Paste or type an image link');

  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(imageUrl);
  await input.press('Enter');
  await expect(popover).toBeHidden({ timeout: 10000 });
});

When('I close the card row page', async ({ page }) => {
  await closeRowDetailWithEscape(page);
  await page.waitForTimeout(2000);
});

When('I switch the database to a new Grid view', async ({ page }) => {
  await DatabaseViewSelectors.addViewButton(page).click({ force: true });
  await DatabaseViewSelectors.viewTypeOption(page, 'Grid').click({ force: true });
  await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toBeVisible({ timeout: 15000 });
  await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toHaveAttribute('data-state', 'active', {
    timeout: 15000,
  });
  await waitForGridReady(page);
});

Then('the card primary cell shows a row document icon', async ({ page }) => {
  const currentCardName = getCurrentCardName(page);

  await expect(cardByName(page, currentCardName).locator('.custom-icon')).toBeVisible({ timeout: 15000 });
});

Then('the grid primary cell shows a row document icon', async ({ page }) => {
  const currentCardName = getCurrentCardName(page);
  const row = DatabaseGridSelectors.dataRows(page).filter({ hasText: currentCardName }).first();

  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.locator('.custom-icon')).toBeVisible({ timeout: 15000 });
});

async function addNewCard(page: Page, cardName: string) {
  const todoColumn = BoardSelectors.boardContainer(page)
    .locator('[data-column-id]')
    .filter({ hasText: 'To Do' });

  await todoColumn.getByText('New').click({ force: true });
  await page.waitForTimeout(500);
  await page.keyboard.type(cardName, { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
}

async function focusRowDocumentEditor(page: Page) {
  const dialog = page.locator('[role="dialog"]');
  const scrollContainer = dialog.locator('.appflowy-scroll-container');

  if ((await scrollContainer.count()) > 0) {
    await scrollContainer.evaluate((el) => el.scrollTo(0, 9999));
    await page.waitForTimeout(500);
  }

  const editor = dialog.locator('[data-testid="editor-content"], [role="textbox"][contenteditable="true"]').first();

  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click({ force: true });
}

function cardByName(page: Page, cardName: string) {
  return BoardSelectors.boardContainer(page).locator('.board-card').filter({ hasText: cardName }).first();
}

function getCurrentCardName(page: Page) {
  const cardName = cardNamesByPage.get(page);

  if (!cardName) {
    throw new Error('No current card name is available for this scenario');
  }

  return cardName;
}
