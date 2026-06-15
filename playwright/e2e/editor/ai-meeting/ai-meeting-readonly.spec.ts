import { test, expect } from '@playwright/test';
import { generateRandomEmail } from '../../../support/test-config';
import {
  areTestUtilitiesAvailable,
  injectAIMeetingBlock,
  setupPageErrorFilter,
  setupEditorWithCleanPage,
  AIMeetingSelectors,
} from '../../../support/ai-meeting-helpers';

/**
 * AI Meeting Block - Read-Only Behavior Tests
 *
 * Verifies behavior in write mode (title editable, regenerate visible,
 * copy works, tabs work) which contrasts with read-only mode behavior.
 */
test.describe('AI Meeting Block - Read-Only Behavior', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    setupPageErrorFilter(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('title input should be enabled in write mode', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Editable Meeting',
      summary: 'Summary content.',
      notes: 'Notes content.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Hello.' }],
    });
    await page.waitForTimeout(1500);

    const titleInput = AIMeetingSelectors.title(page);
    await expect(titleInput).not.toBeDisabled();
    await expect(titleInput).toHaveValue('Editable Meeting');
  });

  test('tab switching should work', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Tab Switch RO',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript.' }],
    });
    await page.waitForTimeout(1500);

    const block = AIMeetingSelectors.block(page);

    await AIMeetingSelectors.tab(page, 'notes').click();
    await page.waitForTimeout(300);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'notes');
    await expect(AIMeetingSelectors.notesSection(page)).toBeVisible();

    await AIMeetingSelectors.tab(page, 'transcript').click();
    await page.waitForTimeout(300);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'transcript');
    await expect(AIMeetingSelectors.transcriptSection(page)).toBeVisible();

    await AIMeetingSelectors.tab(page, 'summary').click();
    await page.waitForTimeout(300);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'summary');
    await expect(AIMeetingSelectors.summarySection(page)).toBeVisible();
  });

  test('more menu should be accessible for copy', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Copy RO',
      summary: 'Summary content to copy.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript.' }],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(500);

    const copyButton = AIMeetingSelectors.copyButton(page);
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toContainText('Copy summary');
    await expect(copyButton).toBeEnabled();
  });

  test('regenerate button should be visible in write mode on summary tab', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Regen Visibility',
      summary: 'Summary with content.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript.' }],
    });
    await page.waitForTimeout(1500);

    await expect(AIMeetingSelectors.regenerateButton(page)).toBeVisible();
  });
});
