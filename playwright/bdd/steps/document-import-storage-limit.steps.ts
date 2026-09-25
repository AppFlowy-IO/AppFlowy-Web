import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { mockServerInfo } from '../../support/server-info-helpers';

const { Given, When, Then } = createBdd();
const STORAGE_PROMPT =
  'This workspace does not have enough storage for this import. Upgrade the workspace plan or contact your workspace administrator.';
const stateByPage = new WeakMap<Page, { stage: string; creates: number; uploads: number }>();

Given('the document import server is Cloud hosted', async ({ page }) => {
  await mockServerInfo(page, { self_hosted: false });
});

Given('the document import {string} reports exhausted workspace storage', async ({ page }, stage: string) => {
  expect(['request', 'worker']).toContain(stage);
  const state = { stage, creates: 0, uploads: 0 };
  const taskId = randomUUID();
  const uploadUrl = new URL('/__bdd_document_import_upload', page.url()).href;
  const error = { code: 1028, message: 'Workspace storage is full' };

  stateByPage.set(page, state);
  await page.route(/\/api\/import\/[^/]+\/document(?:\/[^/]+)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      state.creates++;
      await route.fulfill({
        json:
          stage === 'request'
            ? error
            : { code: 0, data: { task_id: taskId, presigned_url: uploadUrl, expires_in_secs: 1800 } },
      });
    } else {
      await route.fulfill({
        json: { code: 0, data: { task_id: taskId, status: 'Failed', error: error.message, error_code: error.code } },
      });
    }
  });
  await page.route(uploadUrl, async (route) => {
    state.uploads++;
    await route.fulfill({ status: 200, body: '' });
  });
  await page.route(`**/api/import/tasks/${taskId}/cancel`, (route) => route.fulfill({ json: { code: 0 } }));
});

When('I select two generated {string} files for the storage limit check', async ({ page }, format: string) => {
  expect(['pdf', 'docx']).toContain(format);
  const space = page.getByTestId('space-item').first();

  await space.hover();
  await space.getByTestId('inline-add-page').first().click();
  await page.getByTestId('add-import-button').click();
  const buffer = await readFile(path.resolve('playwright/fixtures/document-import', `feature_matrix.${format}`));
  const mimeType =
    format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  await page
    .getByTestId(`import-${format}-input`)
    .setInputFiles(['first', 'unattempted'].map((name) => ({ name: `${name}.${format}`, mimeType, buffer })));
});

Then('I see an actionable import storage limit prompt', async ({ page, $testInfo }) => {
  await expect(page.getByText(STORAGE_PROMPT, { exact: true })).toBeVisible();
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await expect(page.getByText(/Internal server error/)).toHaveCount(0);
  await $testInfo.attach('import-storage-limit-prompt', { body: await page.screenshot(), contentType: 'image/png' });
});

Then('the remaining file is not uploaded', async ({ page }) => {
  // Enabled tiles mean the batch has settled; checking counts earlier could miss a later upload.
  await expect(page.getByTestId('import-pdf')).toBeEnabled();
  const state = stateByPage.get(page);

  expect(state?.creates).toBe(1);
  expect(state?.uploads).toBe(state?.stage === 'request' ? 0 : 1);
});
