import { test, expect, Page } from '@playwright/test';
import { signInAndNavigate } from './support/auth-utils';

/**
 * BDD Playwright tests for Video Embed Block feature
 * Covers: URL validation, normalization, paste handling, error display, and edge cases
 */

test.describe('Feature: Video Embed Block', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await signInAndNavigate(page);
    // Wait for the app to load by checking for the add page button
    await page.locator('[data-testid="inline-add-page"]').first().waitFor({ state: 'visible', timeout: 30000 });
  });

  test.afterEach(async () => {
    await page.close();
  });

  /**
   * Helper: Create a new document page (opens in modal)
   */
  async function createNewDocPage() {
    const addBtn = page.locator('[data-testid="inline-add-page"]').first();
    await addBtn.click();
    await page.waitForTimeout(500);
    await page.getByText('Document', { exact: true }).first().click();
    await page.waitForTimeout(2000);
  }

  /**
   * Helper: Get the editor (last one = the one in the modal)
   */
  function getEditor() {
    return page.locator('[data-testid="editor-content"]').last();
  }

  /**
   * Helper: Insert video block via slash command
   */
  async function insertVideoBlock() {
    const editor = getEditor();
    await editor.click({ force: true, position: { x: 100, y: 10 } });
    await page.waitForTimeout(300);
    await page.keyboard.type('/video');
    await page.waitForTimeout(800);
    await page.locator('[data-testid="slash-menu-video"]').click();
    await page.waitForTimeout(800);
  }

  /**
   * Helper: Get the embed link input
   */
  function getEmbedInput() {
    return page.locator('input[placeholder*="video link"]');
  }

  /**
   * Helper: Fill URL and check if validation error appears
   */
  async function fillUrlAndCheckValidation(url: string): Promise<boolean> {
    const input = getEmbedInput();
    await input.fill(url);
    await page.waitForTimeout(500);
    const errorIndicator = page.locator('.text-text-error');
    return await errorIndicator.isVisible();
  }

  // ─────────────────────────────────────────────────────────
  // Scenario: Insert video via slash command with valid URL
  // ─────────────────────────────────────────────────────────
  test('Given a new page, when user inserts a YouTube video via slash command, then a video player renders', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    // Enter a valid YouTube URL
    const input = getEmbedInput();
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.waitForTimeout(300);

    // No validation error should appear
    const hasError = await page.locator('.text-text-error').isVisible();
    expect(hasError).toBe(false);

    // Submit
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Video block should show the player (not the empty/error state)
    const embedBlock = page.locator('.embed-block').last();
    await expect(embedBlock).toBeVisible();
    // The embed block should NOT have error styling
    const errorText = embedBlock.locator('.text-function-error');
    await expect(errorText).toHaveCount(0);
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Paste a video URL to create a video block
  // ─────────────────────────────────────────────────────────
  test('Given a new page, when user pastes a YouTube URL, then a video block is created', async () => {
    await createNewDocPage();

    const editor = getEditor();
    await editor.click({ force: true, position: { x: 100, y: 10 } });
    await page.waitForTimeout(300);

    // Paste a YouTube URL via clipboard event
    await page.evaluate((url) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', url);
      const event = new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      });
      document.querySelectorAll('[data-slate-editor="true"]')[1]?.dispatchEvent(event);
    }, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.waitForTimeout(3000);

    // A video embed block should appear
    const embedBlock = page.locator('.embed-block').last();
    await expect(embedBlock).toBeVisible({ timeout: 10000 });
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Protocol-less URL is normalized (Bug fix)
  // ─────────────────────────────────────────────────────────
  test('Given a video block, when user enters a URL without protocol, then it is accepted after normalization', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    // Enter URL without protocol
    const hasError = await fillUrlAndCheckValidation('youtube.com/watch?v=dQw4w9WgXcQ');

    // Should NOT show error — processUrl normalizes to https://
    expect(hasError).toBe(false);
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Audio-only URLs are rejected (Bug fix)
  // ─────────────────────────────────────────────────────────
  test('Given a video block, when user enters an audio-only .mp3 URL, then it is rejected', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    // Enter an audio-only URL
    const hasError = await fillUrlAndCheckValidation('https://example.com/audio.mp3');

    // Should show error — audio files are not valid video URLs
    expect(hasError).toBe(true);
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Case-insensitive protocol accepted (Bug fix)
  // ─────────────────────────────────────────────────────────
  test('Given a video block, when user enters URL with uppercase HTTPS://, then it is accepted', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    // Enter URL with uppercase protocol
    const hasError = await fillUrlAndCheckValidation('HTTPS://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // Should NOT show error
    expect(hasError).toBe(false);
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Invalid non-video URL shows validation error
  // ─────────────────────────────────────────────────────────
  test('Given a video block, when user enters a non-video URL, then validation error appears', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    // Enter a non-video URL
    const hasError = await fillUrlAndCheckValidation('https://example.com/document.pdf');

    // Should show error — PDF is not a video
    expect(hasError).toBe(true);
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Dangerous protocols are rejected
  // ─────────────────────────────────────────────────────────
  test('Given a video block, when user enters javascript: URL, then validation error appears', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    // Enter a dangerous protocol URL
    const hasError = await fillUrlAndCheckValidation('javascript:alert(1)');

    // Should show error — dangerous protocol
    expect(hasError).toBe(true);
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Vimeo URL is accepted
  // ─────────────────────────────────────────────────────────
  test('Given a video block, when user enters a Vimeo URL, then it is accepted', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    const hasError = await fillUrlAndCheckValidation('https://vimeo.com/148751763');
    expect(hasError).toBe(false);
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Direct .mp4 file URL is accepted
  // ─────────────────────────────────────────────────────────
  test('Given a video block, when user enters a direct .mp4 URL, then it is accepted', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    const hasError = await fillUrlAndCheckValidation('https://example.com/video.mp4');
    expect(hasError).toBe(false);
  });

  // ─────────────────────────────────────────────────────────
  // Scenario: Empty video block shows embed prompt
  // ─────────────────────────────────────────────────────────
  test('Given a new page, when user inserts a video block, then the embed popover appears', async () => {
    await createNewDocPage();
    await insertVideoBlock();

    // The embed block should be visible with the "Embed a video" text
    const embedBlock = page.locator('.embed-block').last();
    await expect(embedBlock).toBeVisible();

    // The embed link input should be visible
    const input = getEmbedInput();
    await expect(input).toBeVisible();
  });
});
