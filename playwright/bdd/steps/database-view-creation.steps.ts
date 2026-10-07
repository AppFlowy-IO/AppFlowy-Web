import { Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { DatabaseViewCreationFixture } from '../../support/database-view-creation-helpers';

const { Given, When, Then } = createBdd();
const fixtures = new WeakMap<Page, DatabaseViewCreationFixture>();

function fixture(page: Page): DatabaseViewCreationFixture {
  const value = fixtures.get(page);

  if (!value) throw new Error('Initialize the hosted database creation fixture first');
  return value;
}

Given('a Free hosted owner has a new grid for database creation', async ({ page, request, $testInfo }) => {
  $testInfo.setTimeout(300_000);
  const value = new DatabaseViewCreationFixture(page, request);

  fixtures.set(page, value);
  await value.initialize();
});

Then('the {string} creation menu shows crowns for {string}', async ({ page }, surface: string, layouts: string) => {
  await fixture(page).expectCrowns(surface, layouts.split('|').filter(Boolean));
});

When('the owner creates the first {string} from the database tabs', async ({ page }, layout: string) => {
  await fixture(page).createFirst(layout);
});

Then('Cloud contains {int} Form and {int} Chart views', async ({ page }, forms: number, charts: number) => {
  await fixture(page).expectCounts(forms, charts);
});

When(
  'the owner selects exhausted {string} from the {string} creation menu',
  async ({ page }, layout: string, surface: string) => {
    await fixture(page).selectUpgrade(layout, surface);
  }
);

Then('Pro plan comparison opens without starting checkout', async ({ page }) => {
  await fixture(page).expectPlanComparison();
});

When('the owner clicks Pro to start checkout', async ({ page }) => {
  await fixture(page).startCheckout();
});

Then(/^monthly Pro checkout has opened (\d+) times? without another database view$/, async ({ page }, count: string) => {
  await fixture(page).expectCheckout(Number(count));
});

When('the owner reloads the database', async ({ page }) => {
  await fixture(page).reload();
});

When('the owner opens a new document for database creation', async ({ page }) => {
  await fixture(page).openDocument();
});

When('the owner selects the {string} slash upgrade using {string}', async ({ page }, key: string, method: string) => {
  await fixture(page).selectSlashUpgrade(key, method);
});
