import { expect, Locator, Page } from '@playwright/test';
import {
  AddPageSelectors,
  BlockSelectors,
  HeaderSelectors,
  ModalSelectors,
  PageSelectors,
  SlashCommandSelectors,
  ViewActionSelectors,
  viewIdFromPageTestId,
} from './selectors';
import { createDatabaseView, waitForGridReady } from './database-ui-helpers';
import { createDocumentPageAndNavigate, currentViewIdFromUrl, ensurePageExpandedByViewId } from './page-utils';
import { getSlashMenuItemName } from './i18n-constants';
import {
  changeCheckboxFilterCondition,
  changeFilterCondition,
  CheckboxFilterCondition,
  TextFilterCondition,
} from './filter-test-helpers';
import { getFieldIdByName, toggleCheckbox } from './field-type-helpers';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function pageNamesByExactText(page: Page, pageName: string): Locator {
  return page
    .locator('[data-testid="page-name"]:visible')
    .filter({ hasText: new RegExp(`^${escapeRegExp(pageName)}$`) });
}

export function pageNamesByCopyText(page: Page, pageName: string): Locator {
  return page
    .locator('[data-testid="page-name"]:visible')
    .filter({ hasText: new RegExp(`^${escapeRegExp(pageName)} \\((?:Copy|copy)\\)$`) });
}

export function pageItemByExactText(page: Page, pageName: string, last: boolean = false): Locator {
  const locator = page.locator(
    `[data-testid="page-item"]:visible:has(> div:first-child [data-testid="page-name"]:text-is("${pageName}"))`
  );

  return last ? locator.last() : locator.first();
}

export function directChildPageItems(page: Page, pageName: string, last: boolean = false): Locator {
  return pageItemByExactText(page, pageName, last).locator(
    ':scope > div:nth-child(2) > [data-testid="page-item"]:visible'
  );
}

async function navigateToSidebarPageItem(
  page: Page,
  pageItem: Locator,
  targetViewId: string,
  pageName: string
): Promise<void> {
  const previousViewId = currentViewIdFromUrl(page);
  await pageItem.hover({ force: true });
  await pageItem.click({ force: true, position: { x: 96, y: 14 } });

  if (previousViewId !== targetViewId) {
    const navigatedViaSidebar = await expect
      .poll(() => currentViewIdFromUrl(page), {
        timeout: 3000,
        message: `Expected to navigate to page "${pageName}" (${targetViewId})`,
      })
      .toBe(targetViewId)
      .then(() => true)
      .catch(() => false);

    if (!navigatedViaSidebar) {
      const nextUrl = new URL(page.url());
      const segments = nextUrl.pathname.split('/').filter(Boolean);
      segments[segments.length - 1] = targetViewId;
      nextUrl.pathname = `/${segments.join('/')}`;
      await page.goto(nextUrl.toString(), { waitUntil: 'domcontentloaded' });
      await expect
        .poll(() => currentViewIdFromUrl(page), {
          timeout: 30000,
          message: `Expected direct navigation to page "${pageName}" (${targetViewId})`,
        })
        .toBe(targetViewId);
    }
  }

  const currentUrl = new URL(page.url());
  const hadRowDetailSearch = currentUrl.searchParams.has('r') || currentUrl.searchParams.has('r-modal');
  if (hadRowDetailSearch) {
    currentUrl.searchParams.delete('r');
    currentUrl.searchParams.delete('r-modal');
    await page.goto(currentUrl.toString(), { waitUntil: 'domcontentloaded' });
    await expect
      .poll(
        () => {
          const url = new URL(page.url());
          return url.searchParams.has('r') || url.searchParams.has('r-modal');
        },
        {
          timeout: 15000,
          message: `Expected row detail params to be cleared when opening "${pageName}"`,
        }
      )
      .toBeFalsy();
  }

  await page.waitForTimeout(1000);
}

export async function renameCurrentPage(page: Page, newName: string): Promise<void> {
  const titleInput = PageSelectors.titleInput(page).first();
  await expect(titleInput).toBeVisible({ timeout: 15000 });
  await titleInput.click({ force: true });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(newName);
  await page.keyboard.press('Enter');
  await expect(titleInput).toContainText(newName, { timeout: 15000 });
  await page.waitForTimeout(1000);
}

