import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4 } from 'uuid';

import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { BoardSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then } = createBdd();

let currentCardName = '';

Given('a board database with a card is open', async ({ page, request }) => {
  currentCardName = `ImageLink-${uuidv4().slice(0, 6)}`;

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

Then('the card primary cell shows a row document icon', async ({ page }) => {
  await expect(cardByName(page, currentCardName).locator('.custom-icon')).toBeVisible({ timeout: 15000 });
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
