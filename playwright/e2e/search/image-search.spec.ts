import { fileURLToPath } from 'url';

import { expect, test, type Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { PageSelectors } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

/**
 * Search with images: a page is found by the words in its image, and its result opens the page at
 * that image.
 *
 * Search reads images with the server's image search (vision) model, so this runs only against a
 * server that has one: set APPFLOWY_E2E_IMAGE_SEARCH=true. Set APPFLOWY_E2E_VIDEO_DIR to record
 * the search itself, after the image has been read.
 */
const IMAGE_SEARCH = process.env.APPFLOWY_E2E_IMAGE_SEARCH === 'true';
const VIDEO_DIR = process.env.APPFLOWY_E2E_VIDEO_DIR;
const CHART = fileURLToPath(new URL('../../fixtures/search/quarterly-revenue-chart.png', import.meta.url));
/** Written only inside the chart, never in the page's own text. */
const QUERY = 'revenue';
/** A local model can take minutes to read an image. */
const IMAGE_READ_TIMEOUT = 5 * 60_000;

/** Pause so a recording shows each step; a plain run does not wait. */
async function pace(page: Page, ms: number) {
  if (VIDEO_DIR) await page.waitForTimeout(ms);
}

async function insertImage(page: Page, file: string) {
  await page.keyboard.press('Enter');
  await page.keyboard.type('/image', { delay: 50 });
  await page
    .locator('[data-testid^="slash-menu-"]')
    .filter({ hasText: /^Image$/ })
    .click();
  const dropzone = page.getByTestId('file-dropzone');

  await expect(dropzone).toBeVisible({ timeout: 10000 });
  await dropzone.locator('input[type="file"]').setInputFiles(file);
  await expect(page.locator('[data-testid="editor-content"] img').first()).toBeVisible({ timeout: 30000 });
}

/** Wait until Search has read the image and finds the page through it. */
async function waitForImageResult(page: Page, workspaceId: string, pageId: string) {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('token') ?? '{}').access_token as string | undefined
  );

  expect(token).toBeTruthy();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${TestConfig.apiUrl}/api/search/${workspaceId}/page`, {
          params: { query: QUERY, limit: 10, mode: 'keyword' },
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok()) return false;
        const items: Array<{ object_id: string; evidence?: Array<{ kind: string }> }> =
          (await response.json()).data?.items ?? [];

        return items.some(
          (item) => item.object_id === pageId && item.evidence?.some((evidence) => evidence.kind === 'image')
        );
      },
      { message: `Search never found the page through its image`, timeout: IMAGE_READ_TIMEOUT, intervals: [5000] }
    )
    .toBe(true);
}

test.describe('Feature: Search with images', () => {
  test.skip(!IMAGE_SEARCH, 'needs a server with an image search (vision) model');
  test.setTimeout(IMAGE_READ_TIMEOUT + 3 * 60_000);

  test('Given a page with a chart image, When the user searches for a word in the chart, Then the result shows the image and opens the page at it', async ({
    browser,
    page,
    request,
  }) => {
    // Given a page whose only mention of "revenue" is inside its chart
    await signInAndWaitForApp(page, request, generateRandomEmail());
    const pageId = await createDocumentPageAndNavigate(page);

    await PageSelectors.titleInput(page).fill('Q3 planning');
    await PageSelectors.titleInput(page).press('Enter');
    await page.keyboard.type('Notes for the next quarterly planning meeting.');
    await insertImage(page, CHART);
    const workspaceId = new URL(page.url()).pathname.split('/')[2];

    await waitForImageResult(page, workspaceId, pageId);

    // When the user searches for a word that appears only in the chart
    const context = await browser.newContext({
      storageState: await page.context().storageState(),
      viewport: { width: 1440, height: 900 },
      ...(VIDEO_DIR ? { recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } } } : {}),
    });
    const viewer = await context.newPage();

    await viewer.goto(`/app/${workspaceId}`);
    // Start on another page, so opening the result visibly moves to the chart.
    const startPage = PageSelectors.itemByName(viewer, 'Getting started');

    await expect(startPage).toBeVisible({ timeout: 30000 });
    // Its children are nested inside it; the first name is its own.
    await startPage.getByTestId('page-name').first().click();
    await viewer.waitForURL((url) => !url.pathname.endsWith(pageId));
    const searchButton = viewer.getByText('Search', { exact: true }).first();

    await pace(viewer, 1500);
    await searchButton.click();
    await viewer.keyboard.type(QUERY, { delay: VIDEO_DIR ? 150 : 0 });

    // Then the result shows the matched image and the text read from it
    const result = viewer
      .getByRole('dialog')
      .locator('[data-item-id]')
      .filter({ has: viewer.getByTestId('search-result-evidence') })
      .first();

    await expect(result).toContainText('Q3 planning', { timeout: 30000 });
    await expect(result.getByTestId('search-result-evidence')).toHaveAttribute('data-kind', 'image');
    await expect(result).toContainText('Found in an image');
    await expect(result.getByTestId('search-result-evidence').locator('img')).toBeVisible({ timeout: 15000 });
    await result.hover();
    await pace(viewer, 2500);

    // And opens the page at the chart
    await result.click();
    await viewer.waitForURL((url) => url.pathname.endsWith(pageId) && url.searchParams.has('blockId'));
    await expect(PageSelectors.titleInput(viewer)).toHaveText('Q3 planning');
    await expect(viewer.locator('.highlight-block img')).toBeVisible({ timeout: 15000 });
    await pace(viewer, 3500);
    await context.close();
  });
});
