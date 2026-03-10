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
  /**
   * Test 1: Comment CRUD operations - add, edit with button verification, delete
   */
  test('comment CRUD operations: add, edit with buttons, delete', async ({ page, request }) => {
    setupCommentTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    // Type some content into first row
    await typeTextIntoCell(page, primaryFieldId, 0, 'Comment CRUD Test');
    await page.waitForTimeout(500);

    // Open first row detail page
    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);

    // Wait for comment section to appear
    await waitForCommentSection(page);

    // --- ADD ---
    const originalComment = 'Original comment';
    await addComment(page, originalComment);
    await assertCommentExists(page, originalComment);

    // --- ENTER EDIT MODE AND VERIFY BUTTONS ---
    await enterEditMode(page, originalComment);
    await assertEditInputShown(page);
    await assertEditModeButtonsShown(page);

    // --- TEST CANCEL BUTTON ---
    await cancelCommentEdit(page);
    await assertCommentExists(page, originalComment);

    // --- EDIT (complete the edit) ---
    const updatedComment = 'Updated comment';
    await editComment(page, originalComment, updatedComment);
    await assertCommentExists(page, updatedComment);
    await assertCommentNotExists(page, originalComment);

    // --- DELETE ---
    await deleteComment(page, updatedComment);
    await assertCommentNotExists(page, updatedComment);
  });

  /**
   * Test 2: Comment actions - resolve, reopen, and emoji reaction
   */
  test('comment actions: resolve, reopen, and emoji reaction', async ({ page, request }) => {
    setupCommentTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Resolve Test');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    // Add a comment
    const testComment = 'Comment for resolve test';
    await addComment(page, testComment);
    await assertCommentExists(page, testComment);

    // --- RESOLVE via hover action ---
    await toggleResolveComment(page, testComment);
    await page.waitForTimeout(1000);

    // After resolving, the comment should be hidden
    await assertCommentCount(page, 0);

    // --- EMOJI REACTION ---
    const testComment2 = 'Comment for emoji';
    await addComment(page, testComment2);
    await assertCommentExists(page, testComment2);

    // Add an emoji reaction by searching
    await addReactionToComment(page, testComment2, 'thumbs up');

    // Verify at least one reaction badge appeared
    await assertAnyReactionExists(page, testComment2);
  });

  /**
   * Test 3: Multiple comments - add several, verify count, close/reopen, delete one
   */
  test('multiple comments: add, verify count, close and reopen, delete one', async ({
    page,
    request,
  }) => {
    setupCommentTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Multi Comment Test');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    // Add multiple comments
    const comment1 = 'First comment';
    const comment2 = 'Second comment';
    const comment3 = 'Third comment';

    await addComment(page, comment1);
    await assertCommentExists(page, comment1);

    await addComment(page, comment2);
    await assertCommentExists(page, comment2);

    await addComment(page, comment3);
    await assertCommentExists(page, comment3);

    // Verify exactly 3 comments
    await assertCommentCount(page, 3);

    // --- CLOSE AND REOPEN to verify persistence ---
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);

    // Reopen the same row
    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    // Comments should still be there
    await assertCommentExists(page, comment1);
    await assertCommentExists(page, comment2);
    await assertCommentExists(page, comment3);
    await assertCommentCount(page, 3);

    // Delete the middle comment
    await deleteComment(page, comment2);

    // Verify deletion
    await assertCommentNotExists(page, comment2);
    await assertCommentExists(page, comment1);
    await assertCommentExists(page, comment3);
    await assertCommentCount(page, 2);
  });

  /**
   * Test 4: Comment input UI - collapsed/expanded states
   */
  test('comment input: collapsed and expanded states', async ({ page, request }) => {
    setupCommentTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Input State Test');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await waitForCommentSection(page);

    // Scroll comment section into view
    await CommentSelectors.section(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Initially collapsed - placeholder should be visible
    await expect(CommentSelectors.collapsedInput(page)).toBeVisible();

    // Click to expand
    await CommentSelectors.collapsedInput(page).click();
    await page.waitForTimeout(300);

    // Input should now be visible
    await expect(CommentSelectors.input(page)).toBeVisible();

    // Send button should be visible
    await expect(CommentSelectors.sendButton(page)).toBeVisible();

    // Press Escape to collapse back
    await CommentSelectors.input(page).press('Escape');
    await page.waitForTimeout(1000);

    // Should be collapsed again
    await expect(CommentSelectors.section(page)).toBeVisible();
    await expect(CommentSelectors.collapsedInput(page)).toBeVisible();
  });
});
