/**
 * Dashboards follow the app language (WP14c). The wording is shared with the
 * desktop BDD (`dashboard_localization.feature`). Expected texts come from the
 * shared translation table (`dashboard-parity/i18n/`), never from a step.
 *
 * Reused steps: "a dashboard of … views side by side", "I click the dashboard
 * Edit button", "I click the "Grid" widget title" and "the "Total" widget
 * shows the number …".
 */
import { createBdd } from 'playwright-bdd';

import {
  chooseAppLanguage,
  expectAxisLabels,
  expectToolbarButtonText,
  expectWidgetMenuTexts,
  openChartsDashboard,
  setAppLanguageBeforeDashboard,
} from '../../support/dashboard-localization-helpers';
import { splitList } from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

Given('the app language is {string}', async ({ page, request, $bddContext }, language: string) => {
  const steps = $bddContext.bddTestData.steps;
  const followingGivens: string[] = [];

  for (const step of steps.slice($bddContext.stepIndex + 1)) {
    if (step.keywordType !== 'Context') break;
    followingGivens.push(step.textWithKeyword);
  }

  await setAppLanguageBeforeDashboard(page, request, language, followingGivens);
});

Given(
  'a dashboard of {string} shows its {string} bar chart and its {string} number chart',
  async ({ page, request }, database: string, barView: string, numberView: string) => {
    await openChartsDashboard(page, request, database, barView, numberView);
  }
);

When('I change the app language to {string}', async ({ page, request }, language: string) => {
  await chooseAppLanguage(page, request, language);
});

Then(
  'the dashboard Edit button reads the {string} text for {string}',
  async ({ page }, language: string, english: string) => {
    await expectToolbarButtonText(page, 'Edit', language, english);
  }
);

Then(
  'the dashboard Done button reads the {string} text for {string}',
  async ({ page }, language: string, english: string) => {
    await expectToolbarButtonText(page, 'Done', language, english);
  }
);

Then('the widget menu reads the {string} texts for {string}', async ({ page }, language: string, entries: string) => {
  await expectWidgetMenuTexts(page, language, splitList(entries));
});

Then('the {string} widget shows the axis labels {string}', async ({ page }, label: string, labels: string) => {
  await expectAxisLabels(page, label, splitList(labels));
});
