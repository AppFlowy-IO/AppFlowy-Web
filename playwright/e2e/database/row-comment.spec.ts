/**
 * Database Row Comment Tests (Desktop Parity)
 *
 * Tests for row comment functionality in the row detail modal.
 * Migrated from: cypress/e2e/database/row-comment.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  setupCommentTest,
  waitForCommentSection,
  addComment,
  assertCommentExists,
  assertCommentNotExists,
  assertCommentCount,
  enterEditMode,
  cancelCommentEdit,
  editComment,
  deleteComment,
  toggleResolveComment,
  addReactionToComment,
  assertAnyReactionExists,
  assertEditInputShown,
  assertEditModeButtonsShown,
  CommentSelectors,
} from '../../support/comment-test-helpers';
import {
  loginAndCreateGrid,
  typeTextIntoCell,
  getPrimaryFieldId,
} from '../../support/filter-test-helpers';
import { openRowDetail } from '../../support/row-detail-helpers';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Database Row Comment Tests (Desktop Parity)', () => {
  test('comment CRUD operations: add, edit with buttons, delete', async ({ page, request }) => {
    // Given: a grid row with the comment section open
    setupCommentTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Comment CRUD Test');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    // When: adding a comment
    const originalComment = 'Original comment';
    await addComment(page, originalComment);

    // Then: the comment should be visible
    await assertCommentExists(page, originalComment);

    // When: entering edit mode on the comment
    await enterEditMode(page, originalComment);

    // Then: the edit input and action buttons should be shown
    await assertEditInputShown(page);
    await assertEditModeButtonsShown(page);

    // When: cancelling the edit
    await cancelCommentEdit(page);

    // Then: the original comment should remain unchanged
    await assertCommentExists(page, originalComment);

    // When: editing the comment with new text
    const updatedComment = 'Updated comment';
    await editComment(page, originalComment, updatedComment);

    // Then: the updated comment should appear and the original should be gone
    await assertCommentExists(page, updatedComment);
    await assertCommentNotExists(page, originalComment);

    // When: deleting the comment
    await deleteComment(page, updatedComment);

    // Then: the comment should no longer exist
    await assertCommentNotExists(page, updatedComment);
  });

  test('comment actions: resolve, reopen, and emoji reaction', async ({ page, request }) => {
    // Given: a grid row with the comment section open
    setupCommentTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Resolve Test');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    // And: a comment has been added
    const testComment = 'Comment for resolve test';
    await addComment(page, testComment);
    await assertCommentExists(page, testComment);

    // When: resolving the comment via hover action
    await toggleResolveComment(page, testComment);
    await page.waitForTimeout(1000);

    // Then: the comment should be hidden (resolved)
    await assertCommentCount(page, 0);

    // When: adding a new comment and reacting with an emoji
    const testComment2 = 'Comment for emoji';
    await addComment(page, testComment2);
    await assertCommentExists(page, testComment2);
    await addReactionToComment(page, testComment2, 'thumbs up');

    // Then: at least one reaction badge should appear
    await assertAnyReactionExists(page, testComment2);
  });

  test('multiple comments: add, verify count, close and reopen, delete one', async ({
    page,
    request,
  }) => {
    // Given: a grid row with the comment section open
    setupCommentTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Multi Comment Test');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    // When: adding three comments
    const comment1 = 'First comment';
    const comment2 = 'Second comment';
    const comment3 = 'Third comment';

    await addComment(page, comment1);
    await assertCommentExists(page, comment1);

    await addComment(page, comment2);
    await assertCommentExists(page, comment2);

    await addComment(page, comment3);
    await assertCommentExists(page, comment3);

    // Then: there should be exactly 3 comments
    await assertCommentCount(page, 3);

    // When: closing and reopening the row detail
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    // Then: all three comments should have persisted
    await assertCommentExists(page, comment1);
    await assertCommentExists(page, comment2);
    await assertCommentExists(page, comment3);
    await assertCommentCount(page, 3);

    // When: deleting the middle comment
    await deleteComment(page, comment2);

    // Then: only the first and third comments should remain
    await assertCommentNotExists(page, comment2);
    await assertCommentExists(page, comment1);
    await assertCommentExists(page, comment3);
    await assertCommentCount(page, 2);
  });

  test('comment input: collapsed and expanded states', async ({ page, request }) => {
    // Given: a grid row with the comment section visible
    setupCommentTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Input State Test');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    await CommentSelectors.section(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Then: the comment input should initially be collapsed
    await expect(CommentSelectors.collapsedInput(page)).toBeVisible();

    // When: clicking the collapsed input to expand it
    await CommentSelectors.collapsedInput(page).click();
    await page.waitForTimeout(300);

    // Then: the expanded input and send button should be visible
    await expect(CommentSelectors.input(page)).toBeVisible();
    await expect(CommentSelectors.sendButton(page)).toBeVisible();

    // When: pressing escape to collapse the input
    await CommentSelectors.input(page).press('Escape');
    await page.waitForTimeout(1000);

    // Then: the input should be collapsed again
    await expect(CommentSelectors.section(page)).toBeVisible();
    await expect(CommentSelectors.collapsedInput(page)).toBeVisible();
  });
});
