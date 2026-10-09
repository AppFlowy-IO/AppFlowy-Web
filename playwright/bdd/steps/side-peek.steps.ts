import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForCalendarLoad } from '../../support/calendar-test-helpers';
import { createDatabaseView } from '../../support/database-ui-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { renameCurrentDatabasePage } from '../../support/relation-test-helpers';
import { typeInRowDocument } from '../../support/row-detail-helpers';
import { CheckboxSelectors, DatabaseGridSelectors } from '../../support/selectors';
import {
  activeSidePeekPage,
  addFieldDirect,
  applySort,
  applyTextFilter,
  choosePeekDate,
  choosePeekMenuItem,
  choosePeekSelectOption,
  clearActiveViewSearch,
  clearFiltersAndSorts,
  closeActiveTab,
  closeExtraTabs,
  closePeekVia,
  createGridWithRows,
  dragPeekResizer,
  expectFullRowPage,
  expectNoBackdrop,
  expectNoPeek,
  expectPeekOpen,
  expectPeekReadOnly,
  expectPeekWidthWithinBounds,
  fieldByName,
  gridCell,
  navigatePeek,
  openRowFromCalendarEvent,
  openRowFromCardLayout,
  openRowFromChartDrilldown,
  openRowFromGrid,
  openRowViaDeepLink,
  openSecondTab,
  peek,
  peekDocument,
  peekNavigationButton,
  peekNavigationOrder,
  peekPropertyValue,
  peekResizer,
  peekTitle,
  pressPeekResizerKey,
  readPeekWidth,
  reloadDatabasePage,
  resetSidePeekState,
  rowIdByTitle,
  searchActiveView,
  seedGridRows,
  setPageLocked,
  setPeekTextProperty,
  setPeekTitle,
  setSelectCellDirect,
  sidePeekState,
  splitList,
  switchToTab,
  togglePeekCheckbox,
  trackTab,
  visibleRowTitles,
  type PeekDirection,
  type PeekMenuItem,
  type PeekMode,
  type PeekNavigationVia,
  type SidePeekCardLayout,
} from '../../support/side-peek-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { createCalendarEvent } from '../../support/timeline-test-helpers';

const { After, Given, Then, When } = createBdd();

// Reused steps defined elsewhere (do not redefine):
// - 'I open the row detail for row {int}' (text-cell-rich-text.steps.ts)
// - 'I rename the open database row to {string}' (database-row-undo-redo.steps.ts)
// - 'I type {string} into the row document' (row-page-lifecycle.steps.ts)
// - 'the row title reads {string}' (text-cell-rich-text.steps.ts)
// - 'I lock the current page' (inline-comment.steps.ts)
// - 'I add a {string} view from the database tab bar' (database-view-tab-order.steps.ts)

After(async ({ page }) => {
  await closeExtraTabs(page);
});

function assertOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(', ')}, got "${value}"`);
  return value as T;
}

async function rememberPeekWidth(rootPage: Page, page: Page): Promise<void> {
  sidePeekState(rootPage).peekWidthBefore = await readPeekWidth(page);
}

// ---------------------------------------------------------------------------
// Setup: sign in, grid, properties, extra views
// ---------------------------------------------------------------------------

Given('I am signed in for side peek testing', async ({ page, request }) => {
  resetSidePeekState(page);
  setupPageErrorHandling(page);
  // 1440 wide: side peek is the default mode (it needs >= 1024 and room for the page).
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
});

Given('I have created a grid named {string} with rows {string}', async ({ page }, name: string, rows: string) => {
  await createGridWithRows(activeSidePeekPage(page), name, splitList(rows));
});

Given('the grid has rows {string}', async ({ page }, rows: string) => {
  await seedGridRows(activeSidePeekPage(page), splitList(rows));
});

Given('the grid has a {word} property named {string}', async ({ page }, kind: string, name: string) => {
  await addFieldDirect(activeSidePeekPage(page), assertOneOf(kind, ['text', 'checkbox', 'date'], 'Property kind'), name);
});

Given(
  'the grid has a select property named {string} with options {string}',
  async ({ page }, name: string, options: string) => {
    await addFieldDirect(activeSidePeekPage(page), 'select', name, splitList(options));
  }
);

Given(
  'the row {string} has the option {string} in its {string} property',
  async ({ page }, rowTitle: string, option: string, fieldName: string) => {
    const active = activeSidePeekPage(page);

    await setSelectCellDirect(active, await rowIdByTitle(active, rowTitle), fieldName, option);
  }
);

/** Page locking lives on documents, so lock scenarios host the grid in one. */
Given(
  'I have created a document named {string} with a linked grid {string}',
  async ({ page }, documentName: string, gridName: string) => {
    const active = activeSidePeekPage(page);
    const documentId = await createDocumentPageAndNavigate(active);

    const title = active.locator(`#editor-title-${documentId}`);

    await expect(title).toBeVisible({ timeout: 15_000 });
    await title.fill(documentName);
    await active.keyboard.press('Enter');
    await insertLinkedDatabaseViaSlash(active, documentId, gridName, 'Grid');
    await expect(DatabaseGridSelectors.grid(active)).toBeVisible({ timeout: 30_000 });
  }
);