export async function createNamedGridPage(page: Page, pageName: string): Promise<string> {
  await createDatabaseView(page, 'Grid', 6000);
  await waitForGridReady(page);
  await renameCurrentPage(page, pageName);
  // Allow collab sync to propagate the rename to the server/outline cache
  await page.waitForTimeout(2000);
  return pageName;
}

export async function createNamedDocumentPage(page: Page, pageName: string): Promise<string> {
  const viewId = await createDocumentPageAndNavigate(page);
  await renameCurrentPage(page, pageName);
  await ensurePageExpandedByViewId(page, viewId);
  return viewId;
}

export async function duplicateCurrentPageViaHeader(page: Page): Promise<void> {
  // Ensure no leftover dialogs/overlays are blocking the header button
  await expect(page.locator('.MuiDialog-paper'))
    .toHaveCount(0, { timeout: 5000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);

  const moreBtn = HeaderSelectors.moreActionsButton(page);
  await expect(moreBtn).toBeVisible({ timeout: 10000 });

  // Use a polling approach: click the trigger and wait for the duplicate button
  // to appear.  Radix DropdownMenu sometimes doesn't open on the first pointer
  // event (e.g., if focus was still on a dialog).  We poll so we can re-click
  // if the dropdown hasn't opened yet.
  const dupBtn = ViewActionSelectors.duplicateButton(page);
  await expect
    .poll(
      async () => {
        const isOpen = await dupBtn.isVisible().catch(() => false);
        if (!isOpen) {
          // Check if dropdown content exists in DOM (may be animating in)
          const contentCount = await page.locator('[data-slot="dropdown-menu-content"]').count();
          if (contentCount === 0) {
            // Dropdown not in DOM at all — click the trigger
            await moreBtn.click();
            await page.waitForTimeout(300);
          }
        }
        return isOpen;
      },
      { timeout: 15000, message: 'Duplicate button did not become visible after clicking more actions' }
    )
    .toBeTruthy();

  await dupBtn.click();

  const blockingLoader = page.getByTestId('blocking-loader');
  const loaderAppeared = await blockingLoader
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (loaderAppeared || (await blockingLoader.count()) > 0) {
    await expect(blockingLoader, 'Expected duplicate blocking loader to finish before opening the copy').toBeHidden({
      timeout: 60000,
    });
  }

  await page.waitForTimeout(2000);
}

export async function openPageByExactText(page: Page, pageName: string, last: boolean = false): Promise<void> {
  const pageItem = pageItemByExactText(page, pageName, last);
  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.scrollIntoViewIfNeeded();

  const pageEntry = pageItem.locator(':scope > [data-testid^="page-"]').first();
  const testId = await pageEntry.getAttribute('data-testid');
  const targetViewId = viewIdFromPageTestId(testId);
  await navigateToSidebarPageItem(page, pageItem, targetViewId, pageName);
}

export async function openCopiedPage(
  page: Page,
  sourcePageName: string,
  previousCopyCount: number = 0
): Promise<string> {
  const copyLocator = pageNamesByCopyText(page, sourcePageName);
  await expect
    .poll(async () => await copyLocator.count(), {
      timeout: 30000,
      message: `Expected a new visible copy for "${sourcePageName}" to appear in the sidebar`,
    })
    .toBeGreaterThan(previousCopyCount);

  const copyIndex = (await copyLocator.count()) - 1;
  const target = copyLocator.nth(copyIndex);
  await expect(target).toBeVisible({ timeout: 30000 });
  await target.scrollIntoViewIfNeeded();
  const copyName = (await target.innerText()).trim();
  const pageItem = pageItemByExactText(page, copyName, true);
  const pageEntry = pageItem.locator(':scope > [data-testid^="page-"]').first();
  const testId = await pageEntry.getAttribute('data-testid');
  const targetViewId = viewIdFromPageTestId(testId);
  await navigateToSidebarPageItem(page, pageItem, targetViewId, copyName);
  return copyName;
}

export async function expandPageByExactText(page: Page, pageName: string, last: boolean = false): Promise<void> {
  const item = pageItemByExactText(page, pageName, last);
  await expect(item).toBeVisible({ timeout: 30000 });
  await item.scrollIntoViewIfNeeded();

  const expandToggle = item.locator('[data-testid="outline-toggle-expand"]');
  if ((await expandToggle.count()) > 0) {
    await expandToggle.first().click({ force: true });
    await page.waitForTimeout(1000);
  }
}

export async function expectDirectChildPageCount(
  page: Page,
  pageName: string,
  count: number,
  last: boolean = false
): Promise<void> {
  await expect(directChildPageItems(page, pageName, last)).toHaveCount(count, { timeout: 30000 });
}

export async function createChildDocumentUnder(
  page: Page,
  parentPageName: string,
  childPageName: string
): Promise<void> {
  const parentItem = pageItemByExactText(page, parentPageName);
  await expect(parentItem).toBeVisible({ timeout: 30000 });
  await parentItem.locator('> div').first().hover({ force: true });
  await page.waitForTimeout(500);

  await parentItem.locator('> div').first().getByTestId('inline-add-page').first().click({ force: true });
  const popover = page.getByTestId('view-actions-popover');
  await expect(popover).toBeVisible({ timeout: 10000 });
  await popover.locator('[role="menuitem"]').first().click({ force: true });
  await page.waitForTimeout(1000);

  // The ViewModal dialog opens for the newly created child document.
  // We must expand it to full-page view (click the expand button) so that
  // renameCurrentPage targets the CHILD page, not the parent.
  const dialog = page.locator('[role="dialog"]');
  if (await dialog.isVisible().catch(() => false)) {
    // Click the expand/full-page button (first button in the dialog title bar)
    await dialog.last().locator('button').first().click({ force: true });
    await page.waitForTimeout(1000);
  }

  await renameCurrentPage(page, childPageName);
}

export function editorForView(page: Page, viewId: string): Locator {
  return page.locator(`#editor-${viewId}`);
}

export function databaseBlocks(editor: Locator): Locator {
  return editor.locator(BlockSelectors.blockSelector('grid'));
}

async function openSlashMenuInEditor(page: Page, editor: Locator, line: number = 0): Promise<void> {
  const blocks = databaseBlocks(editor);
  const blockCount = await blocks.count();
  const slashPanel = SlashCommandSelectors.slashPanel(page);

  if (line > 0 && blockCount > 0) {
    // Position cursor after the last database block by clicking below it,
    // pressing End to go to the end of the line, then Enter to create a
    // new empty paragraph.
    const lastBlock = blocks.nth(Math.min(line - 1, blockCount - 1));
    await lastBlock.scrollIntoViewIfNeeded();
    const box = await lastBlock.boundingBox();

    if (box) {
      // Click just below the last database block
      await page.mouse.click(box.x + box.width / 2, box.y + box.height + 10);
    } else {
      await editor.click({ force: true });
    }

    await page.waitForTimeout(300);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('/', { delay: 50 });

    if (
      !(await slashPanel
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      await page.waitForTimeout(300);
      await page.keyboard.type('/', { delay: 50 });
    }

    await expect(slashPanel).toBeVisible({ timeout: 10000 });
    return;
  } else {
    await editor.click({ position: { x: 200, y: 100 }, force: true });
  }

  await page.waitForTimeout(300);
  await page.keyboard.type('/', { delay: 50 });

  if (
    (await slashPanel.count()) === 0 ||
    !(await slashPanel
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('/', { delay: 50 });
  }

  await expect(slashPanel).toBeVisible({ timeout: 10000 });
}

export async function insertInlineGridViaSlash(page: Page, docViewId: string, line: number = 0): Promise<void> {
  const editor = editorForView(page, docViewId);
  await expect(editor).toBeVisible({ timeout: 15000 });

  // Retry the slash-menu → grid-block chain on slow CI: the click may not
  // always produce a grid block (re-render race, focus issue, dialog intercept).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await openSlashMenuInEditor(page, editor, line);
      await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click({ force: true });

      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await expect(dialog)
          .not.toBeVisible({ timeout: 5000 })
          .catch(() => undefined);
      }

      await expect(databaseBlocks(editor).first()).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1500);
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      // Clean up leftover "/" text and retry
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(500);
      await page.keyboard.press('Home').catch(() => undefined);
      await page.keyboard.press('Shift+End').catch(() => undefined);
      await page.keyboard.press('Backspace').catch(() => undefined);
      await page.waitForTimeout(2000);
    }
  }
}

