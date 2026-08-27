import { expect, type Page, test } from '@playwright/test';

import { FieldType, FieldVisibility } from '../../../src/application/database-yjs/database.type';
import { GalleryCardPreview, GalleryCardSize } from '../../../src/application/types';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import {
  activeDatabaseViewId,
  addGalleryView,
  addRowsFromGallery,
  chooseGalleryCardPreview,
  chooseGalleryCardSize,
  closeDatabaseMenus,
  createFieldDirect,
  expectGalleryTitles,
  getActiveDatabaseFields,
  getActiveRowIds,
  openGalleryRow,
  openGallerySettings,
  seedPrimaryTitlesDirect,
  setCellDirect,
  switchToDatabaseView,
  toggleGalleryFitImage,
} from '../../support/gallery-test-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { addSortByFieldName } from '../../support/sort-test-helpers';
import {
  DatabaseGallerySelectors,
  DatabaseViewSelectors,
  itemDirectChildPageItems,
  PageSelectors,
  RowDetailSelectors,
} from '../../support/selectors';

async function openDatabaseProperties(page: Page): Promise<void> {
  const trigger = page.getByTestId('database-properties-settings-trigger');

  if (!(await trigger.isVisible().catch(() => false))) await page.getByTestId('database-actions-settings').click();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
}

async function dragGalleryTile(page: Page, sourceRowId: string, targetRowId: string, edge: 'left' | 'right') {
  const source = DatabaseGallerySelectors.tileByRowId(page, sourceRowId);
  const target = DatabaseGallerySelectors.tileByRowId(page, targetRowId);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) throw new Error('Gallery drag source or target had no layout box');

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(
    edge === 'left' ? targetBox.x + 3 : targetBox.x + targetBox.width - 3,
    targetBox.y + targetBox.height / 2,
    { steps: 20 }
  );
  await page.waitForTimeout(250);
  await page.mouse.up();
}

test.describe('Standalone Gallery creation (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
  });

  test('database_gallery_basic.dart: creates a standalone Gallery container with one Gallery child', async ({
    page,
    request,
  }) => {
    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Gallery', {
      createWaitMs: 8_000,
      verify: async (currentPage) => {
        await expect(DatabaseGallerySelectors.gallery(currentPage)).toBeVisible({ timeout: 30_000 });
      },
    });

    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Gallery');
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toHaveCount(0);
    await expect.poll(() => DatabaseGallerySelectors.cards(page).count()).toBeGreaterThan(0);

    const container = PageSelectors.itemByName(page, 'New Database');

    await expect(container).toBeVisible({ timeout: 30_000 });
    const children = container.locator(itemDirectChildPageItems(true));

    if ((await children.count()) === 0) {
      await container.locator('[data-testid="outline-toggle-expand"]').first().click({ force: true });
    }
    await expect(children).toHaveCount(1, { timeout: 30_000 });
    await expect(children.first().getByTestId('page-name')).toHaveText('Gallery');
    await expect(children.first().getByTestId('database-view-dot')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-item-gallery').getByTestId('gallery-view-icon')).toBeVisible();

    const galleryUrl = page.url();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(galleryUrl);
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toHaveCount(0);
  });
});

