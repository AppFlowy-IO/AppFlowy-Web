import path from 'node:path';

import { expect, Page } from '@playwright/test';

import { fixtureHTML, test as baseTest } from './integrations-server';

export const fixturePath = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
export const asset = path.resolve('playwright/fixtures/images/design.png');
export const block = (page: Page) => page.locator('[data-block-type="image"]');
export const snapshot = (page: Page) => page.getByTestId('image-document-snapshot');

export async function insert(page: Page) {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/image');
  await page.getByRole('button', { name: 'Image', exact: true }).click();
  await expect(page.getByTestId('image-uploader')).toBeVisible();
  await expect(page.getByTestId('slash-panel')).toHaveCount(0);
  await expect(page.locator('.MuiPopover-paper').filter({ has: page.getByTestId('image-uploader') })).toHaveCSS(
    'opacity',
    '1'
  );
}

export async function embed(page: Page, url = new URL('/fixtures/ocean.png', page.url()).href) {
  await insert(page);
  await page.getByRole('tab', { name: 'Embed Link', exact: true }).click();
  await page.getByTestId('image-uploader').getByRole('textbox').fill(url);
  await page.getByRole('button', { name: 'Embed', exact: true }).click();
  await expect(block(page).locator('.image-content > img')).toBeVisible();
}

export async function more(page: Page) {
  await block(page).first().hover();
  await block(page).first().getByRole('button', { name: 'Image options', exact: true }).click();
  return page.getByTestId('image-menu');
}

// A fixture runs for every spec, including multiple specs in the same worker.
// Registering beforeEach at module scope only initialized the first importer.
const test = baseTest.extend({
  page: async ({ page, integrationsURL }, use) => {
    await page.route('**/api/ai/*/model/list', (route) => route.fulfill({ json: { code: 0, data: { models: [] } } }));
    await page.route('**/fixtures/*.png', (route) => route.fulfill({ contentType: 'image/png', path: asset }));
    await page.route('**/fixtures/*.jpeg', (route) =>
      route.fulfill({ contentType: 'image/jpeg', path: path.resolve('playwright/fixtures/images/flutter-sample.jpeg') })
    );
    await page.route('**/fixtures/*.gif', (route) =>
      route.fulfill({ contentType: 'image/gif', path: path.resolve('playwright/fixtures/images/flutter-sample.gif') })
    );
    await page.route(`**${fixturePath}*`, (route) =>
      route.fulfill({ contentType: 'text/html', body: fixtureHTML('image') })
    );
    await page.goto(new URL(fixturePath, integrationsURL).href);
    await expect(snapshot(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await use(page);
  },
});

export { test, expect };
