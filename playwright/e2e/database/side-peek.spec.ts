import { expect, test, type Page } from '@playwright/test';

import { SortCondition } from '../../../src/application/database-yjs/database.type';
import { addFeedView } from '../../support/feed-test-helpers';
import {
  getPrimaryFieldId,
  loginAndCreateGrid,
  TextFilterCondition,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import {
  addGalleryView,
  createFieldDirect,
  seedPrimaryTitlesDirect,
  setCellDirect,
  setFiltersDirect,
  setSortsDirect,
} from '../../support/gallery-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import {
  closeRowDetail,
  getVisibleDataRowIds,
  openRowDetail,
  openRowDetailByRowId,
  typeInRowDocument,
} from '../../support/row-detail-helpers';
import {
  DatabaseFeedSelectors,
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  FieldType,
  HeaderSelectors,
  RowDetailSelectors,
} from '../../support/selectors';
import { dragPeekResizer } from '../../support/side-peek-helpers';
import { generateRandomEmail } from '../../support/test-config';

async function chooseMode(page: Page, mode: 'side' | 'center') {
  await page.getByTestId('row-peek-mode-menu').click();
  await page.getByTestId(`row-peek-mode-${mode}`).click();
  await expect(RowDetailSelectors.modal(page)).toHaveAttribute('data-peek-mode', mode);
}

async function editEmptyNotes(page: Page, value: string) {
  const detail = RowDetailSelectors.modal(page);

  await detail.getByText('Add Notes', { exact: true }).click();
  const editor = detail.getByTestId('rich-text-cell-editor');

  await expect(editor).toBeVisible();
  await editor.fill(value);
  await expect(editor).toBeFocused();
}

