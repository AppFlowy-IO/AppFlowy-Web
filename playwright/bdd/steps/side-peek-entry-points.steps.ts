import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  appendRowToCurrentDatabaseDirect,
  closeRelationMenu,
  openRelationCellMenu,
  selectRelationRowByName,
} from '../../support/relation-test-helpers';
import { getVisibleDataRowIds } from '../../support/row-detail-helpers';
import {
  BoardSelectors,
  DatabaseGridSelectors,
  FieldType,
  GridFieldSelectors,
  PropertyMenuSelectors,
  TimelineSelectors,
} from '../../support/selectors';
import {
  activeSidePeekPage,
  addViewFromTabBar,
  expectPeekOpen,
  fieldByName,
  peekPropertyValue,
  resetSidePeekState,
  rowIdByTitle,
  type SidePeekLayout,
} from '../../support/side-peek-helpers';
import { grantTestProSubscription, mockProSubscription } from '../../support/subscription-test-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

// Reused steps defined elsewhere (do not redefine):
// - 'I open the No Date list', 'the No Date list shows {int} undated row' and
//   'I focus the {string} bar and press Enter' (timeline.steps.ts)
// - every peek open/assert/close step (side-peek.steps.ts)

const VIEW_LAYOUTS: readonly SidePeekLayout[] = ['Grid', 'Board', 'Calendar', 'Chart', 'List', 'Gallery', 'Feed', 'Timeline'];

// ---------------------------------------------------------------------------
// Setup: Pro sign-in, extra views
// ---------------------------------------------------------------------------

/** Timeline creation is Pro-gated on hosted servers; mirror the timeline fixtures. */
Given('I am signed in for side peek testing with a Pro subscription', async ({ page, request }) => {
  resetSidePeekState(page);
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockProSubscription(page);
  await signInAndWaitForApp(page, request, generateRandomEmail());
  grantTestProSubscription(page);
});

/** Adds the view from the tab bar and waits for its layout to render (quota-gated layouts included). */
When('I open a new {word} view of the database', async ({ page }, layout: string) => {
  if (!VIEW_LAYOUTS.includes(layout as SidePeekLayout)) {
    throw new Error(`View layout must be one of ${VIEW_LAYOUTS.join(', ')}, got "${layout}"`);
  }

  await addViewFromTabBar(activeSidePeekPage(page), layout as SidePeekLayout);
});

// ---------------------------------------------------------------------------
// List, board, calendar, chart and timeline entry points
// ---------------------------------------------------------------------------

/** The list opener is keyboard-only (`pointer-events: none`), so Enter activates it. */
When('I activate the Open row button of the list row {string}', async ({ page }, title: string) => {
  const active = activeSidePeekPage(page);
  const opener = active.getByTestId(`list-row-open-${await rowIdByTitle(active, title)}`);

  await expect(opener).toBeAttached({ timeout: 15_000 });
  await opener.focus();
  await active.keyboard.press('Enter');
  await expectPeekOpen(active, undefined, title);
});

/** Board keyboard navigation: ArrowDown selects cards in DOM order, Enter opens the selected one. */
When('I select the board card {string} with the arrow keys and press Enter', async ({ page }, title: string) => {
  const active = activeSidePeekPage(page);
  const rowId = await rowIdByTitle(active, title);
  const card = BoardSelectors.cardByRowId(active, rowId).first();

  await expect(card).toBeVisible({ timeout: 15_000 });
  const cardIds = await BoardSelectors.boardContainer(active)
    .locator('[data-card-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-card-id') ?? ''));
  const index = cardIds.findIndex((id) => id.endsWith(`/${rowId}`));

  if (index < 0) throw new Error(`No board card for "${title}"`);
  // The first press selects the first card; each further press moves one card down.
  for (let step = 0; step <= index; step += 1) await active.keyboard.press('ArrowDown');
  await expect(card).toHaveClass(/ring-1/);
  await active.keyboard.press('Enter');
  await expectPeekOpen(active, undefined, title);
});

