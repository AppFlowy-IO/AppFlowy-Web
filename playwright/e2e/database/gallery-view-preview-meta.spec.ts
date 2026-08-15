import { expect, type Page, test } from '@playwright/test';

import { FieldType } from '../../../src/application/database-yjs/database.type';
import { GalleryCardPreview } from '../../../src/application/types';
import {
  activeDatabaseViewId,
  addGalleryView,
  chooseGalleryCardPreview,
  chooseGalleryRowEmoji,
  closeDatabaseMenus,
  createFieldDirect,
  getActiveRowIds,
  openGalleryRow,
  openGallerySettings,
  seedPrimaryTitlesDirect,
  setCellDirect,
  setGalleryRowMetaDirect,
  switchToDatabaseView,
  toggleGalleryFitImage,
} from '../../support/gallery-test-helpers';
import {
  generateRandomEmail,
  getPrimaryFieldId,
  loginAndCreateGrid,
  setupPageErrorHandling,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { renameCurrentDatabasePage } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape, openRowDetail, typeInRowDocument } from '../../support/row-detail-helpers';
import { DatabaseGallerySelectors, DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';

const IMAGE_URL = 'https://example.com/gallery-preview.png';

async function routePreviewImage(page: Page): Promise<void> {
  await page.route('https://example.com/gallery-*.png', async (route) => {
    await route.fulfill({
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAwMAAAAwBAQDJ/pLvAAAAAElFTkSuQmCC',
        'base64'
      ),
      contentType: 'image/png',
      status: 200,
    });
  });
}

async function addImageLinkToOpenRow(page: Page, imageUrl: string): Promise<void> {
  const dialog = RowDetailSelectors.modal(page).last();
  const scrollContainer = dialog.locator('.appflowy-scroll-container');

  if ((await scrollContainer.count()) > 0) {
    await scrollContainer.evaluate((element) => element.scrollTo(0, 9999));
  }

  const editor = dialog.locator('[data-testid="editor-content"], [role="textbox"][contenteditable="true"]').first();

  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click({ force: true });
  await page.keyboard.type('/image', { delay: 30 });
  await page.getByTestId('slash-menu-image').click({ force: true });
  await expect(page.getByTestId('slash-panel')).toBeHidden();

  const popover = page.locator('.MuiPopover-root:visible').last();

  await expect(popover).toBeVisible({ timeout: 10_000 });
  const embedLinkTab = popover.getByRole('tab', { name: 'Embed link' });

  await embedLinkTab.click();
  await expect(embedLinkTab).toHaveAttribute('aria-selected', 'true');
  const input = popover.getByPlaceholder('Paste or type an image link');

  await expect(input).toBeVisible();
  await input.fill(imageUrl);
  await input.press('Enter');
  await expect(popover).toBeHidden({ timeout: 10_000 });
}