export async function insertLinkedGridViaSlash(
  page: Page,
  docViewId: string,
  databaseName: string,
  line: number = 0
): Promise<void> {
  const editor = editorForView(page, docViewId);
  await expect(editor).toBeVisible({ timeout: 15000 });

  // The database picker loads its list from the cached outline at open time.
  // If the outline hasn't propagated the renamed database yet, the picker will
  // show "No databases found". We also retry if the picker itself fails to
  // appear — on slow CI the slash-menu click → picker-open chain is racy.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await openSlashMenuInEditor(page, editor, line);
      await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('linkedGrid')).first().click({ force: true });
      await expect(page.getByText('Link to an existing database')).toBeVisible({ timeout: 10000 });

      const loadingText = page.getByText('Loading...');
      if ((await loadingText.count()) > 0) {
        await expect(loadingText).not.toBeVisible({ timeout: 15000 });
      }

      const popover = page.locator('.MuiPopover-paper').last();
      await expect(popover).toBeVisible({ timeout: 10000 });

      const searchInput = popover.locator('input[placeholder*="Search"]');
      if ((await searchInput.count()) > 0) {
        await searchInput.clear();
        await searchInput.fill(databaseName);
        await page.waitForTimeout(1500);
      }

      const matchCount = await popover.getByText(databaseName, { exact: false }).count();
      if (matchCount > 0) {
        await popover.getByText(databaseName, { exact: false }).first().click({ force: true });
        await page.waitForTimeout(2000);
        return;
      }
    } catch (e) {
      if (attempt === 2) throw e;
      // Fall through to cleanup + retry below
    }

    // Picker didn't appear or database not found — close any open popovers and
    // clean up the current line before retrying. Escape closes popovers,
    // then select-all + delete removes any leftover "/" text.
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
    await page.keyboard.press('Home').catch(() => undefined);
    await page.keyboard.press('Shift+End').catch(() => undefined);
    await page.keyboard.press('Backspace').catch(() => undefined);
    await page.waitForTimeout(3000);
  }

  throw new Error(`Database "${databaseName}" not found in linked database picker after multiple retries`);
}

