import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { BlockSelectors, EditorSelectors } from '../../support/selectors';

const { When, Then } = createBdd();

When('I type the following text in the editor:', async ({ page }, text: string) => {
  await EditorSelectors.slateEditor(page).focus();
  await page.keyboard.insertText(text);
});

Then('code block {int} contains exactly:', async ({ page }, blockIndex: number, text: string) => {
  const code = BlockSelectors.blockByType(page, 'code').nth(blockIndex).locator('code');

  // Compare literal text so whitespace normalization cannot hide lost indentation.
  await expect.poll(() => code.innerText()).toBe(text);
});
