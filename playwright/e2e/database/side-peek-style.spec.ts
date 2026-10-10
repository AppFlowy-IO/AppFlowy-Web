import { expect, test } from '@playwright/test';
import { v5 as uuidv5 } from 'uuid';

import { RowMetaKey } from '../../../src/application/database-yjs/database.type';

import { getPrimaryFieldId, loginAndCreateGrid, typeTextIntoCell } from '../../support/filter-test-helpers';
import { activeDatabaseViewId, setGalleryRowMetaDirect } from '../../support/gallery-test-helpers';
import { getVisibleDataRowIds, openRowDetail } from '../../support/row-detail-helpers';
import { RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test('matches Figma peek typography, icon placement and toolbar reveal across modes', async ({
  page,
  request,
}, testInfo) => {
  await loginAndCreateGrid(page, request, generateRandomEmail());
  const fieldId = await getPrimaryFieldId(page);

  await typeTextIntoCell(page, fieldId, 0, 'Plan the next release');
  const [rowId] = await getVisibleDataRowIds(page);

  await openRowDetail(page);
  const detail = RowDetailSelectors.modal(page);
  const title = detail.getByTestId('row-title-input');
  const close = detail.getByTestId('row-detail-close');
  const controls = detail.locator('.row-peek-optional-actions');

  await expect(detail).toHaveAttribute('data-peek-mode', 'side');
  await expect(title).toHaveCSS('font-size', '28px');
  await expect(title).toHaveCSS('font-weight', '600');
  await expect(title).toHaveCSS('line-height', '40px');
  await expect(close).toHaveCSS('width', '32px');
  await expect(close.locator('svg')).toHaveCSS('width', '20px');
  await expect(detail.locator('.property-label').first()).toHaveCSS('width', '160px');
  await expect(detail.getByTestId('row-detail-header')).toHaveCSS('border-bottom-width', '0px');
  await expect
    .poll(async () => {
      const [panel, heading] = await Promise.all([detail.boundingBox(), title.boundingBox()]);

      return Math.round(heading!.x - panel!.x);
    })
    .toBe(44);

  await title.hover();
  await expect(controls).toHaveCSS('opacity', '0');
  await close.focus();
  await expect(controls).toHaveCSS('opacity', '1');
  await close.hover();
  await detail.getByTestId('row-peek-mode-menu').click();
  await expect(page.getByRole('menu')).toHaveCSS('width', '320px');
  await page.getByTestId('row-peek-mode-center').hover();
  await expect(controls).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');

  await detail.getByTestId('row-peek-mode-menu').click();
  await page.getByTestId('row-peek-mode-center').click();
  await expect(detail.locator('.row-banner')).toHaveAttribute('data-actions-in-header', 'true');
  const bannerActions = detail.locator('.row-peek-banner-actions');

  await bannerActions.hover();
  await expect(bannerActions.getByRole('button')).toHaveText(['Add cover', 'Add icon']);
  const addIcon = bannerActions.getByTestId('add-icon-button');

  await expect(addIcon).toHaveCSS('font-size', '14px');
  await expect(addIcon).toHaveCSS('line-height', '20px');
  await expect(addIcon).toHaveCSS('font-weight', '500');
  await expect(addIcon).toHaveCSS('height', '28px');
  await expect(addIcon.locator('svg')).toHaveCSS('width', '20px');
  // Desktop docks banner actions at an 800px dialog width, independently of
  // how much room is left beside Share, collaborators and navigation.
  await page.setViewportSize({ width: 1130, height: 900 });
  await expect.poll(async () => (await detail.boundingBox())!.width).toBeLessThan(800);
  await expect.soft(detail.locator('.row-banner')).toHaveAttribute('data-actions-in-header', 'false', { timeout: 1000 });
  await page.setViewportSize({ width: 1160, height: 900 });
  await expect.poll(async () => (await detail.boundingBox())!.width).toBeGreaterThanOrEqual(800);
  await expect(detail.locator('.row-banner')).toHaveAttribute('data-actions-in-header', 'true');
  await expect(title).toHaveText('Plan the next release');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('center-peek-default.png'), animations: 'disabled' });
  await detail.getByTestId('row-peek-mode-menu').click();
  await page.getByTestId('row-peek-mode-side').click();

  // Exercise all banner states without changing any installed-app settings.
  await setGalleryRowMetaDirect(page, rowId, { icon: '🚀' });
  const icon = detail.locator('.view-icon');

  await expect(icon).toHaveCSS('font-size', '48px');
  await expect(icon).toHaveCSS('width', '48px');
  await expect.soft(icon).toHaveCSS('border-radius', '12px', { timeout: 1000 });
  await expect
    .poll(async () => (await icon.boundingBox())!.x - (await detail.boundingBox())!.x)
    .toBe(40);
  await expect
    .poll(async () => {
      const [image, heading] = await Promise.all([icon.boundingBox(), title.boundingBox()]);

      return image!.y + image!.height <= heading!.y;
    })
    .toBe(true);
  await setGalleryRowMetaDirect(page, rowId, { cover: { data: '1' } });
  await expect(detail.locator('.row-header-cover > div')).toHaveCSS('height', '180px');
  await expect(detail.locator('.row-header-cover > div')).toHaveCSS('border-radius', '12px');
  await expect
    .poll(async () => (await detail.locator('.row-header-cover > div').boundingBox())!.x - (await detail.boundingBox())!.x)
    .toBe(8);
  await expect(detail.locator('.row-properties-divider')).toBeVisible();
  await close.hover();
  await page.screenshot({ path: testInfo.outputPath('side-peek-desktop-style.png'), animations: 'disabled' });

  await setGalleryRowMetaDirect(page, rowId, { icon: '' });
  await expect(detail.locator('.row-banner-toolbar')).toHaveCSS('height', '36px');
  await setGalleryRowMetaDirect(page, rowId, { icon: '🚀' });

  await detail.getByTestId('row-peek-mode-menu').click();
  await page.getByTestId('row-peek-mode-center').click();
  await expect(detail).toHaveAttribute('data-peek-mode', 'center');
  await expect(title).toHaveCSS('font-size', '28px');
  await expect(title).toHaveCSS('font-weight', '600');
  await expect(detail.getByTestId('row-detail-close')).toHaveCount(0);
  await expect(detail.getByTestId('row-peek-previous')).toBeVisible();
  await expect(detail.getByTestId('row-peek-next')).toBeVisible();
  await expect(detail.locator('.row-header-cover > div')).toHaveCSS('height', '280px');
  await expect.soft(icon).toHaveCSS('font-size', '60px', { timeout: 1000 });
  await expect(icon).toHaveCSS('width', '88px');
  await expect.soft(icon).toHaveCSS('border-radius', '12px', { timeout: 1000 });
  expect.soft((await icon.boundingBox())!.x - (await detail.boundingBox())!.x).toBe(44);
  expect
    .soft((await detail.locator('.row-header-cover > div').boundingBox())!.x - (await detail.boundingBox())!.x)
    .toBe(12);
  await expect
    .poll(async () => {
      const [panel, heading] = await Promise.all([detail.boundingBox(), title.boundingBox()]);

      return Math.round(heading!.x - panel!.x);
    })
    .toBe(68);
  await page.screenshot({ path: testInfo.outputPath('center-peek-desktop-style.png'), animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(detail.getByTestId('share-button')).toBeInViewport();
  await expect(detail.getByTestId('row-detail-more-actions')).toBeInViewport();
  await expect.poll(() => detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('shares and favorites the row from side peek without navigating the underlying database', async ({
  page,
  request,
}) => {
  await loginAndCreateGrid(page, request, generateRandomEmail());
  const parentUrl = page.url();
  const viewId = await activeDatabaseViewId(page);
  const [rowId] = await getVisibleDataRowIds(page);

  await openRowDetail(page);
  const detail = RowDetailSelectors.modal(page);

  await detail.getByTestId('row-title-input').fill('Favorite from peek');
  const favoriteRequest = page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith('/favorite'));

  await detail.getByTestId('favorite-button').click();
  const req = await favoriteRequest;

  expect(req.url()).toContain(`/page-view/${uuidv5(RowMetaKey.DocumentId, rowId)}/favorite`);
  expect(req.postDataJSON()).toEqual({ is_favorite: true, is_pinned: true });
  await expect(detail.getByTestId('favorite-button')).toHaveAttribute('aria-pressed', 'true');
  expect(page.url()).toBe(parentUrl);
  await detail.getByTestId('share-button').click();
  const share = page.getByTestId('share-popover');

  await expect(share).toBeVisible();
  await expect(share.getByTestId('publish-tab')).toHaveCount(0);
  await share.getByRole('button', { name: 'Copy link', exact: true }).click();
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));

  expect(copied.pathname).toBe(new URL(parentUrl).pathname);
  expect(copied.searchParams.get('v')).toBe(viewId);
  expect(copied.searchParams.get('r')).toBe(rowId);
  expect(page.url()).toBe(parentUrl);
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);
  await expect(detail).toBeVisible();
});