Given('I have created a calendar named {string} with events {string}', async ({ page }, name: string, events: string) => {
  const active = activeSidePeekPage(page);

  await createDatabaseView(active, 'Calendar', 7_000);
  await waitForCalendarLoad(active);
  await renameCurrentDatabasePage(active, name);
  const titles = splitList(events);

  // One event per day from today, so every event lands inside the current month grid.
  for (const [index, title] of titles.entries()) await createCalendarEvent(active, index, title);
});

// ---------------------------------------------------------------------------
// Opening rows in the peek
// ---------------------------------------------------------------------------

When('I open the row {string} in the peek from the grid', async ({ page }, title: string) => {
  await openRowFromGrid(activeSidePeekPage(page), title);
});

When('I open the row {string} in the peek from the {word} view', async ({ page }, title: string, layout: string) => {
  await openRowFromCardLayout(
    activeSidePeekPage(page),
    assertOneOf<SidePeekCardLayout>(layout, ['list', 'gallery', 'feed', 'board', 'timeline'], 'View'),
    title
  );
});

When('I open the row {string} in the peek from its calendar event', async ({ page }, title: string) => {
  await openRowFromCalendarEvent(activeSidePeekPage(page), title);
});

When(
  'I open the row {string} in the peek from the chart drill-down of bar {int}',
  async ({ page }, title: string, bar: number) => {
    await openRowFromChartDrilldown(activeSidePeekPage(page), bar, title);
  }
);

When('I open the row {string} in the peek via its deep link', async ({ page }, title: string) => {
  await openRowViaDeepLink(activeSidePeekPage(page), title);
});

// ---------------------------------------------------------------------------
// Mode, header menu, navigation, close
// ---------------------------------------------------------------------------

Then('the peek is open in {word} mode showing {string}', async ({ page }, mode: string, title: string) => {
  await expectPeekOpen(activeSidePeekPage(page), assertOneOf<PeekMode>(mode, ['side', 'center'], 'Mode'), title);
});

Then('the peek is open in {word} mode', async ({ page }, mode: string) => {
  await expectPeekOpen(activeSidePeekPage(page), assertOneOf<PeekMode>(mode, ['side', 'center'], 'Mode'));
});

Then('the peek shows the title {string}', async ({ page }, title: string) => {
  await expectPeekOpen(activeSidePeekPage(page), undefined, title);
});

Then('the peek has no backdrop', async ({ page }) => {
  await expectNoBackdrop(activeSidePeekPage(page));
});

Then('no peek is open', async ({ page }) => {
  await expectNoPeek(activeSidePeekPage(page));
});

/** Items: Side peek, Center peek, Full page, New tab. */
When('I switch the open row to {string}', async ({ page }, item: string) => {
  const popup = await choosePeekMenuItem(
    activeSidePeekPage(page),
    assertOneOf<PeekMenuItem>(item, ['Side peek', 'Center peek', 'Full page', 'New tab'], 'Menu item')
  );

  if (popup) trackTab(page, popup);
});

When('I open the peeked row as a full page from the header', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await active.getByTestId('row-detail-open-full-page').click();
  await expectFullRowPage(active);
});

Then('the full row page for {string} is open', async ({ page }, title: string) => {
  await expectFullRowPage(activeSidePeekPage(page), title);
});

When('I navigate to the {word} row with the {word}', async ({ page }, direction: string, via: string) => {
  await navigatePeek(
    activeSidePeekPage(page),
    assertOneOf<PeekDirection>(direction, ['previous', 'next'], 'Direction'),
    assertOneOf<PeekNavigationVia>(via, ['button', 'shortcut'], 'Navigation')
  );
});

Then('the {word} row button is {word}', async ({ page }, direction: string, state: string) => {
  const button = peekNavigationButton(
    activeSidePeekPage(page),
    assertOneOf<PeekDirection>(direction, ['previous', 'next'], 'Direction')
  );

  if (assertOneOf(state, ['enabled', 'disabled'], 'Button state') === 'enabled') await expect(button).toBeEnabled();
  else await expect(button).toBeDisabled();
});

