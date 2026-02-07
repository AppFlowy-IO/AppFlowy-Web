/**
 * Row Comment test helpers for database E2E tests
 * Mirrors test operations from: database_row_comment_test.dart
 */
import 'cypress-real-events';
import { waitForReactUpdate } from './selectors';

/**
 * Comment-related selectors
 */
export const CommentSelectors = {
  // Comment section container
  section: () => cy.get('[data-testid="row-comment-section"]'),

  // All comment items
  items: () => cy.get('[data-testid="row-comment-item"]'),

  // Comment content text
  content: () => cy.get('[data-testid="row-comment-content"]'),

  // Comment containing specific text
  itemWithText: (text: string) =>
    cy.get('[data-testid="row-comment-item"]').filter(`:contains("${text}")`),

  // Collapsed input placeholder ("Add a reply...")
  collapsedInput: () => cy.get('[data-testid="row-comment-collapsed-input"]'),

  // Expanded textarea input
  input: () => cy.get('[data-testid="row-comment-input"]'),

  // Send button
  sendButton: () => cy.get('[data-testid="row-comment-send-button"]'),

  // Hover action buttons (visible on hover)
  actions: () => cy.get('[data-testid="row-comment-actions"]'),
  emojiButton: () => cy.get('[data-testid="row-comment-emoji-button"]'),
  resolveButton: () => cy.get('[data-testid="row-comment-resolve-button"]'),
  moreButton: () => cy.get('[data-testid="row-comment-more-button"]'),

  // More menu items
  editAction: () => cy.get('[data-testid="row-comment-edit-action"]'),
  deleteAction: () => cy.get('[data-testid="row-comment-delete-action"]'),

  // Edit mode
  editSaveButton: () => cy.get('[data-testid="row-comment-edit-save"]'),
  editCancelButton: () => cy.get('[data-testid="row-comment-edit-cancel"]'),

  // Delete confirmation dialog
  deleteConfirmButton: () => cy.get('[data-testid="delete-comment-confirm"]'),
  deleteCancelButton: () => cy.get('[data-testid="delete-comment-cancel"]'),

  // Reaction badges
  reaction: (emoji: string) => cy.get(`[data-testid="row-comment-reaction-${emoji}"]`),
};

/**
 * Common beforeEach setup for comment tests
 */
export const setupCommentTest = () => {
  cy.on('uncaught:exception', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found') ||
      err.message.includes('ResizeObserver loop')
    ) {
      return false;
    }

    return true;
  });

  cy.viewport(1280, 900);
};

/**
 * Wait for the comment section to be visible inside the row detail modal
 */
export const waitForCommentSection = (): void => {
  CommentSelectors.section().should('exist').and('be.visible');
  waitForReactUpdate(500);
};

/**
 * Expand the comment input (click the collapsed "Add a reply..." placeholder)
 */
export const expandCommentInput = (): void => {
  CommentSelectors.collapsedInput().should('be.visible').click();
  waitForReactUpdate(300);
  CommentSelectors.input().should('exist');
};

/**
 * Add a new comment by typing text and pressing Enter (or clicking send)
 */