test.describe('Database Gallery previews and row metadata (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await routePreviewImage(page);
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_gallery_card_preview_test.dart: Page content uses the first image in the row document', async ({
    page,
  }) => {
    await seedPrimaryTitlesDirect(page, ['Page content row']);
    await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];

    await openGalleryRow(page, rowId);
    await addImageLinkToOpenRow(page, IMAGE_URL);
    await closeRowDetailWithEscape(page);

    await openGallerySettings(page);
    await chooseGalleryCardPreview(page, GalleryCardPreview.PageContent);
    await closeDatabaseMenus(page);
    await expect(DatabaseGallerySelectors.previewImageByRowId(page, rowId)).toHaveAttribute('src', IMAGE_URL, {
      timeout: 30_000,
    });
  });

  test('database_gallery_card_preview_test.dart: Files & media preview and fit-image persist', async ({ page }) => {
    const rowId = (await getActiveRowIds(page))[0];
    const mediaFieldId = await createFieldDirect(page, {
      fieldType: FieldType.Media,
      name: 'Files',
    });

    await setCellDirect(page, rowId, mediaFieldId, FieldType.Media, [
      {
        file_type: 1,
        id: 'gallery-preview-image',
        name: 'gallery-preview.png',
        upload_type: 1,
        url: IMAGE_URL,
      },
    ]);
    const gridViewId = await activeDatabaseViewId(page);
    const galleryViewId = await addGalleryView(page);

    await openGallerySettings(page);
    await chooseGalleryCardPreview(page, GalleryCardPreview.FilesAndMedia);
    expect(await toggleGalleryFitImage(page)).toBe(true);
    await closeDatabaseMenus(page);

    const image = DatabaseGallerySelectors.previewImageByRowId(page, rowId);

    await expect(image).toHaveAttribute('src', IMAGE_URL, { timeout: 30_000 });
    await expect(image).toHaveClass(/object-contain/);

    await switchToDatabaseView(page, gridViewId, 'Grid');
    await switchToDatabaseView(page, galleryViewId, 'Gallery');
    await expect(DatabaseGallerySelectors.previewByRowId(page, rowId)).toHaveAttribute(
      'data-gallery-preview',
      String(GalleryCardPreview.FilesAndMedia)
    );
    await expect(DatabaseGallerySelectors.previewImageByRowId(page, rowId)).toHaveClass(/object-contain/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseGallerySelectors.previewByRowId(page, rowId)).toHaveAttribute(
      'data-gallery-preview',
      String(GalleryCardPreview.FilesAndMedia)
    );
    await expect(DatabaseGallerySelectors.previewImageByRowId(page, rowId)).toHaveClass(/object-contain/);
  });

  test('database_gallery_row_cover.dart: row cover is rendered as the card preview', async ({ page }) => {
    await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];
    const rowDetail = await openGalleryRow(page, rowId);

    await expect(rowDetail.locator('.row-header-cover img')).toHaveCount(0);
    await rowDetail.getByTestId('row-title-input').hover();
    const addCover = rowDetail.getByRole('button', { name: 'Add Cover', exact: true });

    await expect(addCover).toBeVisible();
    await addCover.click();
    await expect(rowDetail.locator('.row-header-cover img')).toBeVisible({ timeout: 20_000 });
    await closeRowDetailWithEscape(page);

    const image = DatabaseGallerySelectors.previewImageByRowId(page, rowId);

    await expect(image).toBeVisible({ timeout: 20_000 });
    await expect(image).toHaveAttribute('src', '/covers/m_cover_image_1.png');
  });

  test('database_gallery_row_document_indicator.dart: editing a row document from Gallery shows document indicator', async ({
    page,
  }) => {
    await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];

    await openGalleryRow(page, rowId);
    await typeInRowDocument(page, 'Gallery row document');
    await closeRowDetailWithEscape(page);
    await expect(page.getByTestId(`gallery-row-document-icon-${rowId}`)).toBeVisible({ timeout: 20_000 });
    await expect(DatabaseGallerySelectors.titleByRowId(page, rowId)).toHaveAttribute(
      'data-primary-indicator',
      'document'
    );
  });

  test('database_gallery_row_document_indicator_from_grid.dart: document indicator propagates from Grid to Gallery', async ({
    page,
  }) => {
    const rowId = (await getActiveRowIds(page))[0];

    await openRowDetail(page, 0);
    await typeInRowDocument(page, 'Grid-created document');
    await closeRowDetailWithEscape(page);
    await addGalleryView(page);
    await expect(page.getByTestId(`gallery-row-document-icon-${rowId}`)).toBeVisible({ timeout: 20_000 });
  });

  test('database_gallery_row_icon_test.dart: emoji is visible on gallery card', async ({ page }) => {
    await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];
    const emoji = await chooseGalleryRowEmoji(page, rowId, 0);

    await expect(DatabaseGallerySelectors.titleByRowId(page, rowId)).toContainText(emoji);
    await expect(DatabaseGallerySelectors.titleByRowId(page, rowId)).toHaveAttribute('data-primary-indicator', 'icon');
  });

  test('database_gallery_row_icon_test.dart: document indicator appears after row content is added', async ({
    page,
  }) => {
    await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];

    await setGalleryRowMetaDirect(page, rowId, { isDocumentEmpty: false });
    await expect(page.getByTestId(`gallery-row-document-icon-${rowId}`)).toBeVisible();
  });

  test('database_gallery_row_icon_test.dart: emoji takes priority over document indicator', async ({ page }) => {
    await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];

    await setGalleryRowMetaDirect(page, rowId, { isDocumentEmpty: false });
    const emoji = await chooseGalleryRowEmoji(page, rowId, 1);

    await expect(DatabaseGallerySelectors.titleByRowId(page, rowId)).toContainText(emoji);
    await expect(DatabaseGallerySelectors.titleByRowId(page, rowId)).toHaveAttribute('data-primary-indicator', 'icon');
    await expect(page.getByTestId(`gallery-row-document-icon-${rowId}`)).toHaveCount(0);
  });

  test('database_gallery_row_icon_test.dart: Grid and Gallery show the same row emoji', async ({ page }) => {
    const gridViewId = await activeDatabaseViewId(page);
    const galleryViewId = await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];
    const emoji = await chooseGalleryRowEmoji(page, rowId, 2);

    await switchToDatabaseView(page, gridViewId, 'Grid');
    await expect(DatabaseGridSelectors.rowById(page, rowId).locator('.custom-icon')).toContainText(emoji);
    await switchToDatabaseView(page, galleryViewId, 'Gallery');
    await expect(DatabaseGallerySelectors.titleByRowId(page, rowId)).toContainText(emoji);
  });

  test('document_linked_gallery_test.dart: displays rows from source database', async ({ page }) => {
    const sourceName = `GallerySource_${Date.now()}`;
    const primaryFieldId = await getPrimaryFieldId(page);

    await renameCurrentDatabasePage(page, sourceName);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Gallery Row 1');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Gallery Row 2');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Gallery Row 3');
    const documentViewId = await createDocumentPageAndNavigate(page);

    await insertLinkedDatabaseViaSlash(page, documentViewId, sourceName, 'Gallery');

    const editor = page.locator(`#editor-${documentViewId}`);
    const embeddedGallery = editor.getByTestId('database-gallery');

    await expect(embeddedGallery).toBeVisible({ timeout: 30_000 });
    await expect(embeddedGallery.locator('.gallery-card-title')).toHaveText([
      'Gallery Row 1',
      'Gallery Row 2',
      'Gallery Row 3',
    ]);
    await expect(editor.locator('[data-block-type="gallery"]')).toBeVisible();
  });
});