Then('the peek navigation order is {string}', async ({ page }, titles: string) => {
  expect(await peekNavigationOrder(activeSidePeekPage(page))).toEqual(splitList(titles));
});

When('I close the peek with the close button', async ({ page }) => {
  await closePeekVia(activeSidePeekPage(page), 'button');
});

When('I close the peek with Escape', async ({ page }) => {
  await closePeekVia(activeSidePeekPage(page), 'Escape');
});

When('I close the peek by clicking the backdrop', async ({ page }) => {
  await closePeekVia(activeSidePeekPage(page), 'backdrop');
});

When('I press Escape inside the peek', async ({ page }) => {
  const active = activeSidePeekPage(page);

  // Escape only reaches the peek unhandled when no menu or editor owns the key.
  await active.getByTestId('row-detail-header').click({ position: { x: 5, y: 5 } });
  await active.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Editing in the peek
// ---------------------------------------------------------------------------

When('I set the peek title to {string}', async ({ page }, title: string) => {
  await setPeekTitle(activeSidePeekPage(page), title);
});

When('I append {string} to the peek document', async ({ page }, text: string) => {
  await typeInRowDocument(activeSidePeekPage(page), text);
});

Then('the peek document contains {string}', async ({ page }, text: string) => {
  await expect(peekDocument(activeSidePeekPage(page))).toContainText(text, { timeout: 15_000 });
});

Then('the peek document does not contain {string}', async ({ page }, text: string) => {
  await expect(peekDocument(activeSidePeekPage(page))).not.toContainText(text, { timeout: 15_000 });
});

When('I set the {string} text property in the peek to {string}', async ({ page }, name: string, value: string) => {
  await setPeekTextProperty(activeSidePeekPage(page), name, value);
});

When('I toggle the {string} checkbox in the peek', async ({ page }, name: string) => {
  await togglePeekCheckbox(activeSidePeekPage(page), name);
});

When(
  'I choose the option {string} for the {string} property in the peek',
  async ({ page }, option: string, name: string) => {
    await choosePeekSelectOption(activeSidePeekPage(page), name, option);
  }
);

/** The date uses the property's format; new date properties read MM/DD/YYYY. */
When('I choose the date {string} for the {string} property in the peek', async ({ page }, date: string, name: string) => {
  await choosePeekDate(activeSidePeekPage(page), name, date);
});

Then('the {string} property in the peek shows {string}', async ({ page }, name: string, value: string) => {
  await expect(peekPropertyValue(activeSidePeekPage(page), name)).toContainText(value, { timeout: 15_000 });
});

Then('the {string} checkbox in the peek is {word}', async ({ page }, name: string, state: string) => {
  const checked = assertOneOf(state, ['checked', 'unchecked'], 'Checkbox state') === 'checked';

  await expect(
    peekPropertyValue(activeSidePeekPage(page), name).locator('[data-testid^="checkbox-cell-"]')
  ).toHaveAttribute('data-checked', String(checked), { timeout: 15_000 });
});

/** Marks the live DOM node so a later step can prove the editor moved rather than remounted. */
When('I mark the peek {word} editor', async ({ page }, editor: string) => {
  const active = activeSidePeekPage(page);
  const target = assertOneOf(editor, ['title', 'document'], 'Editor') === 'title' ? peekTitle(active) : peekDocument(active);

  await target.evaluate((node) => node.setAttribute('data-editor-instance', 'marked'));
});

Then('the peek {word} editor was not recreated', async ({ page }, editor: string) => {
  const active = activeSidePeekPage(page);
  const target = assertOneOf(editor, ['title', 'document'], 'Editor') === 'title' ? peekTitle(active) : peekDocument(active);

  await expect(target).toHaveAttribute('data-editor-instance', 'marked');
});

Then('the peek is read-only', async ({ page }) => {
  await expectPeekReadOnly(activeSidePeekPage(page), true);
});

Then('the peek is editable', async ({ page }) => {
  await expectPeekReadOnly(activeSidePeekPage(page), false);
});

// ---------------------------------------------------------------------------
// Persistence checks (grid cells, reload)
// ---------------------------------------------------------------------------

When('I reload the database page', async ({ page }) => {
  await reloadDatabasePage(activeSidePeekPage(page));
});

Then('the grid cell {string} of row {string} contains {string}', async ({ page }, field: string, row: string, value: string) => {
  await expect(await gridCell(activeSidePeekPage(page), row, field)).toContainText(value, { timeout: 15_000 });
});

Then('the {string} checkbox of grid row {string} is {word}', async ({ page }, field: string, row: string, state: string) => {
  const active = activeSidePeekPage(page);
  const checked = assertOneOf(state, ['checked', 'unchecked'], 'Checkbox state') === 'checked';
  const rowId = await rowIdByTitle(active, row);
  const fieldId = (await fieldByName(active, field)).id;

  await expect(CheckboxSelectors.checkboxCell(active, rowId, fieldId)).toHaveAttribute('data-checked', String(checked), {
    timeout: 15_000,
  });
});

Then('the visible rows are {string}', async ({ page }, titles: string) => {
  await expect.poll(() => visibleRowTitles(activeSidePeekPage(page)), { timeout: 15_000 }).toEqual(splitList(titles));
});

// ---------------------------------------------------------------------------
// Viewport and resizing
// ---------------------------------------------------------------------------

When('I set the viewport to {int}x{int}', async ({ page }, width: number, height: number) => {
  await activeSidePeekPage(page).setViewportSize({ width, height });
});

When('I drag the side peek resizer {int} px to the {word}', async ({ page }, pixels: number, direction: string) => {
  const active = activeSidePeekPage(page);

  await rememberPeekWidth(page, active);
  await dragPeekResizer(active, assertOneOf(direction, ['left', 'right'], 'Direction') === 'left' ? -pixels : pixels);
});

/** Keys: ArrowLeft (wider), ArrowRight (narrower), Home (minimum), End (maximum). */
When('I press {word} on the side peek resizer', async ({ page }, key: string) => {
  const active = activeSidePeekPage(page);

  await rememberPeekWidth(page, active);
  await pressPeekResizerKey(active, assertOneOf(key, ['ArrowLeft', 'ArrowRight', 'Home', 'End'], 'Key'));
});

Then('the side peek is {word} than before', async ({ page }, comparison: string) => {
  const before = sidePeekState(page).peekWidthBefore;

  if (before === undefined) throw new Error('Resize the side peek first so there is a width to compare with');
  const widths = expect.poll(() => readPeekWidth(activeSidePeekPage(page)));

  if (assertOneOf(comparison, ['wider', 'narrower'], 'Comparison') === 'wider') await widths.toBeGreaterThan(before);
  else await widths.toBeLessThan(before);
});

Then('the side peek width is within its bounds', async ({ page }) => {
  await expectPeekWidthWithinBounds(activeSidePeekPage(page));
});

Then('the side peek width is at its {word}', async ({ page }, bound: string) => {
  const active = activeSidePeekPage(page);
  const attribute = assertOneOf(bound, ['minimum', 'maximum'], 'Bound') === 'minimum' ? 'aria-valuemin' : 'aria-valuemax';

  await expect.poll(() => readPeekWidth(active)).toBe(Number(await peekResizer(active).getAttribute(attribute)));
});

// ---------------------------------------------------------------------------
// Page lock, filter, sort, search, tabs
// ---------------------------------------------------------------------------

When('I lock the current page from the header', async ({ page }) => {
  await setPageLocked(activeSidePeekPage(page), true);
});

When('I unlock the current page from the header', async ({ page }) => {
  await setPageLocked(activeSidePeekPage(page), false);
});

When('I filter the grid where {string} contains {string}', async ({ page }, field: string, text: string) => {
  await applyTextFilter(activeSidePeekPage(page), field, text);
});

When('I sort the grid by {string} {word}', async ({ page }, field: string, direction: string) => {
  await applySort(activeSidePeekPage(page), field, assertOneOf(direction, ['ascending', 'descending'], 'Direction'));
});

When('I clear the grid filters and sorts', async ({ page }) => {
  await clearFiltersAndSorts(activeSidePeekPage(page));
});

/** Gallery and Feed layouts only; the Grid toolbar has no search box. */
When('I search the database view for {string}', async ({ page }, text: string) => {
  await searchActiveView(activeSidePeekPage(page), text);
});

When('I clear the database view search', async ({ page }) => {
  await clearActiveViewSearch(activeSidePeekPage(page));
});

When('I open a second browser tab on the same page', async ({ page }) => {
  await openSecondTab(page);
});

When('I switch to browser tab {int}', async ({ page }, index: number) => {
  await switchToTab(page, index);
});

When('I close the current browser tab', async ({ page }) => {
  await closeActiveTab(page);
});

Then('the current browser tab shows the full row page for {string}', async ({ page }, title: string) => {
  await expectFullRowPage(activeSidePeekPage(page), title);
});

Then('the peek in this tab is still open showing {string}', async ({ page }, title: string) => {
  await expect(peek(activeSidePeekPage(page))).toBeVisible();
  await expect(peekTitle(activeSidePeekPage(page))).toHaveText(title);
});
