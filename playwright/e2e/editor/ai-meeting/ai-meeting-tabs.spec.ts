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
 * AI Meeting Block - Tab Switching Tests
 *
 * Verifies tab switching behavior, active state persistence,
 * and CSS visibility toggling between sections.
 */
test.describe('AI Meeting Block - Tab Switching', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    setupPageErrorFilter(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should default to Summary tab when all sections have content', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Tab Test',
      summary: 'Summary content.',
      notes: 'Notes content.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Hello.' }],
    });
    await page.waitForTimeout(1500);

    const block = AIMeetingSelectors.block(page);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'summary');

    await expect(AIMeetingSelectors.summarySection(page)).toBeVisible();
    await expect(AIMeetingSelectors.notesSection(page)).not.toBeVisible();
    await expect(AIMeetingSelectors.transcriptSection(page)).not.toBeVisible();
  });

  test('should switch to Notes tab and show notes content', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Tab Switch Test',
      summary: 'Summary.',
      notes: 'Notes content visible here.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript.' }],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.tab(page, 'notes').click();
    await page.waitForTimeout(500);

    const block = AIMeetingSelectors.block(page);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'notes');
    await expect(AIMeetingSelectors.notesSection(page)).toBeVisible();
    await expect(AIMeetingSelectors.summarySection(page)).not.toBeVisible();
    await expect(AIMeetingSelectors.transcriptSection(page)).not.toBeVisible();
  });

  test('should switch to Transcript tab and show transcript content', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Transcript Tab Test',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [
        { id: 'alice', name: 'Alice', timestamp: 0, content: 'This is the transcript.' },
        { id: 'bob', name: 'Bob', timestamp: 10, content: 'I agree.' },
      ],
    });
    await page.waitForTimeout(1500);

    await AIMeetingSelectors.tab(page, 'transcript').click();
    await page.waitForTimeout(500);

    const block = AIMeetingSelectors.block(page);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'transcript');
    await expect(AIMeetingSelectors.transcriptSection(page)).toBeVisible();
    await expect(AIMeetingSelectors.summarySection(page)).not.toBeVisible();
    await expect(AIMeetingSelectors.notesSection(page)).not.toBeVisible();

    // Speaker names visible
    await expect(page.locator('.ai-meeting-speaker__name').first()).toContainText('Alice');
  });

  test('should switch between all tabs correctly', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Multi-Tab Test',
      summary: 'Summary text.',
      notes: 'Notes text.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript text.' }],
    });
    await page.waitForTimeout(1500);

    const block = AIMeetingSelectors.block(page);

    await expect(block).toHaveAttribute('data-ai-meeting-active', 'summary');

    await AIMeetingSelectors.tab(page, 'notes').click();
    await page.waitForTimeout(300);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'notes');

    await AIMeetingSelectors.tab(page, 'transcript').click();
    await page.waitForTimeout(300);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'transcript');

    await AIMeetingSelectors.tab(page, 'summary').click();
    await page.waitForTimeout(300);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'summary');
    await expect(AIMeetingSelectors.summarySection(page)).toBeVisible();
  });

  test('should restore tab from selected_tab_index on load', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Persist Tab Test',
      summary: 'Summary.',
      notes: 'Notes.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Content.' }],
      selectedTabIndex: 2,
    });
    await page.waitForTimeout(1500);

    const block = AIMeetingSelectors.block(page);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'transcript');
    await expect(AIMeetingSelectors.transcriptSection(page)).toBeVisible();
  });

  test('should default to notes when only notes and transcript tabs exist', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    // No summary content, so summary tab won't appear
    await injectAIMeetingBlock(page, {
      title: 'No Summary',
      notes: 'Notes only.',
      speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Hello.' }],
    });
    await page.waitForTimeout(1500);

    const block = AIMeetingSelectors.block(page);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'notes');
    await expect(AIMeetingSelectors.notesSection(page)).toBeVisible();
  });
});