export const addComment = (text: string): void => {
  // Expand input if collapsed
  cy.get('body').then(($body) => {
    if ($body.find('[data-testid="row-comment-collapsed-input"]:visible').length > 0) {
      expandCommentInput();
    }
  });

  CommentSelectors.input().should('be.visible').clear().type(text, { delay: 20 });
  waitForReactUpdate(300);

  // Click send button
  CommentSelectors.sendButton().should('not.be.disabled').click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Assert a comment with the given text exists
 */
export const assertCommentExists = (text: string): void => {
  CommentSelectors.section().should('contain.text', text);
};

/**
 * Assert a comment with the given text does NOT exist
 */
export const assertCommentNotExists = (text: string): void => {
  CommentSelectors.section().should('not.contain.text', text);
};

/**
 * Assert the exact number of comment items
 */
export const assertCommentCount = (count: number): void => {
  CommentSelectors.items().should('have.length', count);
};

/**
 * Hover a comment to reveal its action buttons, then return the actions bar
 */
export const hoverComment = (commentText: string): void => {
  CommentSelectors.itemWithText(commentText)
    .first()
    .scrollIntoView()
    .realHover();
  waitForReactUpdate(500);

  // Actions should appear on hover
  CommentSelectors.itemWithText(commentText)
    .first()
    .find('[data-testid="row-comment-actions"]')
    .should('be.visible');
};

/**
 * Enter edit mode for a comment via the hover More menu
 */
export const enterEditMode = (commentText: string): void => {
  hoverComment(commentText);

  // Click the more button
  CommentSelectors.itemWithText(commentText)
    .first()
    .find('[data-testid="row-comment-more-button"]')
    .click({ force: true });
  waitForReactUpdate(300);

  // Click Edit in dropdown
  CommentSelectors.editAction().should('be.visible').click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Cancel an in-progress comment edit
 */
export const cancelCommentEdit = (): void => {
  CommentSelectors.editCancelButton().should('be.visible').click({ force: true });
  waitForReactUpdate(300);
};

/**
 * Edit a comment: enter edit mode, clear text, type new text, save
 */
export const editComment = (originalText: string, newText: string): void => {
  enterEditMode(originalText);

  // The edit textarea should be visible inside the comment item
  // Find the textarea inside the editing area
  cy.get('textarea:visible').first().clear().type(newText, { delay: 20 });
  waitForReactUpdate(300);

  // Click save
  CommentSelectors.editSaveButton().should('be.visible').click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Delete a comment via hover More menu → Delete → confirm dialog
 */
export const deleteComment = (commentText: string): void => {
  hoverComment(commentText);

  // Click the more button
  CommentSelectors.itemWithText(commentText)
    .first()
    .find('[data-testid="row-comment-more-button"]')
    .click({ force: true });
  waitForReactUpdate(300);

  // Click Delete in dropdown
  CommentSelectors.deleteAction().should('be.visible').click({ force: true });
  waitForReactUpdate(500);

  // Confirm deletion
  CommentSelectors.deleteConfirmButton().should('be.visible').click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Toggle resolve/reopen on a comment via hover action
 */
export const toggleResolveComment = (commentText: string): void => {
  hoverComment(commentText);

  // Click the resolve button — use realClick to ensure reliable click through hover overlay
  CommentSelectors.itemWithText(commentText)
    .first()
    .find('[data-testid="row-comment-resolve-button"]')
    .realClick();
  waitForReactUpdate(2000);
};

/**
 * Add an emoji reaction to a comment via the random emoji button in the picker.
 * Uses the random emoji button for reliability (avoids search/virtualizer timing issues).
 */
export const addRandomReactionToComment = (commentText: string): void => {
  hoverComment(commentText);

  // Click the emoji button to open picker
  CommentSelectors.itemWithText(commentText)
    .first()
    .find('[data-testid="row-comment-emoji-button"]')
    .click({ force: true });
  waitForReactUpdate(500);

  // The emoji picker popover should be open — click the random emoji button
  cy.get('.emoji-picker [data-testid="random-emoji"]').first().click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Add an emoji reaction to a comment by searching for a specific emoji.
 * @param commentText - Text of the comment to react to
 * @param searchTerm - Search term (e.g. "thumbs up", "smile")
 */
export const addReactionToComment = (commentText: string, searchTerm: string): void => {
  hoverComment(commentText);

  // Click the emoji button to open picker
  CommentSelectors.itemWithText(commentText)
    .first()
    .find('[data-testid="row-comment-emoji-button"]')
    .click({ force: true });
  waitForReactUpdate(500);

  // The emoji picker popover should be open
  // Search using the search-emoji-input (AppFlowy's SearchInput component)
  cy.get('.emoji-picker .search-emoji-input input, .emoji-picker input')
    .first()
    .should('be.visible')
    .clear()
    .type(searchTerm, { delay: 20 });
  waitForReactUpdate(800);

  // Click the first emoji result — emoji items are Button elements with ghost variant
  cy.get('.emoji-picker .List button')
    .first()
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Assert a reaction badge exists for a given emoji on a comment
 */
export const assertReactionExists = (commentText: string, emoji: string): void => {
  CommentSelectors.itemWithText(commentText)
    .first()
    .find(`[data-testid="row-comment-reaction-${emoji}"]`)
    .should('exist');
};

/**
 * Assert that at least one reaction badge exists on a comment
 */
export const assertAnyReactionExists = (commentText: string): void => {
  CommentSelectors.itemWithText(commentText)
    .first()
    .find('[data-testid^="row-comment-reaction-"]')
    .should('have.length.at.least', 1);
};

/**
 * Assert edit mode UI elements are visible
 */
export const assertEditInputShown = (): void => {
  cy.get('textarea:visible').should('exist');
};

/**
 * Assert edit mode buttons (cancel, save) are shown
 */
export const assertEditModeButtonsShown = (): void => {
  CommentSelectors.editSaveButton().should('exist').and('be.visible');
  CommentSelectors.editCancelButton().should('exist').and('be.visible');
};
