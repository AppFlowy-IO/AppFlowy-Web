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
 * Four formats are supported:
 *   - Text & Markdown — fully client-side: parses MD locally, creates an empty
 *     Document via PageService.add, fetches its collab, mutates the Y.Doc,
 *     and PUTs the encoded update back.
 *   - CSV — server flow: createDatabaseCsvImportTask → upload to presigned
 *     URL → poll status until Completed (mocked here for hermetic tests).
 *   - Notion and Confluence — upload exported ZIP files and queue a server import.
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

  test('Scenario: Import buttons open native file choosers with the expected file types', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await page.evaluate(() => {
      delete (window as Window & { Cypress?: boolean }).Cypress;
    });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await openImportDialogFromAddMenu(page);

    const formats = [
      { format: 'markdown', accept: '.md,.markdown,.txt,text/markdown,text/plain', multiple: false },
      { format: 'csv', accept: '.csv,text/csv', multiple: true },
      {
        format: 'notion',
        accept: '.zip,application/zip,application/x-zip,application/x-zip-compressed',
        multiple: false,
      },
      {
        format: 'confluence',
        accept: '.zip,application/zip,application/x-zip,application/x-zip-compressed',
        multiple: false,
      },
      // Notion-parity file imports: one page per file, several files at once.
      { format: 'html', accept: '.html,.htm,text/html', multiple: true },
      {
        format: 'docx',
        accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        multiple: true,
      },
      { format: 'pdf', accept: '.pdf,application/pdf', multiple: true },
    ];

    for (const { format, accept, multiple } of formats) {
      await test.step(`Clicking ${format} requests a native file chooser`, async () => {
        // Waiting for a browser chooser catches regressions that directly
        // assigning files to the hidden input cannot detect.
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10000 }),
          page.getByTestId(`import-${format}`).click(),
        ]);

        expect(await chooser.element().getAttribute('data-testid')).toBe(`import-${format}-input`);
        expect(await chooser.element().getAttribute('accept')).toBe(accept);
        expect(chooser.isMultiple()).toBe(multiple);
        await chooser.setFiles([]);
        await expect(ImportSelectors.dialog(page)).toBeVisible();
      });
    }

    for (const key of ['Enter', 'Space']) {
      await test.step(`${key} opens the Confluence native file chooser`, async () => {
        const button = page.getByTestId('import-confluence');

        await button.focus();
        const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), button.press(key)]);

        expect(await chooser.element().getAttribute('data-testid')).toBe('import-confluence-input');
        expect(chooser.isMultiple()).toBe(false);
        await chooser.setFiles([]);
        await expect(ImportSelectors.dialog(page)).toBeVisible();
      });
    }
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

  test('Scenario: Importing Word files creates Document pages one file at a time (server flow mocked)', async ({
    page,
    request,
  }) => {
    // Two files: the batch must create a task, upload, and poll each one sequentially
    // (the server caps pending import tasks), then open the first page and surface the
    // converter warning reported for the second.
    const fakeViewIds = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
    const createdTasks: { file_name: string; format: string; parent_view_id: string }[] = [];
    const uploads: { taskId: string; contentType: string | undefined }[] = [];
    const polls: Record<string, number> = {};

    await test.step('Given the document import server endpoints are mocked end-to-end', async () => {
      await page.route('**/api/import/**/document', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON() as { file_name: string; format: string; parent_view_id: string };
        const index = createdTasks.push(body);

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              task_id: `docx-task-${index}`,
              presigned_url: `https://example.test/docx-upload/${index}`,
              expires_in_secs: 1800,
            },
            message: 'success',
          }),
        });
      });

      await page.route('https://example.test/docx-upload/*', (route) => {
        const taskId = `docx-task-${route.request().url().split('/').pop()}`;

        uploads.push({ taskId, contentType: route.request().headers()['content-type'] });
        route.fulfill({ status: 200, body: '' });
      });

      await page.route('**/api/import/**/document/docx-task-*', (route) => {
        const taskId = route.request().url().split('/').pop() as string;
        const index = Number(taskId.replace('docx-task-', '')) - 1;

        polls[taskId] = (polls[taskId] ?? 0) + 1;
        const done = polls[taskId] >= 2;

        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              task_id: taskId,
              status: done ? 'Completed' : 'Processing',
              ...(done ? { view_id: fakeViewIds[index] } : {}),
              ...(done && index === 1
                ? {
                    diagnostics: {
                      warnings: [
                        { code: 'docx_footnotes_dropped', count: 2, message: 'Footnotes and endnotes are not imported' },
                      ],
                    },
                  }
                : {}),
            },
            message: 'success',
          }),
        });
      });
    });

    await test.step('And a signed-in user', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500);
    });

    await test.step('When the user picks two .docx files via Import → Word', async () => {
      await openImportDialogFromAddMenu(page);

      const docx = { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

      await ImportSelectors.docxInput(page).setInputFiles([
        { name: 'plan.docx', buffer: Buffer.from('PK\u0003\u0004 fake docx one', 'utf-8'), ...docx },
        { name: 'notes.docx', buffer: Buffer.from('PK\u0003\u0004 fake docx two', 'utf-8'), ...docx },
      ]);
    });

    await test.step('Then each file is staged, uploaded with the Word content type, and polled in turn', async () => {
      await expect(ImportSelectors.dialog(page)).not.toBeVisible({ timeout: 20000 });
      expect(createdTasks.map((task) => task.file_name)).toEqual(['plan.docx', 'notes.docx']);
      expect(createdTasks.every((task) => task.format === 'docx')).toBe(true);
      expect(uploads.map((upload) => upload.taskId)).toEqual(['docx-task-1', 'docx-task-2']);
      expect(
        uploads.every(
          (upload) =>
            upload.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
      ).toBe(true);
      expect(polls['docx-task-1']).toBeGreaterThanOrEqual(2);
      expect(polls['docx-task-2']).toBeGreaterThanOrEqual(2);
    });

    await test.step('And the converter warning for the second file is shown', async () => {
      await expect(page.getByText(/some content could not be converted/).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/Footnotes and endnotes are not imported/).first()).toBeVisible({ timeout: 5000 });
    });

    await test.step('And the client opens the first imported page', async () => {
      await expect.poll(() => page.url(), { timeout: 10000 }).toContain(fakeViewIds[0]);
    });
  });

  test('Scenario: A PDF that fails on the server is reported per file and the dialog stays open', async ({
    page,
    request,
  }) => {
    await test.step('Given the server rejects the scanned PDF after conversion', async () => {
      await page.route('**/api/import/**/document', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: { task_id: 'pdf-task', presigned_url: 'https://example.test/pdf-upload', expires_in_secs: 1800 },
            message: 'success',
          }),
        });
      });
      await page.route('https://example.test/pdf-upload', (route) => route.fulfill({ status: 200, body: '' }));
      await page.route('**/api/import/**/document/pdf-task', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              task_id: 'pdf-task',
              status: 'Failed',
              error: 'this PDF has no selectable text on its 1 page(s); run OCR on it before importing',
            },
            message: 'success',
          }),
        })
      );
      await page.route('**/api/import/tasks/pdf-task/cancel', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok' }) })
      );
    });

    await test.step('And a signed-in user', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500);
    });

    await test.step('When the user picks a scanned PDF via Import → PDF', async () => {
      await openImportDialogFromAddMenu(page);
      await ImportSelectors.pdfInput(page).setInputFiles({
        name: 'scan.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 fake scanned pdf', 'utf-8'),
      });
    });

    await test.step("Then the server's message is shown for that file and the dialog stays open", async () => {
      await expect(page.getByText(/run OCR on it before importing/).first()).toBeVisible({ timeout: 15000 });
      await expect(ImportSelectors.dialog(page)).toBeVisible();
      await expect(ImportSelectors.pdfButton(page)).toBeEnabled({ timeout: 10000 });
    });
  });
});
