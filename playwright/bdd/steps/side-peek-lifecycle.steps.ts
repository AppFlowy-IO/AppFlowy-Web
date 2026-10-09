import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { waitForGridReady } from '../../support/database-ui-helpers';
import {
  createNamedDocumentPage,
  databaseBlocks,
  editFirstGridCell,
  insertInlineGridViaSlash,
  openPageByExactText,
} from '../../support/duplicate-test-helpers';
import { getActiveDatabaseViewId, withPublishedDatabaseView } from '../../support/publish-database-helpers';
import {
  createOneWayRelationField,
  openGridDatabaseByName,
  setRelationCellDirect,
  waitForDatabaseTestContext,
} from '../../support/relation-test-helpers';
import { getVisibleDataRowIds } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, PageSelectors, ShareSelectors } from '../../support/selectors';
import {
  activeSidePeekPage,
  expectPeekOpen,
  getActiveRowIds,
  peek,
  peekPropertyValue,
  rowIdByTitle,
  splitList,
  visibleRowTitles,
} from '../../support/side-peek-helpers';

// Lifecycle steps for the side peek feature; the shared library in
// side-peek.steps.ts owns sign-in, grid setup, opening, navigation and editing.

const { After, Given, Then, When } = createBdd();

interface LifecycleState {
  publishedUrl?: string;
  /** Relation properties by name: the field id and the related grid's rows by title. */
  relations: Record<string, { fieldId: string; targetRowIds: Record<string, string> }>;
}

const states = new WeakMap<Page, LifecycleState>();

function lifecycleState(rootPage: Page): LifecycleState {
  let state = states.get(rootPage);

  if (!state) {
    state = { relations: {} };
    states.set(rootPage, state);
  }

  return state;
}

After(async ({ page }) => {
  states.delete(page);
});

/** The inline database block rendered inside the peeked row document. */
function inlineGridInPeek(page: Page): Locator {
  return databaseBlocks(peek(page)).first();
}

function inlineGridRows(grid: Locator): Locator {
  return grid.locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])');
}

async function openRowExpandButton(row: Locator): Promise<void> {
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  const expand = row.getByTestId('row-expand-button');

  await expect(expand).toBeVisible({ timeout: 10_000 });
  await expand.click();
}

/**
 * Publish through the Share popover. Under parallel load the popover can be
 * torn down by an outline refresh, so the sequence is retried until a publish
 * request leaves the page. Returns the published page URL.
 */
async function publishCurrentDatabasePage(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ShareSelectors.shareButton(page).click({ force: true });
    const popover = ShareSelectors.sharePopover(page);

    await expect(popover).toBeVisible({ timeout: 10_000 });
    await popover.getByText('Publish', { exact: true }).click({ force: true });
    const publishButton = ShareSelectors.publishConfirmButton(page);

    await expect(publishButton).toBeEnabled({ timeout: 15_000 });
    const response = page
      .waitForResponse(
        (candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname.endsWith('/publish'),
        { timeout: 20_000 }
      )
      .then((res) => ({ res }))
      .catch(() => ({ timeout: true as const }));

    await publishButton.click({ force: true });
    const result = await response;

    if ('timeout' in result) {
      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden({ timeout: 10_000 });
      continue;
    }

    expect(result.res.ok(), `Publishing failed with HTTP ${result.res.status()}`).toBeTruthy();
    // The panel switches to its published state once the server confirms.
    await expect(ShareSelectors.visitSiteButton(page)).toBeVisible({ timeout: 30_000 });
    await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 30_000 });
    const namespace = ((await ShareSelectors.publishNamespace(page).textContent()) ?? '').trim();
    const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

    expect(namespace, 'Expected a publish namespace').not.toBe('');
    expect(publishName, 'Expected a publish name').not.toBe('');
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden({ timeout: 10_000 });
    return `${new URL(page.url()).origin}/${namespace}/${publishName}`;
  }

  throw new Error('The publish request never left the page');
}

// ---------------------------------------------------------------------------
// Browser history and full row pages
// ---------------------------------------------------------------------------

When('I go back in the browser history', async ({ page }) => {
  await activeSidePeekPage(page).goBack();
});

Then('the database page is open without a row page', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await expect
    .poll(
      () => {
        const url = new URL(active.url());

        return url.searchParams.has('r') || url.searchParams.has('r-modal');
      },
      { timeout: 15_000, message: 'Waiting for the row parameters to leave the URL' }
    )
    .toBe(false);
  await waitForGridReady(active);
  await waitForDatabaseTestContext(active);
});

// ---------------------------------------------------------------------------
// Published databases
// ---------------------------------------------------------------------------

When('I publish the grid page', async ({ page }) => {
  const active = activeSidePeekPage(page);
  // The published container opens on `?v=`; capture the grid's view before the popover.
  const viewId = await getActiveDatabaseViewId(active);

  lifecycleState(page).publishedUrl = withPublishedDatabaseView(await publishCurrentDatabasePage(active), viewId);
});

When('I open the published grid', async ({ page }) => {
  const active = activeSidePeekPage(page);
  const url = lifecycleState(page).publishedUrl;

  if (!url) throw new Error('Publish the grid page first');
  await active.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(DatabaseGridSelectors.grid(active)).toBeVisible({ timeout: 60_000 });
  await expect(DatabaseGridSelectors.dataRows(active).first()).toBeVisible({ timeout: 30_000 });
});

