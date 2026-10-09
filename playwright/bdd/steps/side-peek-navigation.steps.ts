import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { FieldType } from '../../../src/application/database-yjs/database.type';
import { setCellDirect } from '../../support/gallery-test-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';
import { activeSidePeekPage, fieldByName, gridCell, rowIdByTitle } from '../../support/side-peek-helpers';

const { Given, Then } = createBdd();

// Reused steps defined elsewhere (do not redefine):
// - every shared side peek step (side-peek.steps.ts)
// - 'I add a {string} view from the database tab bar' (database-view-tab-order.steps.ts)

/** Direct Yjs write, like the select variant in side-peek.steps.ts; filters read the cell. */
Given(
  'the row {string} has the text {string} in its {string} property',
  async ({ page }, rowTitle: string, text: string, fieldName: string) => {
    const active = activeSidePeekPage(page);
    const field = await fieldByName(active, fieldName);

    if (field.type !== FieldType.RichText) throw new Error(`Property "${fieldName}" is not a text property`);
    await setCellDirect(active, await rowIdByTitle(active, rowTitle), field.id, field.type, text);
    // Only a grid renders the cell; card layouts show it once the row opens.
    if (await DatabaseGridSelectors.grid(active).isVisible()) {
      await expect(await gridCell(active, rowTitle, fieldName)).toContainText(text, { timeout: 15_000 });
    }
  }
);

/** The expanded search box keeps its text while the peek opens and closes. */
Then('the database view search shows {string}', async ({ page }, text: string) => {
  await expect(activeSidePeekPage(page).getByTestId('database-actions-search-input')).toHaveValue(text, {
    timeout: 15_000,
  });
});
