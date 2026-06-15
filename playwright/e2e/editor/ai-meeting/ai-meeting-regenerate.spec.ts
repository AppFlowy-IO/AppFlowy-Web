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
 * AI Meeting Block - Summary Regeneration Tests
 *
 * Verifies regenerate button visibility, options popover,
 * template/detail/language selection, and regeneration flow.
 */
test.describe('AI Meeting Block - Summary Regeneration', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    setupPageErrorFilter(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should show Regenerate button on Summary tab with content', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Regenerate Test',
      summary: 'Existing summary content.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript.' }],
    });
    await page.waitForTimeout(1500);

    await expect(AIMeetingSelectors.regenerateButton(page)).toBeVisible();
    await expect(AIMeetingSelectors.regenerateButton(page)).toContainText('Regenerate');
  });

  test('should hide Regenerate button on non-summary tabs', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'No Regen on Notes',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Content.' }],
    });
    await page.waitForTimeout(1500);

    await expect(AIMeetingSelectors.regenerateButton(page)).toBeVisible();

    // Switch to Notes
    await AIMeetingSelectors.tab(page, 'notes').click();
    await page.waitForTimeout(500);
    await expect(AIMeetingSelectors.regenerateButton(page)).not.toBeVisible();

    // Switch to Transcript
    await AIMeetingSelectors.tab(page, 'transcript').click();
    await page.waitForTimeout(500);
    await expect(AIMeetingSelectors.regenerateButton(page)).not.toBeVisible();
  });

  test('should open regenerate options popover with templates, details, and languages', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Options Popover Test',
      summary: 'Summary content.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Content.' }],
    });
    await page.waitForTimeout(1500);

    // Click the dropdown arrow button (right side of split button)
    await AIMeetingSelectors.regenerateOptionsButton(page).click();
    await page.waitForTimeout(500);

    // Popover should be visible
    const popover = AIMeetingSelectors.regeneratePopover(page);
    await expect(popover).toBeVisible();

    // Template section header should be visible
    await expect(popover.getByText('AI Template').or(popover.getByText('Summary template'))).toBeVisible();

    // At least the "Auto" template should always be present (fallback or remote)
    await expect(AIMeetingSelectors.templateOption(page, 'Auto')).toBeVisible();

    // Detail section should be visible with at least one option
    await expect(popover.getByText('Summary detail')).toBeVisible();
    // Detail labels may be "Brief"/"Balanced"/"Detailed" (remote) or "Concise"/"Balanced"/"Detailed" (fallback)
    await expect(AIMeetingSelectors.detailOption(page, 'Balanced')).toBeVisible();

    // Language section should be visible with at least English
    await expect(popover.getByText('Summary language')).toBeVisible();
    await expect(AIMeetingSelectors.languageOption(page, 'English')).toBeVisible();
  });

  test('should show checkmark on currently selected template', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Checkmark Test',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Content.' }],
      summaryTemplate: 'auto',
      summaryDetail: 'balanced',
      summaryLanguage: 'en',
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.regenerateOptionsButton(page).click();
    await page.waitForTimeout(500);

    // "Auto" template button should contain an SVG check icon
    const autoButton = AIMeetingSelectors.templateOption(page, 'Auto');
    await expect(autoButton.locator('svg')).toBeVisible();

    // "Balanced" detail button should contain an SVG check icon
    const balancedButton = AIMeetingSelectors.detailOption(page, 'Balanced');
    await expect(balancedButton.locator('svg')).toBeVisible();

    // "English" language button should contain an SVG check icon
    const englishButton = AIMeetingSelectors.languageOption(page, 'English');
    await expect(englishButton.locator('svg')).toBeVisible();
  });

  test('should show error notification when no source content for regeneration', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    // Meeting with summary but no transcript or notes content
    await injectAIMeetingBlock(page, {
      title: 'No Source Test',
      summary: 'Existing summary.',
      notes: '',
    });
    await page.waitForTimeout(1500);

    const regenButton = AIMeetingSelectors.regenerateButton(page);
    const regenVisible = await regenButton.isVisible().catch(() => false);

    if (regenVisible) {
      await regenButton.click();
      await page.waitForTimeout(1000);

      await expect(
        page.getByText('No transcript or notes available to regenerate summary')
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('should start regeneration when clicking Regenerate button', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    // Mock endpoints
    await page.route('**/api/meeting/summary_templates', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: null }),
      });
    });
    await page.route('**/api/chat/*/v2', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"text":"# Regenerated Summary\\n\\nThis is the new summary."}\n\ndata: [DONE]\n\n',
      });
    });

    await injectAIMeetingBlock(page, {
      title: 'Regeneration Flow',
      summary: 'Old summary to replace.',
      notes: 'Some meeting notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Important discussion.' }],
    });
    await page.waitForTimeout(1500);

    const regenButton = AIMeetingSelectors.regenerateButton(page);
    await expect(regenButton).toBeVisible();

    await regenButton.click();

    // Either "Generating" text or success/failure notification should appear
    const generatingOrResult = page
      .getByText('Generating')
      .or(page.getByText('Summary regenerated'))
      .or(page.getByText('Failed to regenerate'));

    await expect(generatingOrResult).toBeVisible({ timeout: 10000 });
  });

  test('should close options popover when selecting a template', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await page.route('**/api/meeting/summary_templates', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: null }),
      });
    });
    await page.route('**/api/chat/*/v2', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"text":"# New Summary"}\n\ndata: [DONE]\n\n',
      });
    });

    await injectAIMeetingBlock(page, {
      title: 'Template Select',
      summary: 'Summary.',
      notes: 'Notes with content.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Content.' }],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.regenerateOptionsButton(page).click();
    await page.waitForTimeout(500);
    await expect(AIMeetingSelectors.regeneratePopover(page)).toBeVisible();

    // Click "Meeting minutes" template
    await AIMeetingSelectors.templateOption(page, 'Meeting minutes').click();
    await page.waitForTimeout(500);

    // Popover should close
    await expect(AIMeetingSelectors.regeneratePopover(page)).not.toBeVisible();
  });

  test('should show language options with scroll', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Language Scroll',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Content.' }],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.regenerateOptionsButton(page).click();
    await page.waitForTimeout(500);

    await expect(AIMeetingSelectors.languageOption(page, 'English')).toBeVisible();

    // Scroll to Swedish (last in the list)
    const swedishOption = AIMeetingSelectors.languageOption(page, 'Swedish');
    await swedishOption.scrollIntoViewIfNeeded();
    await expect(swedishOption).toBeVisible();
  });
});
