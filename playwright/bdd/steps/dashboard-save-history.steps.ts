import { type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { addWidgetSort } from '../../support/dashboard-condition-helpers';
import {
  DashboardSelectors,
  enterEditMode,
  expectGridWidgetRows,
  knownWidget,
  leaveEditMode,
  memberPage,
  splitList,
} from '../../support/dashboard-test-helpers';

const { When, Then } = createBdd();

/**
 * Keep the real active history scope after Save for everybody. Pointing at the
 * host dashboard before the shortcut would hide the foreign-widget regression.
 */
async function pressCurrentHistoryShortcut(page: Page, action: 'undo' | 'redo') {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  await page.keyboard.press(action === 'undo' ? `${modifier}+z` : `${modifier}+Shift+z`);
}

When('I press undo without changing the dashboard focus', async ({ page }) => {
  await pressCurrentHistoryShortcut(page, 'undo');
});

When('I press redo without changing the dashboard focus', async ({ page }) => {
  await pressCurrentHistoryShortcut(page, 'redo');
});

Then('the member sees the {string} widget rows {string}', async ({ page }, label: string, titles: string) => {
  const widget = DashboardSelectors.widget(memberPage(page), knownWidget(page, label).id);

  await expectGridWidgetRows(widget, splitList(titles));
});

When(
  'the collaborator sets a shared descending {string} sort in the {string} widget',
  async ({ page }, field: string, label: string) => {
    const member = memberPage(page);

    // An editor's Edit-mode conditions are shared immediately. This is a real
    // second browser edit, not a transaction injected into the owner's document.
    await enterEditMode(member);
    await addWidgetSort(member, page, label, field, 'descending');
    await leaveEditMode(member);
  }
);
