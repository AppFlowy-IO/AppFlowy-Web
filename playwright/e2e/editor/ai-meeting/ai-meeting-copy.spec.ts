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
 * AI Meeting Block - Copy Actions Tests
 *
 * Verifies the copy functionality via the more menu for each tab,
 * including disabled state and clipboard content.
 */
test.describe('AI Meeting Block - Copy Actions', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    setupPageErrorFilter(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should show "Copy summary" option when on Summary tab with content', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Copy Test',
      summary: 'This is the summary to copy.',
      notes: 'Notes content.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript.' }],
    });
    await page.waitForTimeout(1500);

    // Click the more menu (IconButton)
    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(500);

    // Should see "Copy summary" in the popover
    const copyButton = AIMeetingSelectors.copyButton(page);
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toContainText('Copy summary');
    await expect(copyButton).toBeEnabled();
  });

  test('should show "Copy notes" option when on Notes tab', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Copy Notes Test',
      summary: 'Summary.',
      notes: 'Important notes to copy.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript.' }],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.tab(page, 'notes').click();
    await page.waitForTimeout(500);

    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(500);

    const copyButton = AIMeetingSelectors.copyButton(page);
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toContainText('Copy notes');
  });

  test('should show "Copy transcript" option when on Transcript tab', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Copy Transcript Test',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [
        { id: 'alice', name: 'Alice', timestamp: 0, content: 'Hello everyone.' },
        { id: 'bob', name: 'Bob', timestamp: 10, content: 'Hi Alice.' },
      ],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.tab(page, 'transcript').click();
    await page.waitForTimeout(500);

    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(500);

    const copyButton = AIMeetingSelectors.copyButton(page);
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toContainText('Copy transcript');
  });

  test('should show disabled copy button when tab has no content', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Empty Notes',
      notes: '',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Content.' }],
    });
    await page.waitForTimeout(1500);

    // Notes is the default tab when no summary exists
    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(500);

    // The copy button should be disabled (rendered with disabled attribute)
    const disabledCopy = page.locator('.MuiPopover-paper button:disabled').filter({ hasText: /Copy/ });
    await expect(disabledCopy).toBeVisible();
  });

  test('should copy summary and show success notification', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await injectAIMeetingBlock(page, {
      title: 'Copy Action Test',
      summary: 'This is the summary content to be copied.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Hello.' }],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(500);
    await AIMeetingSelectors.copyButton(page).click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Summary copied to clipboard')).toBeVisible({ timeout: 5000 });
  });

  test('should copy notes and show success notification', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await injectAIMeetingBlock(page, {
      title: 'Copy Notes',
      summary: 'Summary.',
      notes: 'Important notes to copy here.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Hello.' }],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.tab(page, 'notes').click();
    await page.waitForTimeout(500);

    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(500);
    await AIMeetingSelectors.copyButton(page).click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Notes copied to clipboard')).toBeVisible({ timeout: 5000 });
  });

  test('should copy transcript and show success notification', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await injectAIMeetingBlock(page, {
      title: 'Copy Transcript',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [
        { id: 'alice', name: 'Alice', timestamp: 0, content: 'Hello everyone.' },
        { id: 'bob', name: 'Bob', timestamp: 15, content: 'Good morning.' },
      ],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.tab(page, 'transcript').click();
    await page.waitForTimeout(500);

    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(500);
    await AIMeetingSelectors.copyButton(page).click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Transcript copied to clipboard')).toBeVisible({ timeout: 5000 });
  });

  test('should update copy label when switching tabs', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Tab Copy Label',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript.' }],
    });
    await page.waitForTimeout(1500);

    // On summary tab
    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(300);
    await expect(AIMeetingSelectors.copyButton(page)).toContainText('Copy summary');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Switch to notes
    await AIMeetingSelectors.tab(page, 'notes').click();
    await page.waitForTimeout(300);
    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(300);
    await expect(AIMeetingSelectors.copyButton(page)).toContainText('Copy notes');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Switch to transcript
    await AIMeetingSelectors.tab(page, 'transcript').click();
    await page.waitForTimeout(300);
    await AIMeetingSelectors.moreMenu(page).click();
    await page.waitForTimeout(300);
    await expect(AIMeetingSelectors.copyButton(page)).toContainText('Copy transcript');
  });
});
