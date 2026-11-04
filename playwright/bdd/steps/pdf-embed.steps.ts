import path from 'node:path';

import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { EditorSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then } = createBdd();

const PDF_FIXTURES = path.resolve('playwright/fixtures/pdfs');
const RECORDING = process.env.PLAYWRIGHT_VIDEO === 'on';
// The file Vite emits for `pdfjs-dist/build/pdf.worker.min.mjs?url`. PDF.js requests it
// as a module worker and, when that fails, again through a main-thread import().
const PDF_WORKER_URL = /\/pdf\.worker[^/]*\.m?js$/;
const JAVASCRIPT_MIME = /^(text|application)\/javascript\s*(;|$)/i;

interface WorkerResponse {
  pathname: string;
  status: number;
  contentType: string;
}

const workerResponses = new WeakMap<Page, WorkerResponse[]>();

function pdfBlock(page: Page) {
  return page.locator('[data-block-type="pdf"]');
}

function describeWorkerResponses(responses: WorkerResponse[]): string {
  if (responses.length === 0) return 'The PDF worker was never requested.';

  return responses
    .map(({ pathname, status, contentType }) => `${pathname} → ${status} ${contentType || '(no Content-Type)'}`)
    .join('\n');
}

/**
 * Recorded runs (PLAYWRIGHT_VIDEO=on) show what each step does and checks,
 * because response headers never appear on screen.
 */
async function caption(page: Page, text: string): Promise<void> {
  if (!RECORDING) return;
  await page.evaluate((value) => {
    let el = document.getElementById('bdd-caption');

    if (!el) {
      el = document.createElement('div');
      el.id = 'bdd-caption';
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        maxWidth: '80%',
        padding: '10px 16px',
        borderRadius: '8px',
        background: 'rgba(17, 24, 39, 0.9)',
        color: '#fff',
        font: '600 15px/1.45 system-ui, sans-serif',
        whiteSpace: 'pre-line',
        textAlign: 'center',
        pointerEvents: 'none',
      });
      document.body.appendChild(el);
    }

    el.textContent = value;
  }, text);
  await page.waitForTimeout(2000);
}

Given('I am signed in on a new document page', async ({ page, request }) => {
  // CI signs up a fresh user. On a server that only admits listed sign-ups,
  // set PDF_EMBED_EMAIL to an existing throwaway account instead.
  await signInAndWaitForApp(page, request, process.env.PDF_EMBED_EMAIL || generateRandomEmail());
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
  await createDocumentPageAndNavigate(page);

  const editor = EditorSelectors.firstEditor(page);

  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click({ force: true });
});

When('I upload {string} in a new PDF embed block', async ({ page }, fileName: string) => {
  const responses: WorkerResponse[] = [];

  workerResponses.set(page, responses);
  page.on('response', (response) => {
    const url = new URL(response.url());

    if (!PDF_WORKER_URL.test(url.pathname)) return;
    responses.push({
      pathname: url.pathname,
      status: response.status(),
      contentType: response.headers()['content-type'] ?? '',
    });
  });

  await caption(page, `Insert a PDF embed with /pdf and upload ${fileName}`);
  await page.keyboard.type('/pdf');
  await page.getByTestId('slash-menu-pdf').click();
  const chooser = page.waitForEvent('filechooser');

  await page.getByTestId('file-dropzone').getByRole('button').click();
  await (await chooser).setFiles(path.join(PDF_FIXTURES, fileName));
  await expect(page.getByTestId('pdf-uploader')).toHaveCount(0, { timeout: 30_000 });
  await expect(pdfBlock(page)).toHaveCount(1);
});

Then('the PDF embed renders the pages of {string}', async ({ page }, fileName: string) => {
  const block = pdfBlock(page);
  // Scoped to the viewer: the block's own upload status and upload error use the same roles.
  const viewer = block.locator('.pdf-viewer');
  const failed = viewer.getByRole('alert');
  const ready = block.locator('.pdf-viewer[data-pdf-ready="true"]');

  // Loading ends either rendered or on the "Try again" error state; check which.
  await expect(ready.or(failed).first()).toBeVisible({ timeout: 60_000 });
  const workers = describeWorkerResponses(workerResponses.get(page) ?? []);
  const showsError = await failed.isVisible();

  if (showsError) {
    await caption(page, `${fileName} did not render; the embed only offers "Try again"\nPDF worker: ${workers}`);
  }

  expect(showsError, `${fileName} did not render; the embed only offers "Try again". PDF worker:\n${workers}`)
    .toBe(false);
  await expect(block.locator('canvas').first()).toBeVisible();
  await expect(block.locator('.textLayer').first()).not.toBeEmpty();
  await caption(page, `${fileName} renders inline, text layer included`);
});

Then('the PDF worker script is served as JavaScript', async ({ page }) => {
  const responses = workerResponses.get(page) ?? [];

  await caption(page, `PDF worker response:\n${describeWorkerResponses(responses)}`);
  expect(responses, describeWorkerResponses(responses)).not.toHaveLength(0);

  for (const { pathname, contentType } of responses) {
    expect(contentType, `${pathname} must be served as a JavaScript module`).toMatch(JAVASCRIPT_MIME);
  }
});
