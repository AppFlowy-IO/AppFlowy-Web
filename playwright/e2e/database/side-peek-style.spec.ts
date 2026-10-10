import { expect, test, type Locator } from '@playwright/test';
import svgo from '@svgr/plugin-svgo';
import { readFileSync } from 'node:fs';
import { v5 as uuidv5 } from 'uuid';

import { RowMetaKey } from '../../../src/application/database-yjs/database.type';

import { getPrimaryFieldId, loginAndCreateGrid, typeTextIntoCell } from '../../support/filter-test-helpers';
import { activeDatabaseViewId, setGalleryRowMetaDirect } from '../../support/gallery-test-helpers';
import { getVisibleDataRowIds, openRowDetail } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

// Assert the actual artwork, not just its box: SVG mocks and size-only checks
// cannot distinguish the fullscreen icon from the side-peek icon.
async function expectIcon(control: Locator, asset: string, index = 0) {
  const expected = svgo(
    readFileSync(new URL(`../../../src/assets/icons/${asset}`, import.meta.url), 'utf8'),
    {
      svgo: true,
      svgoConfig: {
        multipass: true,
        plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }],
      },
    },
    { filePath: asset }
  );
  const svg = control.locator('svg').nth(index);

  await expect.soft(svg).toHaveCSS('width', '20px', { timeout: 1000 });
  expect
    .soft(
      await svg.evaluate((element, source) => {
        const reference = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
        const geometry = (root: Element) => [
          root.getAttribute('viewBox'),
          ...Array.from(root.querySelectorAll('path, line, rect, circle, polyline, polygon, ellipse')).map((shape) => [
            shape.tagName,
            ...Array.from(shape.attributes)
              .filter(({ name }) => name !== 'class')
              .map(({ name, value }) => `${name}=${value}`)
              .sort(),
          ]),
        ];

        return JSON.stringify(geometry(element)) === JSON.stringify(geometry(reference));
      }, expected),
      `Artwork must match ${asset}`
    )
    .toBe(true);
}

