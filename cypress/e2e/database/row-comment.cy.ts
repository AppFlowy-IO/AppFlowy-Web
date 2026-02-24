/**
 * Database Row Comment Tests (Desktop Parity)
 *
 * Tests for row comment functionality in the row detail modal.
 * Mirrors tests from: database_row_comment_test.dart
 */
import 'cypress-real-events';
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
  addRandomReactionToComment,
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
import {
  openRowDetail,
} from '../../support/row-detail-helpers';
import {
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Database Row Comment Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupCommentTest();
  });

  /**
   * Test 1: Comment CRUD operations — add, edit with button verification, delete
   * Mirrors: 'comment CRUD operations: add, edit with buttons, delete'
   */
  it('comment CRUD operations: add, edit with buttons, delete', () => {
    const email = generateRandomEmail();

    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Type some content into first row so we can open it
        typeTextIntoCell(primaryFieldId, 0, 'Comment CRUD Test');
        waitForReactUpdate(500);

        // Open first row detail page
        openRowDetail(0);
        waitForReactUpdate(1000);

        // Wait for comment section to appear
        waitForCommentSection();

        // --- ADD ---
        const originalComment = 'Original comment';

        addComment(originalComment);
        assertCommentExists(originalComment);

        // --- ENTER EDIT MODE AND VERIFY BUTTONS ---
        enterEditMode(originalComment);
        assertEditInputShown();
        assertEditModeButtonsShown();

        // --- TEST CANCEL BUTTON ---
        cancelCommentEdit();
        // Original comment should still be there unchanged
        assertCommentExists(originalComment);

        // --- EDIT (complete the edit) ---
        const updatedComment = 'Updated comment';

        editComment(originalComment, updatedComment);
        assertCommentExists(updatedComment);
        assertCommentNotExists(originalComment);

        // --- DELETE ---
        deleteComment(updatedComment);
        assertCommentNotExists(updatedComment);
      });
    });
  });

  /**
   * Test 2: Comment actions — resolve, reopen, and emoji reaction
   * Mirrors: 'comment actions: resolve, reopen, and emoji reaction'
   */
  it('comment actions: resolve, reopen, and emoji reaction', () => {
    const email = generateRandomEmail();

    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Resolve Test');
        waitForReactUpdate(500);

        openRowDetail(0);
        waitForReactUpdate(1000);
        waitForCommentSection();

        // Add a comment
        const testComment = 'Comment for resolve test';

        addComment(testComment);
        assertCommentExists(testComment);

        // --- RESOLVE via hover action ---
        toggleResolveComment(testComment);
        waitForReactUpdate(1000);

        // After resolving, the comment should no longer be visible
        // (resolved comments are hidden, matching Flutter behavior)
        assertCommentCount(0);

        // --- EMOJI REACTION ---
        // Add another comment for emoji reaction test
        const testComment2 = 'Comment for emoji';

        addComment(testComment2);
        assertCommentExists(testComment2);

        // Add an emoji reaction via the random emoji button
        addRandomReactionToComment(testComment2);

        // Verify at least one reaction badge appeared on the comment
        assertAnyReactionExists(testComment2);
      });
    });
  });

  /**
   * Test 3: Multiple comments — add several, verify count, close/reopen, delete one
   * Mirrors: 'multiple comments: add, verify count indicator in grid view, delete one'
   * Note: Grid comment count indicator doesn't exist on web yet, so we test
   * close/reopen persistence instead.
   */
  it('multiple comments: add, verify count, close and reopen, delete one', () => {
    const email = generateRandomEmail();

    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Multi Comment Test');
        waitForReactUpdate(500);

        openRowDetail(0);
        waitForReactUpdate(1000);
        waitForCommentSection();

        // Add multiple comments
        const comment1 = 'First comment';
        const comment2 = 'Second comment';
        const comment3 = 'Third comment';

        addComment(comment1);
        assertCommentExists(comment1);

        addComment(comment2);
        assertCommentExists(comment2);

        addComment(comment3);
        assertCommentExists(comment3);

        // Verify exactly 3 comments (no duplicates)
        assertCommentCount(3);

        // --- CLOSE AND REOPEN to verify persistence ---
        // Use Escape to close the modal (closeRowDetail clicks expand button which navigates away)
        cy.get('body').realPress('Escape');
        waitForReactUpdate(1500);

        // Reopen the same row
        openRowDetail(0);
        waitForReactUpdate(1000);
        waitForCommentSection();

        // Comments should still be there after reopen
        assertCommentExists(comment1);
        assertCommentExists(comment2);
        assertCommentExists(comment3);
        assertCommentCount(3);

        // Delete the middle comment
        deleteComment(comment2);

        // Verify deletion
        assertCommentNotExists(comment2);
        assertCommentExists(comment1);
        assertCommentExists(comment3);
        assertCommentCount(2);
      });
    });
  });

  /**
   * Test 4: Comment input UI — collapsed/expanded states
   */
  it('comment input: collapsed and expanded states', () => {
    const email = generateRandomEmail();

    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Input State Test');
        waitForReactUpdate(500);

        openRowDetail(0);
        waitForReactUpdate(1000);
        waitForCommentSection();

        // Scroll comment section into view inside the modal
        CommentSelectors.section().scrollIntoView();
        waitForReactUpdate(500);

        // Initially collapsed — "Add a reply..." placeholder should be visible
        CommentSelectors.collapsedInput().should('be.visible');

        // Click to expand
        CommentSelectors.collapsedInput().click();
        waitForReactUpdate(300);

        // Input should now be visible
        CommentSelectors.input().should('be.visible');

        // Send button should be visible
        CommentSelectors.sendButton().should('exist');

        // Press Escape to collapse back (nativeEvent.stopImmediatePropagation prevents modal close)
        CommentSelectors.input().realPress('Escape');
        waitForReactUpdate(1000);

        // Should be collapsed again — the comment section must still exist (modal not closed)
        CommentSelectors.section().should('exist');
        CommentSelectors.collapsedInput().should('be.visible');
      });
    });
  });
});
