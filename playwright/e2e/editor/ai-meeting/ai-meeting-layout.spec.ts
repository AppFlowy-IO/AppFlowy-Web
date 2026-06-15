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
 * AI Meeting Block - Layout & Rendering Tests
 *
 * Verifies the AI meeting block renders correctly with title, tabs,
 * sections, and speaker blocks.
 */
test.describe('AI Meeting Block - Layout', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    setupPageErrorFilter(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should render meeting block with title and all three tabs', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available (expected in CI/production builds)');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Sprint Review',
      summary: 'Overview of sprint achievements and action items.',
      notes: 'Remember to follow up on deployment timeline.',
      speakers: [
        { id: 'alice', name: 'Alice', timestamp: 0, content: 'Welcome everyone to the sprint review.' },
        { id: 'bob', name: 'Bob', timestamp: 15, content: 'We completed 8 out of 10 story points.' },
      ],
    });
    await page.waitForTimeout(1500);

    // Then I should see the meeting block
    const block = AIMeetingSelectors.block(page);
    await expect(block).toBeVisible();

    // And I should see the meeting title
    const titleInput = AIMeetingSelectors.title(page);
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toHaveValue('Sprint Review');

    // And I should see Summary, Notes, and Transcript tabs
    await expect(AIMeetingSelectors.tab(page, 'summary')).toBeVisible();
    await expect(AIMeetingSelectors.tab(page, 'notes')).toBeVisible();
    await expect(AIMeetingSelectors.tab(page, 'transcript')).toBeVisible();
  });

  test('should hide tabs when show_notes_directly is true', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Quick Notes',
      notes: 'Just some quick notes without tabs.',
      showNotesDirectly: true,
    });
    await page.waitForTimeout(1500);

    // Then I should not see any tab buttons
    await expect(page.locator('.ai-meeting-tabs')).not.toBeVisible();

    // And the notes section should be visible
    await expect(AIMeetingSelectors.notesSection(page)).toBeVisible();
  });

  test('should hide Summary tab when summary section is empty', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'No Summary Meeting',
      notes: 'Some notes here.',
      speakers: [
        { id: 'alice', name: 'Alice', timestamp: 0, content: 'Hello there.' },
      ],
    });
    await page.waitForTimeout(1500);

    // Then the Summary tab should not be visible (no summary content)
    await expect(AIMeetingSelectors.tab(page, 'summary')).not.toBeVisible();

    // And Notes and Transcript tabs should be visible
    await expect(AIMeetingSelectors.tab(page, 'notes')).toBeVisible();
    await expect(AIMeetingSelectors.tab(page, 'transcript')).toBeVisible();
  });

  test('should render speaker blocks with name and timestamp in transcript', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Team Standup',
      summary: 'A brief standup summary.',
      notes: '',
      speakers: [
        { id: 'alice', name: 'Alice Chen', timestamp: 65, content: 'Yesterday I worked on the login page.' },
        { id: 'bob', name: 'Bob Smith', timestamp: 130, content: 'I reviewed the API changes.' },
      ],
    });
    await page.waitForTimeout(1500);

    // Switch to transcript tab
    await AIMeetingSelectors.tab(page, 'transcript').click();
    await page.waitForTimeout(500);

    // Then each speaker block should be visible
    const speakerBlocks = AIMeetingSelectors.speakerBlocks(page);
    await expect(speakerBlocks).toHaveCount(2);

    // Verify speaker names
    const firstSpeaker = speakerBlocks.first();
    await expect(firstSpeaker.locator('.ai-meeting-speaker__name')).toContainText('Alice Chen');
    await expect(firstSpeaker.locator('.ai-meeting-speaker__timestamp')).toContainText('01:05');

    const secondSpeaker = speakerBlocks.nth(1);
    await expect(secondSpeaker.locator('.ai-meeting-speaker__name')).toContainText('Bob Smith');
    await expect(secondSpeaker.locator('.ai-meeting-speaker__timestamp')).toContainText('02:10');
  });

  test('should show default title when no stored title', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      notes: 'Some content.',
    });
    await page.waitForTimeout(1500);

    await expect(AIMeetingSelectors.title(page)).toHaveValue('Meeting');
  });

  test('should display only active tab section content via CSS visibility', async ({ page, request }) => {
    await setupEditorWithCleanPage(page, request, testEmail);

    const available = await areTestUtilitiesAvailable(page);
    if (!available) {
      test.skip(true, 'Test utilities not available');
      return;
    }

    await injectAIMeetingBlock(page, {
      title: 'Visibility Test',
      summary: 'Summary content here.',
      notes: 'Notes content here.',
      speakers: [
        { id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript content here.' },
      ],
    });
    await page.waitForTimeout(1500);

    // Default active tab is summary
    const block = AIMeetingSelectors.block(page);
    await expect(block).toHaveAttribute('data-ai-meeting-active', 'summary');

    // Summary visible, others hidden by CSS
    await expect(AIMeetingSelectors.summarySection(page)).toBeVisible();
    await expect(AIMeetingSelectors.notesSection(page)).not.toBeVisible();
    await expect(AIMeetingSelectors.transcriptSection(page)).not.toBeVisible();
  });
});