test('matches Figma peek typography, icon placement and toolbar reveal across modes', async ({
  page,
  request,
}, testInfo) => {
  await loginAndCreateGrid(page, request, generateRandomEmail());
  const fieldId = await getPrimaryFieldId(page);

  await typeTextIntoCell(page, fieldId, 0, 'Plan the next release');
  const [rowId] = await getVisibleDataRowIds(page);

  await DatabaseGridSelectors.rowById(page, rowId).hover();
  const opener = page.getByTestId('row-expand-button').first();

  await expectIcon(opener, 'side_peek.svg');
  await expect.soft(opener).toHaveAccessibleName('Open as side peek', { timeout: 1000 });
  await expect.soft(opener).toHaveCSS('width', '26px', { timeout: 1000 });
  await expect.soft(opener).toHaveCSS('height', '26px', { timeout: 1000 });
  await expect(opener).toHaveCSS('border-radius', '6px');
  await opener.hover();
  await expect.soft(page.getByRole('tooltip')).toHaveText('Open as side peek', { timeout: 1000 });
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCSS('border-radius', '8px');
  await page.screenshot({ path: testInfo.outputPath('grid-row-opener.png'), animations: 'disabled' });
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
  for (const [id, asset] of [
    ['row-detail-close', 'double_arrow_right.svg'],
    ['row-detail-open-full-page', 'database_fullscreen.svg'],
    ['row-peek-mode-menu', 'side_peek.svg'],
    ['row-peek-previous', 'alt_arrow_up.svg'],
    ['row-peek-next', 'alt_arrow_down.svg'],
    ['favorite-button', 'star.svg'],
    ['row-detail-more-actions', 'more.svg'],
  ])
    await expectIcon(detail.getByTestId(id), asset);
  await expect.soft(detail.getByTestId('share-button')).toHaveCSS('font-weight', '500', { timeout: 1000 });
  await expect.soft(detail.locator('.row-peek-optional-actions')).toHaveCSS('gap', '4px', { timeout: 1000 });
  await expect(detail.locator('.property-label').first()).toHaveCSS('width', '160px');
  await expect(detail.locator('.row-page-content')).toHaveCSS('gap', '12px');
  await expect(detail.getByTestId('row-comment-collapsed-input')).toHaveText('Comment or mention with @ …');
  await expect(detail.getByTestId('row-comment-collapsed-input')).toHaveCSS('border-width', '0px');
  await expect(detail.getByTestId('row-comment-root-composer').locator('[data-slot="avatar"]')).toHaveCSS(
    'height',
    '20px'
  );
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
  await expect(page.getByRole('menu')).toHaveCSS('width', '360px');
  await expectIcon(page.getByTestId('row-peek-mode-side'), 'tick.svg', 1);
  await expectIcon(page.getByTestId('row-peek-mode-center'), 'center_peek.svg');
  await expectIcon(page.getByRole('menuitem', { name: 'Full page', exact: true }), 'full_page.svg');
  await expectIcon(page.getByTestId('row-peek-new-tab'), 'tab.svg');
  await page.screenshot({ path: testInfo.outputPath('peek-mode-menu.png'), animations: 'disabled' });
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
  await expectIcon(addIcon, 'smile.svg');
  await expectIcon(bannerActions.getByRole('button', { name: 'Add cover', exact: true }), 'image.svg');
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
  await expect.poll(async () => (await icon.boundingBox())!.x - (await detail.boundingBox())!.x).toBe(40);
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
    .poll(
      async () => (await detail.locator('.row-header-cover > div').boundingBox())!.x - (await detail.boundingBox())!.x
    )
    .toBe(8);
  await expect(detail.locator('.row-properties-divider')).toBeVisible();
  await detail.locator('.row-header-cover').hover();
  await expect(detail.locator('.view-cover-actions')).toHaveCSS('opacity', '1');
  await expect(detail.locator('.view-cover-actions')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.6)');
  await expect(detail.locator('.view-cover-actions')).toHaveCSS('height', '36px');
  await expect(detail.locator('.view-cover-action-buttons > button').first()).toHaveCSS('font-weight', '500');
  await expectIcon(detail.locator('.view-cover-action-buttons > button').last(), 'delete.svg');
  await page.screenshot({ path: testInfo.outputPath('peek-cover-actions.png'), animations: 'disabled' });
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

  await detail.getByTestId('row-detail-more-actions').click();
  await expect.soft(page.getByRole('menu')).toHaveCSS('width', '240px', { timeout: 1000 });
  await expect.soft(page.getByRole('menu')).toHaveCSS('border-radius', '12px', { timeout: 1000 });
  await expectIcon(page.getByTestId('row-detail-duplicate'), 'duplicate.svg');
  await expectIcon(page.getByTestId('row-detail-delete'), 'delete.svg');
  await page.screenshot({ path: testInfo.outputPath('peek-more-menu.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');

  // Only this isolated browser context changes color scheme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
  await page.screenshot({ path: testInfo.outputPath('center-peek-dark.png'), animations: 'disabled' });
  await detail.getByTestId('row-peek-mode-menu').click();
  await page.getByTestId('row-peek-mode-side').click();
  await close.hover();
  await page.screenshot({ path: testInfo.outputPath('side-peek-dark.png'), animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(detail.getByTestId('share-button')).toBeInViewport();
  await expect(detail.getByTestId('row-detail-more-actions')).toBeInViewport();
  await expect.poll(() => detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await DatabaseGridSelectors.rowById(page, rowId).hover();
  await expectIcon(opener, 'center_peek.svg');
  await expect(opener).toHaveAccessibleName('Open as center peek');
  await opener.click();
  await expect(detail).toHaveAttribute('data-peek-mode', 'center');
  await detail.getByTestId('row-peek-mode-menu').click();
  await expect(page.getByRole('menu')).toHaveCSS('width', '360px');
  await expect(page.getByRole('menu')).toBeInViewport();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole('menu')).toHaveCSS('width', '304px');
  await expect(page.getByRole('menu')).toBeInViewport();
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
  await expectIcon(detail.getByTestId('favorite-button'), 'filled_star.svg');
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