/** A row without a date goes to the calendar's "No date" list instead of a day cell. */
Given('the calendar has an undated row {string}', async ({ page }, title: string) => {
  const active = activeSidePeekPage(page);

  await appendRowToCurrentDatabaseDirect(active, title);
  await expect(TimelineSelectors.noDateButton(active)).toBeVisible({ timeout: 15_000 });
});

When('I open the undated row {string} from the No Date list', async ({ page }, title: string) => {
  const active = activeSidePeekPage(page);
  const row = active.getByTestId('no-date-row').filter({ hasText: title }).first();

  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByText(title, { exact: true }).click();
  await expectPeekOpen(active, undefined, title);
});

Then('the chart drill-down popup is closed', async ({ page }) => {
  const active = activeSidePeekPage(page);

  // The drill-down is the MUI dialog with a title; the peek shells carry none.
  await expect(
    active.locator('.MuiDialog-root').filter({ has: active.locator('.MuiDialogTitle-root') })
  ).toHaveCount(0, { timeout: 15_000 });
});

/** A still press opens the bar; a moved pointer would start a drag instead. */
When('I click the timeline bar {string}', async ({ page }, title: string) => {
  const active = activeSidePeekPage(page);

  await TimelineSelectors.barButton(active, title).click();
  await expectPeekOpen(active, undefined, title);
});

// ---------------------------------------------------------------------------
// Relation link
// ---------------------------------------------------------------------------

/** Creates the relation through the property menu's creation dialog, picking the target by name. */
Given(
  'the grid has a relation property named {string} linked to the database {string}',
  async ({ page }, name: string, databaseName: string) => {
    const active = activeSidePeekPage(page);
    const newPropertyButton = PropertyMenuSelectors.newPropertyButton(active).last();

    await newPropertyButton.scrollIntoViewIfNeeded();
    await newPropertyButton.evaluate((element) => (element as HTMLElement).click());
    const typeTrigger = PropertyMenuSelectors.propertyTypeTrigger(active).last();

    await expect(typeTrigger).toBeVisible({ timeout: 15_000 });
    await typeTrigger.click();
    const relationOption = PropertyMenuSelectors.propertyTypeOption(active, FieldType.Relation).last();

    await expect(relationOption).toBeVisible({ timeout: 10_000 });
    await relationOption.click();
    const dialog = active.getByTestId('relation-creation-dialog');

    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await active.getByTestId('relation-database-trigger').click();
    const candidate = active.locator('[data-testid^="relation-candidate-"]').filter({ hasText: databaseName }).first();

    await expect(candidate).toBeVisible({ timeout: 15_000 });
    await candidate.click();
    // Picking a database applies its default relation name, so name the field afterwards.
    const nameInput = active.getByTestId('relation-field-name-input');

    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(name);
    await active.getByTestId('modal-ok-button').last().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(GridFieldSelectors.allFieldHeaders(active).filter({ hasText: name }).first()).toBeVisible({
      timeout: 15_000,
    });
  }
);

Given(
  'the row {string} is linked to {string} through its {string} property',
  async ({ page }, rowTitle: string, relatedTitle: string, fieldName: string) => {
    const active = activeSidePeekPage(page);
    const rowId = await rowIdByTitle(active, rowTitle);
    const fieldId = (await fieldByName(active, fieldName)).id;
    const rowIndex = (await getVisibleDataRowIds(active)).indexOf(rowId);

    if (rowIndex < 0) throw new Error(`Row "${rowTitle}" is not visible in the grid`);
    await openRelationCellMenu(active, fieldId, rowIndex);
    await selectRelationRowByName(active, relatedTitle);
    await closeRelationMenu(active);
    await expect(DatabaseGridSelectors.cellByIds(active, rowId, fieldId)).toContainText(relatedTitle, {
      timeout: 15_000,
    });
  }
);

/** The related row opens in the same peek, backed by its own database. */
When(
  'I follow the relation link {string} in the {string} property of the peek',
  async ({ page }, relatedTitle: string, fieldName: string) => {
    const active = activeSidePeekPage(page);
    const link = peekPropertyValue(active, fieldName).getByText(relatedTitle, { exact: true }).first();

    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    await expectPeekOpen(active, undefined, relatedTitle);
  }
);