export async function editFirstGridCell(page: Page, gridBlock: Locator, text: string): Promise<void> {
  const firstCell = gridBlock.locator('[data-testid^="grid-cell-"]').first();
  await expect(firstCell).toBeVisible({ timeout: 15000 });
  await firstCell.click({ force: true });
  await page.waitForTimeout(300);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => firstGridCellText(gridBlock), {
      timeout: 15000,
      message: `Expected first grid cell to contain "${text}" after editing`,
    })
    .toContain(text);
}

export async function firstGridCellText(gridBlock: Locator): Promise<string> {
  return (await gridBlock.locator('[data-testid^="grid-cell-"]').first().innerText()).trim();
}

export async function addNameIsNotEmptyFilterToBlock(page: Page, gridBlock: Locator): Promise<void> {
  await gridBlock.getByTestId('database-actions-filter').click({ force: true });

  const popoverContent = page.locator('[data-slot="popover-content"]').last();
  await expect(popoverContent).toBeVisible({ timeout: 10000 });
  await popoverContent
    .locator('[data-item-id]')
    .filter({ hasText: /^Name$/ })
    .first()
    .click({ force: true });
  await page.waitForTimeout(1000);

  await expect(gridBlock.getByTestId('database-filter-condition').first()).toBeVisible({ timeout: 10000 });
  await gridBlock.getByTestId('database-filter-condition').first().click({ force: true });
  await page.waitForTimeout(500);
  await changeFilterCondition(page, TextFilterCondition.TextIsNotEmpty);
  await page.waitForTimeout(1000);
}

export async function addDoneCheckedFilterToBlock(page: Page, gridBlock: Locator): Promise<void> {
  await gridBlock.getByTestId('database-actions-filter').click({ force: true });

  const popoverContent = page.locator('[data-slot="popover-content"]').last();
  await expect(popoverContent).toBeVisible({ timeout: 10000 });
  await popoverContent
    .locator('[data-item-id]')
    .filter({ hasText: /^Done$/ })
    .first()
    .click({ force: true });
  await page.waitForTimeout(1000);

  await expect(gridBlock.getByTestId('database-filter-condition').first()).toBeVisible({ timeout: 10000 });
  await gridBlock.getByTestId('database-filter-condition').first().click({ force: true });
  await page.waitForTimeout(500);
  await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
  await page.waitForTimeout(1000);
}

