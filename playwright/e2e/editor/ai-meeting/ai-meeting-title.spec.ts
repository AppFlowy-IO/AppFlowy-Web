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
 * AI Meeting Block - Title Editing Tests
 *
 * Verifies title display, editing, saving on blur/Enter, and empty revert.
 */
test.describe('AI Meeting Block - Title Editing', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    setupPageErrorFilter(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should display stored title', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Team Standup',
      notes: 'Some notes.',
    });
    await page.waitForTimeout(1500);

    await expect(AIMeetingSelectors.title(page)).toHaveValue('Team Standup');
  });

  test('should save title on blur', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Old Title',
      notes: 'Content.',
    });
    await page.waitForTimeout(1500);

    const titleInput = AIMeetingSelectors.title(page);

    // Clear and type new title
    await titleInput.click();
    await titleInput.fill('New Title');

    // Blur by pressing Tab to move focus away
    await titleInput.press('Tab');
    await page.waitForTimeout(500);

    await expect(titleInput).toHaveValue('New Title');
  });

  test('should save title on Enter key and blur input', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Old Title',
      notes: 'Content.',
    });
    await page.waitForTimeout(1500);

    const titleInput = AIMeetingSelectors.title(page);

    await titleInput.click();
    await titleInput.fill('Updated Title');
    await titleInput.press('Enter');
    await page.waitForTimeout(500);

    await expect(titleInput).toHaveValue('Updated Title');

    // Title input should lose focus
    const isFocused = await titleInput.evaluate((el) => document.activeElement === el);
    expect(isFocused).toBe(false);
  });

  test('should revert to stored title when cleared', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    // Block with a stored title — clearing reverts to stored title
    await injectAIMeetingBlock(page, {
      title: 'Some Title',
      notes: 'Content.',
    });
    await page.waitForTimeout(1500);

    const titleInput = AIMeetingSelectors.title(page);

    // Focus and clear via Playwright fill (uses CDP Input.insertText protocol)
    await titleInput.focus();
    await titleInput.fill('');
    await page.waitForTimeout(200);

    // Blur the input to trigger commitTitle — should revert to displayTitle
    await titleInput.evaluate((el) => (el as HTMLInputElement).blur());
    await page.waitForTimeout(500);

    // When stored title is "Some Title", commitTitle reverts empty input to "Some Title"
    await expect(titleInput).toHaveValue('Some Title');
  });

  test('should show default "Meeting" title for new block without title', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      notes: 'Some notes here.',
    });
    await page.waitForTimeout(1500);

    await expect(AIMeetingSelectors.title(page)).toHaveValue('Meeting');
  });
});
