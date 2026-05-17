import { test, expect, Page, Request } from '@playwright/test';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { generateRandomEmail } from '../../../support/test-config';

/**
 * Editor file-block / image-block popover upload regression tests.
 *
 * Covers the popover code paths in:
 *   - src/components/editor/components/block-popover/FileBlockPopoverContent.tsx
 *   - src/components/editor/components/block-popover/ImageBlockPopoverContent.tsx
 *
 * The critical regression this guards against: after the refactor that
 * persists a local IndexedDB snapshot *before* kicking off the remote upload,
 * an IndexedDB write failure (private browsing, quota exceeded, etc.) must
 * not block the remote upload — the popover should still POST the file to
 * the server.
 *
 * We assert at the network layer rather than the rendered URL, because
 * a brand-new test user may not have permissions to fetch the resulting
 * file URL back from the storage endpoint, but the upload POST itself is
 * the regression signal we care about.
 */
test.describe('Feature: Editor block popover upload', () => {
  // Each test creates a new user via GoTrue, which can't handle parallel auth.
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeEach(async ({ page: testPage, request }) => {
    page = testPage;
    await signInAndWaitForApp(page, request, generateRandomEmail());
    await page.locator('[data-testid="inline-add-page"]').first().waitFor({ state: 'visible', timeout: 30000 });
  });

  /**
   * Create a new doc page via the inline-add button.
   */
  async function createNewDocPage(): Promise<void> {
    const addBtn = page.locator('[data-testid="inline-add-page"]').first();
    await addBtn.click();
    await page.waitForTimeout(500);
    await page.getByText('Document', { exact: true }).first().click();
    await page.waitForTimeout(2000);
  }

  function getEditor() {
    return page.locator('[data-testid="editor-content"]').last();
  }

  /**
   * Insert a block via the slash menu by key (e.g. 'file', 'image').
   */
  async function insertBlockViaSlash(slashKey: 'file' | 'image'): Promise<void> {
    const editor = getEditor();
    await editor.click({ force: true, position: { x: 100, y: 10 } });
    await page.waitForTimeout(300);
    await page.keyboard.type(`/${slashKey}`);
    await page.waitForTimeout(600);
    await page.locator(`[data-testid="slash-menu-${slashKey}"]`).click();
    await page.waitForTimeout(600);
  }

  /**
   * Start collecting any request whose URL contains `file_storage` (covers
   * single-shot uploads, presigned URL fetches, and multipart endpoints).
   * Returns an array reference that fills as requests arrive.
   */
  function captureUploadRequests(): Request[] {
    const captured: Request[] = [];
    page.on('request', (req) => {
      if (req.url().includes('file_storage') || req.url().includes('/upload')) {
        captured.push(req);
      }
    });
    return captured;
  }

  /**
   * 1×1 transparent PNG (smallest valid PNG, ~70 bytes).
   */
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  test('Given a File block popover, when user uploads a file, then the remote upload endpoint is hit', async () => {
    const uploadRequests = captureUploadRequests();

    await createNewDocPage();
    await insertBlockViaSlash('file');

    const dropzone = page.getByTestId('file-dropzone');
    await expect(dropzone).toBeVisible({ timeout: 10000 });

    const fileInput = dropzone.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'regression.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('hello world from regression test'),
    });

    // The popover must hand the file off to the remote upload endpoint, not
    // just persist it locally. The local IndexedDB save and the remote upload
    // were re-ordered in a recent refactor; this catches a regression where
    // a missing/failed local save would short-circuit the remote upload.
    await expect
      .poll(() => uploadRequests.filter((r) => r.method() !== 'GET').length, {
        timeout: 30000,
        message: 'no upload request fired for file block',
      })
      .toBeGreaterThan(0);

    // The block also flips out of its empty state (the file name appears).
    await expect(getEditor()).toContainText('regression.bin', { timeout: 30000 });
  });

  test('Given an Image block popover, when user uploads an image, then the remote upload endpoint is hit', async () => {
    const uploadRequests = captureUploadRequests();

    await createNewDocPage();
    await insertBlockViaSlash('image');

    const dropzone = page.getByTestId('file-dropzone');
    await expect(dropzone).toBeVisible({ timeout: 10000 });

    const fileInput = dropzone.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'regression.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    await expect
      .poll(() => uploadRequests.filter((r) => r.method() !== 'GET').length, {
        timeout: 30000,
        message: 'no upload request fired for image block',
      })
      .toBeGreaterThan(0);

    // The block flips out of its empty state and renders an <img>.
    await expect(getEditor().locator('img').first()).toBeVisible({ timeout: 30000 });
  });

  test('Given the local FileStorage database is unavailable, when user uploads via the popover, then the remote upload still fires', async () => {
    // Make ONLY the FileStorage IndexedDB database (used by the popover's
    // local retry-snapshot) fail to open. The rest of the app — including
    // its own state databases — is left untouched, so we don't blow up the
    // editor itself.
    //
    // This simulates a private-browsing or quota-exhausted state where the
    // local retry snapshot cannot be persisted but the remote upload must
    // still proceed.
    await page.addInitScript(() => {
      const originalOpen = window.indexedDB.open.bind(window.indexedDB);

      // eslint-disable-next-line
      (window.indexedDB as any).open = function (name: string, version?: number): IDBOpenDBRequest {
        if (name === 'FileStorage') {
          const fakeRequest: Partial<IDBOpenDBRequest> & {
            onerror: ((ev: Event) => void) | null;
            onsuccess: ((ev: Event) => void) | null;
            onupgradeneeded: ((ev: Event) => void) | null;
            onblocked: ((ev: Event) => void) | null;
            error: DOMException | null;
            result: IDBDatabase | null;
          } = {
            onerror: null,
            onsuccess: null,
            onupgradeneeded: null,
            onblocked: null,
            error: new DOMException('FileStorage disabled for test', 'QuotaExceededError'),
            result: null,
          };

          setTimeout(() => {
            if (typeof fakeRequest.onerror === 'function') {
              fakeRequest.onerror(new Event('error'));
            }
          }, 0);

          return fakeRequest as IDBOpenDBRequest;
        }

        return originalOpen(name, version);
      };
    });

    const uploadRequests = captureUploadRequests();

    // Re-load the app under the patched environment.
    await page.goto('http://localhost:3000/app');
    await page.locator('[data-testid="inline-add-page"]').first().waitFor({ state: 'visible', timeout: 30000 });

    await createNewDocPage();
    await insertBlockViaSlash('file');

    const dropzone = page.getByTestId('file-dropzone');
    await expect(dropzone).toBeVisible({ timeout: 10000 });

    const fileInput = dropzone.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'no-idb.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('upload should still reach the server'),
    });

    // The regression we're guarding against: when the local IndexedDB save
    // rejects, the popover code must NOT swallow that error and skip the
    // remote upload. A non-GET request to a file storage endpoint must still
    // fire.
    await expect
      .poll(() => uploadRequests.filter((r) => r.method() !== 'GET').length, {
        timeout: 30000,
        message: 'no upload request fired when IndexedDB was disabled',
      })
      .toBeGreaterThan(0);
  });
});