test.describe('Database side peek', () => {
  test('keeps the grid interactive, navigates rows, and preserves the editor across modes and resizing', async ({
    page,
    request,
  }, testInfo) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());
    const fieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, fieldId, 0, 'First task');
    await typeTextIntoCell(page, fieldId, 1, 'Second task');
    await openRowDetail(page);

    const detail = RowDetailSelectors.modal(page);
    const title = detail.getByTestId('row-title-input');

    await expect(detail).toHaveAttribute('data-peek-mode', 'side');
    await expect(page.locator('.MuiBackdrop-root:visible')).toHaveCount(0);
    await expect(page.getByTestId('row-peek-previous')).toBeDisabled();

    // A real grid edit must work without dismissing the nonmodal panel.
    await typeTextIntoCell(page, fieldId, 1, 'Updated second task');
    await expect(title).toHaveText('First task');
    await page.getByTestId('row-peek-next').click();
    await expect(title).toHaveText('Updated second task');
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await expect(title).toHaveText('First task');

    await title.fill('Draft retained across modes');
    // A marker on the DOM node proves the editor was moved, not recreated.
    await title.evaluate((node) => node.setAttribute('data-editor-instance', 'original'));
    await chooseMode(page, 'center');
    await expect(title).toHaveAttribute('data-editor-instance', 'original');
    await expect(title).toHaveText('Draft retained across modes');
    await chooseMode(page, 'side');

    const resizer = page.getByTestId('row-peek-resizer');
    const before = Number(await resizer.getAttribute('aria-valuenow'));

    await dragPeekResizer(page, -70);
    await expect.poll(async () => Number(await resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(before);

    await page.setViewportSize({ width: 900, height: 900 });
    await expect(detail).toHaveAttribute('data-peek-mode', 'center');
    await expect(title).toHaveAttribute('data-editor-instance', 'original');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(detail).toHaveAttribute('data-peek-mode', 'center');
    await chooseMode(page, 'side');
    await expect(title).toHaveAttribute('data-editor-instance', 'original');
    await expect(title).toHaveText('Draft retained across modes');
    await page.screenshot({ path: testInfo.outputPath('side-peek.png') });

    await RowDetailSelectors.modalTitle(page).click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId).first()).toContainText(
      'Draft retained across modes'
    );
  });

  test('retains an oversized title when closing or opening another row until the draft is corrected', async ({
    page,
    request,
  }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());
    await openRowDetail(page);
    const detail = RowDetailSelectors.modal(page);
    const title = detail.getByTestId('row-title-input');
    const oversized = 'x'.repeat(10_001);

    await title.fill(oversized);
    await page.getByTestId('row-detail-close').click();
    await expect(title).toHaveText(oversized);
    await page.getByTestId('row-peek-next').click();
    await expect(title).toHaveText(oversized);
    await chooseMode(page, 'center');
    await expect(title).toHaveText(oversized);
    await chooseMode(page, 'side');
    await title.fill('Corrected title');
    await closeRowDetail(page);
    await openRowDetail(page);
    await expect(title).toHaveText('Corrected title');
  });

  test('saves title and document before opening the row in a new tab and as a full page', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());
    await openRowDetail(page);
    const detail = RowDetailSelectors.modal(page);

    await detail.getByTestId('row-title-input').fill('Peek navigation task');
    await typeInRowDocument(page, 'Document edited in side peek');

    await page.getByTestId('row-peek-mode-menu').click();
    const popupPromise = page.waitForEvent('popup');

    await page.getByTestId('row-peek-new-tab').click();
    const popup = await popupPromise;

    await expect(popup).toHaveURL(/\?v=.+&r=.+/);
    await expect(popup.getByTestId('row-title-input')).toHaveText('Peek navigation task');
    await expect(popup.getByTestId('editor-content')).toContainText('Document edited in side peek');
    await expect(detail).toBeVisible();
    await popup.close();

    await page.getByTestId('row-detail-open-full-page').click();
    await expect(detail).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]r=.+/);
    await expect(page.getByTestId('row-title-input')).toHaveText('Peek navigation task');
    await expect(page.getByTestId('editor-content')).toContainText('Document edited in side peek');
    await page.reload();
    await expect(page.getByTestId('row-title-input')).toHaveText('Peek navigation task');
    await expect(page.getByTestId('editor-content')).toContainText('Document edited in side peek');
  });

  test('saves a focused text property on next, previous shortcut, and close', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());
    const [amber, birch, cedar] = await seedPrimaryTitlesDirect(page, ['Amber', 'Birch', 'Cedar']);
    const notes = await createFieldDirect(page, { name: 'Notes', fieldType: FieldType.RichText });

    await openRowDetailByRowId(page, amber);
    const title = RowDetailSelectors.titleInput(page);

    // Do not blur or press Enter before leaving: navigation must commit the active property editor.
    await editEmptyNotes(page, 'Saved by next button');
    await page.getByTestId('row-peek-next').click();
    await expect(title).toHaveText('Birch');
    await editEmptyNotes(page, 'Saved by previous shortcut');
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await expect(title).toHaveText('Amber');
    await expect(RowDetailSelectors.modal(page)).toContainText('Saved by next button');

    await page.getByTestId('row-peek-next').click();
    await expect(title).toHaveText('Birch');
    await expect(RowDetailSelectors.modal(page)).toContainText('Saved by previous shortcut');
    await page.getByTestId('row-peek-next').click();
    await expect(title).toHaveText('Cedar');
    await editEmptyNotes(page, 'Saved by close button');
    await closeRowDetail(page);

    await page.reload();
    for (const [rowId, value] of [
      [amber, 'Saved by next button'],
      [birch, 'Saved by previous shortcut'],
      [cedar, 'Saved by close button'],
    ]) {
      await expect(DatabaseGridSelectors.cellByIds(page, rowId, notes)).toContainText(value);
    }
  });

  test('follows live filtered and sorted rows and disables navigation when the current row is excluded', async ({
    page,
    request,
  }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());
    const [amber, birch, cedar] = await seedPrimaryTitlesDirect(page, ['Amber', 'Birch', 'Cedar']);
    const primary = await getPrimaryFieldId(page);
    const notes = await createFieldDirect(page, { name: 'Notes', fieldType: FieldType.RichText });

    await setCellDirect(page, amber, notes, FieldType.RichText, 'visible');
    await setCellDirect(page, birch, notes, FieldType.RichText, 'hidden');
    await setCellDirect(page, cedar, notes, FieldType.RichText, 'visible');
    await setFiltersDirect(page, [
      { fieldId: notes, fieldType: FieldType.RichText, condition: TextFilterCondition.TextContains, content: 'visible' },
    ]);
    await expect.poll(() => getVisibleDataRowIds(page)).toEqual([amber, cedar]);
    await openRowDetailByRowId(page, amber);
    const title = RowDetailSelectors.titleInput(page);

    await expect(page.getByTestId('row-peek-previous')).toBeDisabled();
    await page.getByTestId('row-peek-next').click();
    await expect(title).toHaveText('Cedar');
    await expect(page.getByTestId('row-peek-next')).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await expect(title).toHaveText('Amber');

    // Change the underlying data while the peek stays open, as a background edit or sync would.
    await setCellDirect(page, birch, notes, FieldType.RichText, 'visible');
    await expect.poll(() => getVisibleDataRowIds(page)).toEqual([amber, birch, cedar]);
    await page.keyboard.press('ControlOrMeta+Shift+N');
    await expect(title).toHaveText('Birch');
    await setSortsDirect(page, [{ fieldId: primary, condition: SortCondition.Descending }]);
    await expect.poll(() => getVisibleDataRowIds(page)).toEqual([cedar, birch, amber]);
    await page.getByTestId('row-peek-previous').click();
    await expect(title).toHaveText('Cedar');

    await setCellDirect(page, cedar, notes, FieldType.RichText, 'hidden');
    await expect.poll(() => getVisibleDataRowIds(page)).toEqual([birch, amber]);
    await expect(page.getByTestId('row-peek-previous')).toBeDisabled();
    await expect(page.getByTestId('row-peek-next')).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+Shift+N');
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await expect(title).toHaveText('Cedar');

    await closeRowDetail(page);
    await setCellDirect(page, amber, notes, FieldType.RichText, 'hidden');
    await expect.poll(() => getVisibleDataRowIds(page)).toEqual([birch]);
    await openRowDetailByRowId(page, birch);
    await expect(title).toHaveText('Birch');
    await expect(page.getByTestId('row-peek-previous')).toBeDisabled();
    await expect(page.getByTestId('row-peek-next')).toBeDisabled();
  });

  test('retains the document editor and its undo history across side and center peek', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());
    await openRowDetail(page);
    await typeInRowDocument(page, 'Original document');
    const editor = RowDetailSelectors.modal(page).getByTestId('editor-content');

    await page.keyboard.press('Enter');
    await page.keyboard.type('Undo this paragraph');
    await expect(editor).toContainText('Undo this paragraph');
    await editor.evaluate((node) => node.setAttribute('data-editor-instance', 'original-document'));
    await chooseMode(page, 'center');
    await expect(editor).toHaveAttribute('data-editor-instance', 'original-document');
    await chooseMode(page, 'side');
    await expect(editor).toHaveAttribute('data-editor-instance', 'original-document');
    await editor.getByText('Undo this paragraph', { exact: true }).click();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(editor).not.toContainText('Undo this paragraph');
    await expect(editor).toContainText('Original document');
    await closeRowDetail(page);
    await page.reload();
    await openRowDetail(page);
    await expect(editor).toContainText('Original document');
    await expect(editor).not.toContainText('Undo this paragraph');
  });

  test('keeps two browser tabs in independent row editing and undo sessions', async ({ page, request, context }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());
    const [amber, birch] = await seedPrimaryTitlesDirect(page, ['Amber', 'Birch', 'Cedar']);
    const databaseUrl = page.url();

    await openRowDetailByRowId(page, amber);
    await typeInRowDocument(page, 'Amber document');
    const amberEditor = RowDetailSelectors.modal(page).getByTestId('editor-content');

    await amberEditor.evaluate((node) => node.setAttribute('data-editor-instance', 'amber-session'));
    await page.keyboard.press('Enter');
    await page.keyboard.type('Undo Amber only');

    const second = await context.newPage();

    await second.goto(databaseUrl);
    await openRowDetailByRowId(second, birch);
    await typeInRowDocument(second, 'Birch document');
    const birchEditor = RowDetailSelectors.modal(second).getByTestId('editor-content');

    await birchEditor.evaluate((node) => node.setAttribute('data-editor-instance', 'birch-session'));
    await second.keyboard.press('Enter');
    await second.keyboard.type('Birch must stay');

    await page.bringToFront();
    await expect(amberEditor).toHaveAttribute('data-editor-instance', 'amber-session');
    await amberEditor.getByText('Undo Amber only', { exact: true }).click();
    await page.keyboard.press('ControlOrMeta+A');
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe('Amber document\nUndo Amber only');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(amberEditor).not.toContainText('Undo Amber only');
    await expect(amberEditor).toContainText('Amber document');

    await second.bringToFront();
    await expect(birchEditor).toHaveAttribute('data-editor-instance', 'birch-session');
    await expect(birchEditor).toContainText('Birch must stay');
    await closeRowDetail(second);
    await second.close();
    await page.bringToFront();
    await expect(amberEditor).toHaveAttribute('data-editor-instance', 'amber-session');
    await expect(amberEditor).toContainText('Amber document');
  });

  test('inherits a locked document’s readonly state in side and center peek', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());
    const [amber] = await seedPrimaryTitlesDirect(page, ['Amber', 'Birch', 'Cedar']);
    const notes = await createFieldDirect(page, { name: 'Notes', fieldType: FieldType.RichText });

    await setCellDirect(page, amber, notes, FieldType.RichText, 'Protected Notes');
    await openRowDetailByRowId(page, amber);
    await typeInRowDocument(page, 'Protected document');
    await closeRowDetail(page);
    const documentId = await createDocumentPageAndNavigate(page);

    await insertLinkedDatabaseViaSlash(page, documentId, 'New Database', 'Grid');
    await HeaderSelectors.moreActionsButton(page).click();
    await page.getByTestId('more-page-lock').click();
    await expect(page.getByTestId('page-locked-badge')).toBeVisible();
    await page.keyboard.press('Escape');
    await openRowDetailByRowId(page, amber);
    const detail = RowDetailSelectors.modal(page);

    for (const mode of ['side', 'center', 'side'] as const) {
      await chooseMode(page, mode);
      await expect(detail.getByTestId('row-title-input')).toHaveText('Amber');
      await expect(detail.getByTestId('row-title-input')).not.toHaveAttribute('contenteditable', 'true');
      await expect(detail.getByTestId('editor-content')).toHaveAttribute('contenteditable', 'false');
      await expect(detail.getByTestId('editor-content')).toContainText('Protected document');
      await detail.getByText('Protected Notes', { exact: true }).click();
      await expect(detail.getByTestId('rich-text-cell-editor')).toHaveCount(0);
      await expect(page.getByTestId('row-detail-more-actions')).toHaveCount(0);
    }

    await closeRowDetail(page);
    // Unlock only this test-owned document and verify access updates without a reload.
    await HeaderSelectors.moreActionsButton(page).click();
    await page.getByTestId('more-page-lock').click();
    await expect(page.getByTestId('page-locked-badge')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await openRowDetailByRowId(page, amber);
    await expect(detail.getByTestId('row-title-input')).toHaveAttribute('contenteditable', 'true');
    await expect(detail.getByTestId('editor-content')).toHaveAttribute('contenteditable', 'true');
    await expect(page.getByTestId('row-detail-more-actions')).toBeVisible();
  });

  for (const layout of ['List', 'Gallery', 'Feed'] as const) {
    test(`opens ${layout} rows in one side peek and replaces the row from the background view`, async ({
      page,
      request,
    }) => {
      await loginAndCreateGrid(page, request, generateRandomEmail());
      const [amber, birch] = await seedPrimaryTitlesDirect(page, ['Amber', 'Birch', 'Cedar']);

      if (layout === 'Gallery') await addGalleryView(page);
      else if (layout === 'Feed') await addFeedView(page);
      else {
        await DatabaseViewSelectors.addViewButton(page).click();
        await DatabaseViewSelectors.viewTypeOption(page, 'List').click();
        await expect(DatabaseListSelectors.list(page)).toBeVisible();
      }

      const row = (rowId: string) =>
        layout === 'Gallery'
          ? page.getByTestId(`gallery-card-open-${rowId}`)
          : layout === 'Feed'
          ? DatabaseFeedSelectors.titleByRowId(page, rowId)
          : DatabaseListSelectors.rowById(page, rowId);
      const url = page.url();

      await row(amber).click();
      await expect(RowDetailSelectors.modal(page)).toHaveAttribute('data-peek-mode', 'side');
      await expect(RowDetailSelectors.titleInput(page)).toHaveText('Amber');
      await expect(page.locator('.MuiBackdrop-root:visible')).toHaveCount(0);
      await RowDetailSelectors.titleInput(page).fill('Edited Amber');
      await row(birch).click();
      await expect(RowDetailSelectors.titleInput(page)).toHaveText('Birch');
      await expect(RowDetailSelectors.modal(page)).toHaveCount(1);
      await expect(page).toHaveURL(url);
      await closeRowDetail(page);
      await row(amber).click();
      await expect(RowDetailSelectors.titleInput(page)).toHaveText('Edited Amber');
    });
  }
});
