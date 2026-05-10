import { Page, expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { setupPageErrorHandling } from '../../support/fixtures';
import {
  AddPageSelectors,
  ImportSelectors,
  PageSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Import — BDD scenarios for the sidebar "+" → Import flow.
 *
 * Two formats are supported:
 *   - Text & Markdown — fully client-side: parses MD locally, creates an empty
 *     Document via PageService.add, fetches its collab, mutates the Y.Doc,
 *     and PUTs the encoded update back.
 *   - CSV — server flow: createDatabaseCsvImportTask → upload to presigned
 *     URL → poll status until Completed (mocked here for hermetic tests).
 *
 * The dialog is owned by Outline.tsx (a persistent ancestor) so it survives
 * the dropdown unmount that happens when the Import menu item is clicked.
 */

const SAMPLE_MARKDOWN = '# Imported Heading\n\nThis is **bold** content from a markdown file.\n';

async function openAddPageMenu(page: Page): Promise<void> {
  // Hover the first sidebar page so the inline "+" button reveals.
  const firstPage = PageSelectors.items(page).first();

  await expect(firstPage).toBeVisible({ timeout: 30000 });
  await firstPage.hover();

  const addButton = AddPageSelectors.inlineAddButton(page).first();

  await expect(addButton).toBeVisible({ timeout: 10000 });
  await addButton.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(500);
}

async function openImportDialogFromAddMenu(page: Page): Promise<void> {
  await openAddPageMenu(page);
  await expect(AddPageSelectors.addImportButton(page)).toBeVisible({ timeout: 5000 });
  await AddPageSelectors.addImportButton(page).click({ force: true });
  await expect(ImportSelectors.dialog(page)).toBeVisible({ timeout: 5000 });
}

test.describe('Feature: Import', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    testEmail = generateRandomEmail();
  });

  test('Scenario: Open Import dialog from the sidebar add menu', async ({ page, request }) => {
    await test.step('Given a signed-in user', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    });

    await test.step('When the user opens the inline "+" menu and clicks Import', async () => {
      await openImportDialogFromAddMenu(page);
    });

    await test.step('Then the Import dialog shows Text & Markdown and CSV options', async () => {
      await expect(ImportSelectors.markdownButton(page)).toBeVisible();
      await expect(ImportSelectors.csvButton(page)).toBeVisible();
    });
  });

  test('Scenario: Importing a Markdown file creates a Document page with the file content', async ({
    page,
    request,
  }) => {
    await test.step('Given a signed-in user with the default workspace', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500);
    });

    await test.step('When the user opens Import → Text & Markdown and picks a .md file', async () => {
      await openImportDialogFromAddMenu(page);

      const filename = `notes-${Date.now()}.md`;

      await ImportSelectors.markdownInput(page).setInputFiles({
        name: filename,
        mimeType: 'text/markdown',
        buffer: Buffer.from(SAMPLE_MARKDOWN, 'utf-8'),
      });
    });

    await test.step('Then a new Document with the file basename appears in the sidebar', async () => {
      await expect(ImportSelectors.dialog(page)).not.toBeVisible({ timeout: 30000 });
      // Server side: the new view is created via addAppPage, then the doc is
      // populated via getCollab + updateCollab. Refresh of the outline is
      // handled by usePageOperations.addPage, which calls loadOutline.
      await expect(PageSelectors.nameContaining(page, /^notes-\d+$/).first()).toBeVisible({
        timeout: 30000,
      });
    });

    await test.step('And the page modal that auto-opens displays the imported heading and bold text', async () => {
      // After import, ExportPanel calls openPageModal(viewId) — a [role="dialog"]
      // overlay that renders the new page's editor. Wait for it and assert content
      // inside that modal (avoids fighting the overlay with sidebar clicks).
      const modal = page.locator('[role="dialog"]').last();

      await expect(modal).toBeVisible({ timeout: 15000 });
      await expect(modal.locator('[data-slate-editor="true"]').first()).toBeVisible({
        timeout: 15000,
      });
      await expect(modal.getByText('Imported Heading').first()).toBeVisible({ timeout: 15000 });
      await expect(modal.getByText('bold').first()).toBeVisible({ timeout: 5000 });
    });
  });

  test('Scenario: Importing a CSV file creates a Grid page (server flow mocked)', async ({
    page,
    request,
  }) => {
    const taskId = 'test-csv-task-id';
    const fakeViewId = '00000000-0000-4000-8000-000000000001';
    let presignedUploadHit = false;
    let pollCount = 0;

    await test.step('Given the CSV import server endpoints are mocked end-to-end', async () => {
      // 1) createDatabaseCsvImportTask → returns a presigned URL we control
      await page.route('**/api/workspace/**/database/import/csv', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              task_id: taskId,
              presigned_url: 'https://example.test/csv-upload',
              expires_in_secs: 1800,
            },
            message: 'success',
          }),
        });
      });

      // 2) Upload to presigned URL → 200 OK
      await page.route('https://example.test/csv-upload', (route) => {
        presignedUploadHit = true;
        route.fulfill({ status: 200, body: '' });
      });

      // 3) Status poll → first response Pending, second Completed.
      // The client polls every 1.5s; with fake timers the second hit is enough.
      await page.route(
        `**/api/workspace/**/database/import/csv/${taskId}`,
        (route) => {
          pollCount += 1;
          const isDone = pollCount >= 2;

          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 0,
              data: {
                task_id: taskId,
                status: isDone ? 'Completed' : 'Pending',
                progress: { rows_processed: isDone ? 1 : 0, rows_total: 1 },
                ...(isDone ? { view_id: fakeViewId, database_id: fakeViewId } : {}),
              },
              message: 'success',
            }),
          });
        },
      );
    });

    await test.step('And a signed-in user', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500);
    });

    await test.step('When the user picks a CSV file via Import → CSV', async () => {
      await openImportDialogFromAddMenu(page);

      const csv = 'name,role\nAlice,Engineer\nBob,Designer\n';

      await ImportSelectors.csvInput(page).setInputFiles({
        name: `team-${Date.now()}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(csv, 'utf-8'),
      });
    });

    await test.step('Then the CSV is uploaded and the dialog closes after polling completes', async () => {
      await expect(ImportSelectors.dialog(page)).not.toBeVisible({ timeout: 15000 });
      expect(presignedUploadHit).toBe(true);
      expect(pollCount).toBeGreaterThanOrEqual(2);
    });

    await test.step('And the client navigates to the new view returned by the server', async () => {
      // toView() pushes the view_id onto the URL — assert the URL ends with the fake id
      await expect.poll(() => page.url(), { timeout: 10000 }).toContain(fakeViewId);
    });
  });
});
