import { expect, test } from '@playwright/test';

import { addRows } from '../../support/field-type-helpers';
import { addGalleryView, getActiveRowIds, seedPrimaryTitlesDirect } from '../../support/gallery-test-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { DatabaseGallerySelectors } from '../../support/selectors';

test.describe('Database Gallery lazy loading (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 800, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_gallery_lazy_load_test.dart: gallery loads initial rows and supports pagination', async ({ page }) => {
    test.setTimeout(300_000);

    const desiredRows = 80;
    const rowsToAdd = desiredRows - (await getActiveRowIds(page)).length;

    await addRows(page, rowsToAdd);
    await expect.poll(() => getActiveRowIds(page), { timeout: 60_000 }).toHaveLength(desiredRows);
    await seedPrimaryTitlesDirect(
      page,
      Array.from({ length: desiredRows }, (_, index) => `Gallery Item ${index + 1}`)
    );
    await addGalleryView(page);

    await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(50, { timeout: 30_000 });
    await expect(DatabaseGallerySelectors.titles(page).first()).toHaveText('Gallery Item 1');

    const gallery = DatabaseGallerySelectors.gallery(page);

    for (
      let attempt = 0;
      attempt < 10 && (await DatabaseGallerySelectors.cards(page).count()) < desiredRows;
      attempt += 1
    ) {
      await gallery.evaluate((element) => {
        const pageScroller = element.closest('.appflowy-scroll-container');
        const scrollElement =
          element.scrollHeight > element.clientHeight
            ? element
            : pageScroller instanceof HTMLElement
            ? pageScroller
            : element;

        scrollElement.scrollTop = scrollElement.scrollHeight;
        scrollElement.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(300);
    }

    await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(desiredRows, { timeout: 30_000 });
    await expect(DatabaseGallerySelectors.titles(page).last()).toHaveText(`Gallery Item ${desiredRows}`);
  });
});