export async function expectNoActiveFilters(gridBlock: Locator): Promise<void> {
  await expect(gridBlock.getByTestId('database-filter-condition')).toHaveCount(0);
  await expect(gridBlock.getByTestId('advanced-filters-badge')).toHaveCount(0);
  await expect(gridBlock.getByTestId('database-grid').locator('[data-testid^="grid-row-"]').first()).toBeVisible({
    timeout: 10000,
  });
}

export async function createStandaloneGridFromSidebar(page: Page): Promise<void> {
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(1000);
  await AddPageSelectors.addGridButton(page).click({ force: true });
  await page.waitForTimeout(5000);
}

export async function checkDoneFieldInCurrentGrid(page: Page, rowIndex: number = 0): Promise<void> {
  const doneFieldId = await getFieldIdByName(page, 'Done');
  if (!doneFieldId) {
    throw new Error('Failed to find Done field in current grid');
  }

  await toggleCheckbox(page, doneFieldId, rowIndex);
}

export async function deletePageByExactText(page: Page, pageName: string): Promise<void> {
  const matchingPages = pageNamesByExactText(page, pageName);
  const initialCount = await matchingPages.count();
  const pageItem = pageItemByExactText(page, pageName, true);
  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.scrollIntoViewIfNeeded();
  await pageItem.hover({ force: true });
  await page.waitForTimeout(500);
  await pageItem.getByTestId('page-more-actions').first().click({ force: true });
  await expect(ViewActionSelectors.deleteButton(page)).toBeVisible({ timeout: 10000 });
  await ViewActionSelectors.deleteButton(page).click({ force: true });

  const confirmButton = ModalSelectors.confirmDeleteButton(page);
  if ((await confirmButton.count()) > 0) {
    await confirmButton.click({ force: true });
  }

  await expect(matchingPages).toHaveCount(Math.max(initialCount - 1, 0), { timeout: 30000 });
  await page.waitForTimeout(1500);
}

export async function duplicatePageByExactText(page: Page, pageName: string, last: boolean = false): Promise<void> {
  const pageItem = pageItemByExactText(page, pageName, last);
  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.scrollIntoViewIfNeeded();
  await pageItem.hover({ force: true });
  await page.waitForTimeout(500);

  const moreActionsButton = pageItem.getByTestId('page-more-actions').first();
  await expect(moreActionsButton).toBeVisible({ timeout: 10000 });
  await moreActionsButton.click({ force: true });

  const duplicateButton = ViewActionSelectors.duplicateButton(page);
  await expect(duplicateButton).toBeVisible({ timeout: 10000 });
  await duplicateButton.click({ force: true });

  const blockingLoader = page.getByTestId('blocking-loader');
  await blockingLoader.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);

  if ((await blockingLoader.count()) > 0) {
    await expect(blockingLoader)
      .toBeHidden({ timeout: 10000 })
      .catch(() => undefined);
  }

  await page.waitForTimeout(2000);
}

export async function renamePageByExactText(
  page: Page,
  currentName: string,
  nextName: string,
  last: boolean = false
): Promise<void> {
  const pageItem = pageItemByExactText(page, currentName, last);
  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.scrollIntoViewIfNeeded();
  await pageItem.hover({ force: true });
  await page.waitForTimeout(500);

  const moreActionsButton = pageItem.getByTestId('page-more-actions').first();
  await expect(moreActionsButton).toBeVisible({ timeout: 10000 });
  await moreActionsButton.click({ force: true });

  const renameButton = ViewActionSelectors.renameButton(page);
  await expect(renameButton).toBeVisible({ timeout: 10000 });
  await renameButton.click({ force: true });

  const renameInput = ModalSelectors.renameInput(page);
  await expect(renameInput).toBeVisible({ timeout: 10000 });
  await renameInput.clear();
  await renameInput.fill(nextName);
  await ModalSelectors.renameSaveButton(page).click({ force: true });

  await expect(pageNamesByExactText(page, nextName)).toHaveCount(1, { timeout: 30000 });
  await page.waitForTimeout(1500);
}