test.describe('Database Gallery core interactions (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_gallery_basic.dart: gallery view can be created from grid tab bar', async ({ page }) => {
    const gridViewId = await activeDatabaseViewId(page);
    const seededRows = await getActiveRowIds(page);
    const galleryViewId = await addGalleryView(page);

    expect(galleryViewId).not.toBe(gridViewId);
    await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(seededRows.length);
    await switchToDatabaseView(page, gridViewId, 'Grid');
    await switchToDatabaseView(page, galleryViewId, 'Gallery');
    await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(seededRows.length);
  });

  test('database_gallery_card_content.dart: shows cover area and primary field only', async ({ page }) => {
    const rowIds = await getActiveRowIds(page);

    await addGalleryView(page);
    const fields = await getActiveDatabaseFields(page);
    const primary = fields.find((field) => field.isPrimary);

    expect(primary).toBeTruthy();
    expect(fields.filter((field) => field.visibility === FieldVisibility.AlwaysShown).map((field) => field.id)).toEqual([
      primary!.id,
    ]);
    await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(rowIds.length);
    await expect(DatabaseGallerySelectors.grid(page)).toHaveAttribute('data-column-count', '3');
    await expect(DatabaseGallerySelectors.previewByRowId(page, rowIds[0])).toHaveCSS('height', '150px');
    await expect(DatabaseGallerySelectors.titleByRowId(page, rowIds[0])).toBeVisible();
    await expect(DatabaseGallerySelectors.propertiesByRowId(page, rowIds[0])).toHaveCount(0);
  });

  test('database_gallery_card_size_test.dart: can open gallery settings and change card size', async ({ page }) => {
    await addGalleryView(page);
    const firstRowId = (await getActiveRowIds(page))[0];

    await openGallerySettings(page);
    await chooseGalleryCardSize(page, GalleryCardSize.Small);
    await expect(DatabaseGallerySelectors.previewByRowId(page, firstRowId)).toHaveCSS('height', '120px');
    await chooseGalleryCardSize(page, GalleryCardSize.Large);
    await expect(DatabaseGallerySelectors.previewByRowId(page, firstRowId)).toHaveCSS('height', '180px');
  });

  test('database_gallery_card_size_test.dart: card size setting persists after reopening settings', async ({ page }) => {
    await addGalleryView(page);
    await openGallerySettings(page);
    await chooseGalleryCardSize(page, GalleryCardSize.Large);
    await closeDatabaseMenus(page);
    await openGallerySettings(page);
    await expect(page.getByTestId('gallery-card-size-trigger')).toHaveText('Large');
    await closeDatabaseMenus(page);
    await expect(DatabaseGallerySelectors.grid(page)).toHaveAttribute('data-card-size', String(GalleryCardSize.Large));
  });

  test('database_gallery_card_size_test.dart: gallery settings persist after closing and reopening the view', async ({
    page,
  }) => {
    const gridViewId = await activeDatabaseViewId(page);
    const galleryViewId = await addGalleryView(page);

    await openGallerySettings(page);
    await chooseGalleryCardSize(page, GalleryCardSize.Large);
    await chooseGalleryCardPreview(page, GalleryCardPreview.PageContent);
    expect(await toggleGalleryFitImage(page)).toBe(true);
    await closeDatabaseMenus(page);
    await switchToDatabaseView(page, gridViewId, 'Grid');
    await switchToDatabaseView(page, galleryViewId, 'Gallery');
    await expect(DatabaseGallerySelectors.grid(page)).toHaveAttribute('data-card-size', String(GalleryCardSize.Large));
    await expect(DatabaseGallerySelectors.grid(page).locator('[data-gallery-preview]').first()).toHaveAttribute(
      'data-gallery-preview',
      String(GalleryCardPreview.PageContent)
    );
    await openGallerySettings(page);
    await expect(page.getByTestId('gallery-card-size-trigger')).toHaveText('Large');
    await expect(page.getByTestId('gallery-card-preview-trigger')).toHaveText('Page content');
    await expect(page.getByTestId('gallery-fit-image-switch')).toHaveAttribute('data-state', 'checked');
    await closeDatabaseMenus(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseGallerySelectors.grid(page)).toHaveAttribute('data-card-size', String(GalleryCardSize.Large));
    await expect(DatabaseGallerySelectors.grid(page).locator('[data-gallery-preview]').first()).toHaveAttribute(
      'data-gallery-preview',
      String(GalleryCardPreview.PageContent)
    );
    await openGallerySettings(page);
    await expect(page.getByTestId('gallery-card-size-trigger')).toHaveText('Large');
    await expect(page.getByTestId('gallery-card-preview-trigger')).toHaveText('Page content');
    await expect(page.getByTestId('gallery-fit-image-switch')).toHaveAttribute('data-state', 'checked');
  });

  test('database_gallery_create_from_new_tile.dart: create row from trailing tile and appears at end', async ({
    page,
  }) => {
    await addGalleryView(page);
    const before = await getActiveRowIds(page);

    await addRowsFromGallery(page, 1);
    const after = await getActiveRowIds(page);

    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
    await expect(DatabaseGallerySelectors.titleByRowId(page, after.at(-1)!)).toHaveText('Untitled');
    await expect(DatabaseGallerySelectors.newRowButton(page)).toBeVisible();
  });

  test('database_gallery_default_visibility_test.dart: new Gallery shows primary field and hides secondary fields', async ({
    page,
  }) => {
    await addGalleryView(page);
    const fields = await getActiveDatabaseFields(page);

    expect(fields.find((field) => field.isPrimary)?.visibility).toBe(FieldVisibility.AlwaysShown);
    expect(
      fields.filter((field) => !field.isPrimary).every((field) => field.visibility === FieldVisibility.AlwaysHidden)
    ).toBe(true);

    await openDatabaseProperties(page);
    for (const field of fields) {
      await expect(page.getByTestId(`database-property-visibility-${field.id}`)).toHaveAttribute(
        'aria-label',
        field.isPrimary ? /^Hide / : /^Show /
      );
    }
  });

  test('database_gallery_default_visibility_test.dart: toggling hidden fields makes them visible in gallery view', async ({
    page,
  }) => {
    await addGalleryView(page);
    const rowIds = await getActiveRowIds(page);
    const fieldIds: string[] = [];

    for (let index = 0; index < 6; index += 1) {
      const fieldId = await createFieldDirect(page, {
        fieldType: FieldType.RichText,
        name: `Gallery property ${index + 1}`,
      });

      fieldIds.push(fieldId);
      await setCellDirect(page, rowIds[0], fieldId, FieldType.RichText, `Visible value ${index + 1}`);
    }

    await expect
      .poll(async () => (await getActiveDatabaseFields(page)).filter((field) => fieldIds.includes(field.id)).length)
      .toBe(fieldIds.length);
    for (const fieldId of fieldIds) {
      await expect(DatabaseGallerySelectors.fieldsForField(page, fieldId)).toHaveCount(0);
    }

    for (const fieldId of fieldIds) {
      await openDatabaseProperties(page);
      const visibilityToggle = page.getByTestId(`database-property-visibility-${fieldId}`);

      await expect(visibilityToggle).toHaveAttribute('aria-label', /^Show /);
      await visibilityToggle.click();
      await expect
        .poll(async () => (await getActiveDatabaseFields(page)).find((field) => field.id === fieldId)?.visibility)
        .toBe(FieldVisibility.AlwaysShown);
    }
    await closeDatabaseMenus(page);

    const firstCard = DatabaseGallerySelectors.cardByRowId(page, rowIds[0]);

    await firstCard.scrollIntoViewIfNeeded();
    for (const fieldId of fieldIds) {
      await expect(DatabaseGallerySelectors.fieldsForField(page, fieldId)).toHaveCount(rowIds.length);
      const field = page.getByTestId(`gallery-field-${fieldId}-${rowIds[0]}`);

      await expect(field).toBeVisible();
      const geometry = await field.evaluate((element) => {
        const fieldRect = element.getBoundingClientRect();
        const cardRect = element.closest('[data-testid^="gallery-card-"]')?.getBoundingClientRect();

        return {
          height: fieldRect.height,
          isClipped:
            !cardRect ||
            fieldRect.left < cardRect.left ||
            fieldRect.right > cardRect.right ||
            fieldRect.top < cardRect.top ||
            fieldRect.bottom > cardRect.bottom,
          width: fieldRect.width,
        };
      });

      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.height).toBeGreaterThan(0);
      expect(geometry.isClipped).toBe(false);
    }
  });

  test('database_gallery_inline_title_edit.dart: edit accessory enables title editing', async ({ page }) => {
    await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];
    const card = DatabaseGallerySelectors.cardByRowId(page, rowId);

    await card.hover();
    await DatabaseGallerySelectors.editButtonByRowId(page, rowId).click();
    const editor = DatabaseGallerySelectors.titleByRowId(page, rowId).locator('textarea');

    await expect(editor).toBeVisible();
    await editor.fill('Inline Gallery title');
    await editor.press('Enter');
    await expect(DatabaseGallerySelectors.titleByRowId(page, rowId)).toHaveText('Inline Gallery title');
  });

  test('database_gallery_open_row.dart: tap card opens row detail', async ({ page }) => {
    await addGalleryView(page);
    const rowId = (await getActiveRowIds(page))[0];

    await openGalleryRow(page, rowId);
    await expect(RowDetailSelectors.modal(page)).toBeVisible();
    await closeRowDetailWithEscape(page);
    await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible();
  });

  test('database_gallery_reorder_test.dart: reorder persists after reopening gallery', async ({ page }) => {
    const gridViewId = await activeDatabaseViewId(page);
    await seedPrimaryTitlesDirect(page, ['Alpha', 'Bravo', 'Charlie']);
    const galleryViewId = await addGalleryView(page);
    const [alphaId, bravoId, charlieId] = await getActiveRowIds(page);

    await expectGalleryTitles(page, ['Alpha', 'Bravo', 'Charlie']);
    await dragGalleryTile(page, alphaId, charlieId, 'right');
    await expectGalleryTitles(page, ['Bravo', 'Charlie', 'Alpha']);

    await switchToDatabaseView(page, gridViewId, 'Grid');
    await switchToDatabaseView(page, galleryViewId, 'Gallery');
    await expectGalleryTitles(page, ['Bravo', 'Charlie', 'Alpha']);
    expect(await getActiveRowIds(page)).toEqual([bravoId, charlieId, alphaId]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible({ timeout: 30_000 });
    await expectGalleryTitles(page, ['Bravo', 'Charlie', 'Alpha']);
    expect(await getActiveRowIds(page)).toEqual([bravoId, charlieId, alphaId]);
  });

  test('database_gallery_row_more_actions.dart: duplicate row from hover menu increases row count', async ({ page }) => {
    await addGalleryView(page);
    const before = await getActiveRowIds(page);
    const rowId = before[0];

    await DatabaseGallerySelectors.cardByRowId(page, rowId).hover();
    await DatabaseGallerySelectors.moreButtonByRowId(page, rowId).click();
    await page.getByTestId('gallery-row-duplicate').click();
    await expect.poll(() => getActiveRowIds(page)).toHaveLength(before.length + 1);
    await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(before.length + 1);
  });

  test('database_gallery_row_more_actions.dart: delete row from hover menu decreases row count', async ({ page }) => {
    await addGalleryView(page);
    const before = await getActiveRowIds(page);
    const rowId = before[0];

    await DatabaseGallerySelectors.cardByRowId(page, rowId).hover();
    await DatabaseGallerySelectors.moreButtonByRowId(page, rowId).click();
    await page.getByTestId('gallery-row-delete').click();
    await page.getByTestId('delete-row-confirm-button').click();
    await expect.poll(() => getActiveRowIds(page)).toHaveLength(before.length - 1);
    await expect(DatabaseGallerySelectors.cardByRowId(page, rowId)).toHaveCount(0);
  });

  test('database_gallery_sort_test.dart: new card reorders after title edit', async ({ page }) => {
    await seedPrimaryTitlesDirect(page, ['Charlie', 'Delta', 'Echo']);
    await addGalleryView(page);

    await addSortByFieldName(page, 'Name');
    await page.keyboard.press('Escape');
    await expectGalleryTitles(page, ['Charlie', 'Delta', 'Echo']);
    const beforeRowIds = new Set(await getActiveRowIds(page));
    await addRowsFromGallery(page, 1);
    const targetId = (await getActiveRowIds(page)).find((rowId) => !beforeRowIds.has(rowId));

    if (!targetId) throw new Error('Gallery did not create a new row');

    await DatabaseGallerySelectors.cardByRowId(page, targetId).hover();
    await DatabaseGallerySelectors.editButtonByRowId(page, targetId).click();
    const editor = DatabaseGallerySelectors.titleByRowId(page, targetId).locator('textarea');

    await editor.fill('Aaron');
    await editor.press('Enter');
    await expectGalleryTitles(page, ['Aaron', 'Charlie', 'Delta', 'Echo']);
  });
});
