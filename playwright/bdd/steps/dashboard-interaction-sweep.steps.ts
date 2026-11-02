/**
 * The dashboard interaction sweep (fix pass section 6.1). The wording is
 * shared with the desktop BDD (`dashboard_interaction_sweep.feature`); the
 * View mode, Edit mode, Settings tool and panel steps it reuses live in
 * `dashboard.steps.ts` and `dashboard-widget-chrome.steps.ts`.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { frameworkErrorCollector, startFrameworkErrorRecording } from '../../support/dashboard-error-collector';
import {
  openAndCloseEveryToolbarControl,
  openAndCloseEveryWidgetControl,
  openAndCloseWidgetPicker,
  openDashboardWithEveryWidgetType,
  openEveryViewSettingsRow,
  reopenSettingsHostOf,
  widgetWithOpenSettings,
} from '../../support/dashboard-interaction-sweep-helpers';
import { DashboardSelectors } from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

Given('a dashboard of {string} shows a widget of every type', async ({ page, request }, database: string) => {
  await openDashboardWithEveryWidgetType(page, request, database);
});

Given('framework errors and warnings are being recorded', async ({ page }) => {
  await startFrameworkErrorRecording(page);
});

When('I open and close every control of the {string} widget', async ({ page }, name: string) => {
  await openAndCloseEveryWidgetControl(page, name);
});

When('I open and close every dashboard toolbar control', async ({ page }) => {
  await openAndCloseEveryToolbarControl(page);
});

When('I open and close the widget picker', async ({ page }) => {
  await openAndCloseWidgetPicker(page);
});

When('I open every row of the {string} panel', async ({ page }, panel: string) => {
  expect(panel).toBe('View settings');
  const open = widgetWithOpenSettings(page);

  await expect(open, 'no widget has its View settings panel open').toHaveCount(1);
  // Pin the widget: the filter above stops matching once the panel closes.
  const widget = DashboardSelectors.widget(page, (await open.getAttribute('data-widget-id')) ?? '');
  const name = (await widget.getByTestId('dashboard-widget-title').textContent())?.trim() || 'the widget';

  await openEveryViewSettingsRow(page, `${name} / Edit / View settings`);
  // The Source row hands over to the picker, which closes the panel: open it again for the next step.
  await reopenSettingsHostOf(page, widget);
  await frameworkErrorCollector(page).expectNone(`${name} / Edit / View settings`);
});

Then('no framework error or warning was reported', async ({ page }) => {
  await frameworkErrorCollector(page).expectNone('the sweep');
});