/** Published rows are route based: the expand button opens the `?r=` row page, never a peek. */
When('I open the published row {string}', async ({ page }, title: string) => {
  const active = activeSidePeekPage(page);

  await openRowExpandButton(DatabaseGridSelectors.rowById(active, await rowIdByTitle(active, title)));
  await expect(active).toHaveURL(/[?&]r=.+/, { timeout: 15_000 });
});

Then('the published row page offers no peek actions', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await expect(active.getByTestId('row-title-input')).toBeVisible({ timeout: 15_000 });
  for (const testId of ['row-detail', 'row-detail-header', 'row-peek-mode-menu', 'row-peek-new-tab']) {
    await expect(active.getByTestId(testId)).toHaveCount(0);
  }
});

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

Given('I have created a document page named {string}', async ({ page }, name: string) => {
  await createNamedDocumentPage(activeSidePeekPage(page), name);
});

When('I open the page {string} from the sidebar', async ({ page }, name: string) => {
  const active = activeSidePeekPage(page);

  await openPageByExactText(active, name);
  await expect(PageSelectors.titleInput(active).first()).toContainText(name, { timeout: 15_000 });
});

Then('the grid page {string} is open', async ({ page }, name: string) => {
  const active = activeSidePeekPage(page);

  await expect(PageSelectors.titleInput(active).first()).toContainText(name, { timeout: 15_000 });
  await waitForGridReady(active);
  await waitForDatabaseTestContext(active);
});

// ---------------------------------------------------------------------------
// Related rows
// ---------------------------------------------------------------------------

Given(
  'the grid has a relation property named {string} to the grid {string}',
  async ({ page }, fieldName: string, gridName: string) => {
    const active = activeSidePeekPage(page);
    const sourceName = ((await PageSelectors.titleInput(active).first().textContent()) ?? '').trim();

    if (!sourceName) throw new Error('The source grid page has no title to return to');
    // Read the related grid's database id and rows while it is on screen, then come back.
    const target = await openGridDatabaseByName(active, gridName);
    // The grid re-renders after the page switch: wait until the rendered rows are
    // the related view's rows before pairing their titles with their ids.
    let rowIds: string[] = [];

    await expect
      .poll(
        async () => {
          rowIds = await getVisibleDataRowIds(active);
          return rowIds.length > 0 && JSON.stringify(rowIds) === JSON.stringify(await getActiveRowIds(active));
        },
        { timeout: 30_000, message: `Waiting for the rows of "${gridName}" to render` }
      )
      .toBe(true);
    const titles = await visibleRowTitles(active);
    const targetRowIds = Object.fromEntries(titles.map((title, index) => [title, rowIds[index]]));

    await openGridDatabaseByName(active, sourceName);
    const fieldId = await createOneWayRelationField(active, { fieldName, relatedDatabaseId: target.databaseId });

    lifecycleState(page).relations[fieldName] = { fieldId, targetRowIds };
  }
);

Given(
  'the row {string} links to {string} in its {string} property',
  async ({ page }, rowTitle: string, targets: string, fieldName: string) => {
    const active = activeSidePeekPage(page);
    const relation = lifecycleState(page).relations[fieldName];

    if (!relation) throw new Error(`Create the relation property "${fieldName}" first`);
    const rowId = await rowIdByTitle(active, rowTitle);
    const rowIndex = (await getActiveRowIds(active)).indexOf(rowId);

    if (rowIndex < 0) throw new Error(`Row "${rowTitle}" is not in the active view`);
    const targetTitles = splitList(targets);
    const targetIds = targetTitles.map((title) => {
      const id = relation.targetRowIds[title];

      if (!id) throw new Error(`No row titled "${title}" in the related grid`);
      return id;
    });

    await setRelationCellDirect(active, relation.fieldId, rowIndex, targetIds);
    // The cell resolves the related rows' titles once the related database loads.
    for (const title of targetTitles) {
      await expect(DatabaseGridSelectors.cellByIds(active, rowId, relation.fieldId)).toContainText(title, {
        timeout: 30_000,
      });
    }
  }
);

When(
  'I open the related row {string} from the {string} property in the peek',
  async ({ page }, title: string, fieldName: string) => {
    const active = activeSidePeekPage(page);
    const chip = peekPropertyValue(active, fieldName).getByText(title, { exact: true });

    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.click();
    await expectPeekOpen(active, undefined, title);
  }
);

// ---------------------------------------------------------------------------
// Inline database inside the peeked row document
// ---------------------------------------------------------------------------

When('I insert an inline grid into the peek document', async ({ page }) => {
  const active = activeSidePeekPage(page);
  const editor = peek(active).locator('[data-slate-editor="true"][id^="editor-"]').first();

  await expect(editor).toBeVisible({ timeout: 15_000 });
  const viewId = ((await editor.getAttribute('id')) ?? '').replace(/^editor-/, '');

  if (!viewId) throw new Error('The peek document editor has no view id');
  await insertInlineGridViaSlash(active, viewId);
  const grid = inlineGridInPeek(active);

  await expect(grid).toBeVisible({ timeout: 30_000 });
  await expect(inlineGridRows(grid).first()).toBeVisible({ timeout: 30_000 });
});

When('I name the first row of the inline grid in the peek {string}', async ({ page }, title: string) => {
  const active = activeSidePeekPage(page);

  await editFirstGridCell(active, inlineGridInPeek(active), title);
});

When('I open the first row of the inline grid in the peek', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await openRowExpandButton(inlineGridRows(inlineGridInPeek(active)).first());
});
