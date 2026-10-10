import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { RowDetailSelectors } from '../../support/selectors';
import { activeSidePeekPage, peekDocument, peekPropertyValue, peekTitle } from '../../support/side-peek-helpers';

const { Then, When } = createBdd();

// Lock scenarios build on the shared side peek steps (side-peek.steps.ts):
// the document fixture, lock/unlock from the header, the read-only/editable
// peek checks and the edit steps. This file adds the locked-row probes.

/**
 * Click a locked surface and type into it. A locked row swallows the keys,
 * so the steps that follow assert the content is unchanged.
 */
async function attemptTyping(page: Page, target: Locator, text: string): Promise<void> {
  await expect(target).toBeVisible({ timeout: 15_000 });
  await target.click();
  await page.keyboard.type(text);
}

/** A full row page (?r=) renders the row outside the peek, so it is not scoped to it. */
function fullRowPageDocument(page: Page): Locator {
  return page.getByTestId('editor-content').first();
}

When('I try to type {string} into the peek title', async ({ page }, text: string) => {
  const active = activeSidePeekPage(page);

  await attemptTyping(active, peekTitle(active), text);
});

When('I try to type {string} into the peek document', async ({ page }, text: string) => {
  const active = activeSidePeekPage(page);

  await attemptTyping(active, peekDocument(active), text);
});

When('I try to type {string} into the {string} property in the peek', async ({ page }, text: string, name: string) => {
  const active = activeSidePeekPage(page);

  await attemptTyping(active, peekPropertyValue(active, name), text);
});

Then('the {string} property in the peek does not contain {string}', async ({ page }, name: string, text: string) => {
  await expect(peekPropertyValue(activeSidePeekPage(page), name)).not.toContainText(text, { timeout: 15_000 });
});

Then('the full row page is read-only', async ({ page }) => {
  const active = activeSidePeekPage(page);
  const title = RowDetailSelectors.titleInput(active);

  await expect(title).toBeVisible({ timeout: 15_000 });
  // A read-only title renders as a heading: no editable element.
  await expect(title).not.toHaveAttribute('contenteditable', 'true');
  await expect(title.locator('[contenteditable="true"], textarea, input')).toHaveCount(0);
  await expect(fullRowPageDocument(active)).toHaveAttribute('contenteditable', 'false', { timeout: 15_000 });
  await expect(RowDetailSelectors.moreActionsButton(active)).toHaveCount(0);
});

/** The source database page is not locked, so its row page keeps its editors. */
Then('the full row page is editable', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await expect(RowDetailSelectors.titleInput(active)).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
  await expect(fullRowPageDocument(active)).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
});

Then('the full row page document contains {string}', async ({ page }, text: string) => {
  await expect(fullRowPageDocument(activeSidePeekPage(page))).toContainText(text, { timeout: 15_000 });
});
