/**
 * Row Comment test helpers for database E2E tests (Playwright)
 * Migrated from: cypress/support/comment-test-helpers.ts
 *
 * Mirrors test operations from: database_row_comment_test.dart
 */
import { Page, expect } from '@playwright/test';

/**
 * Comment-related selectors (Playwright)
 */
export const CommentSelectors = {
  section: (page: Page) => page.getByTestId('row-comment-section'),
  items: (page: Page) => page.getByTestId('row-comment-item'),
  content: (page: Page) => page.getByTestId('row-comment-content'),
  itemWithText: (page: Page, text: string) =>
    page.getByTestId('row-comment-item').filter({ hasText: text }),
  collapsedInput: (page: Page) => page.getByTestId('row-comment-collapsed-input'),
  input: (page: Page) => page.getByTestId('row-comment-input'),
  sendButton: (page: Page) => page.getByTestId('row-comment-send-button'),
  emojiButton: (page: Page) => page.getByTestId('row-comment-emoji-button'),
  resolveButton: (page: Page) => page.getByTestId('row-comment-resolve-button'),
  moreButton: (page: Page) => page.getByTestId('row-comment-more-button'),
  editAction: (page: Page) => page.getByTestId('row-comment-edit-action'),
  deleteAction: (page: Page) => page.getByTestId('row-comment-delete-action'),
  editSaveButton: (page: Page) => page.getByTestId('row-comment-edit-save'),
  editCancelButton: (page: Page) => page.getByTestId('row-comment-edit-cancel'),
  deleteConfirmButton: (page: Page) => page.getByTestId('delete-comment-confirm'),
  deleteCancelButton: (page: Page) => page.getByTestId('delete-comment-cancel'),
  reaction: (page: Page, emoji: string) => page.getByTestId(`row-comment-reaction-${emoji}`),
};

/**
 * Common beforeEach setup for comment tests
 */
export function setupCommentTest(page: Page): void {
  page.on('pageerror', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found') ||
      err.message.includes('ResizeObserver loop')
    ) {
      return;
    }
  });
}

/**
 * Wait for the comment section to be visible inside the row detail modal
 */
export async function waitForCommentSection(page: Page): Promise<void> {
  await expect(CommentSelectors.section(page)).toBeVisible();
  await page.waitForTimeout(500);
}

/**
 * Expand the comment input (click the collapsed "Add a reply..." placeholder)
 */
export async function expandCommentInput(page: Page): Promise<void> {
  await CommentSelectors.collapsedInput(page).click();
  await page.waitForTimeout(300);
  await expect(CommentSelectors.input(page)).toBeVisible();
}

/**
 * Add a new comment by typing text and clicking send
 */
export async function addComment(page: Page, text: string): Promise<void> {
  // Expand input if collapsed
  const collapsedInput = CommentSelectors.collapsedInput(page);
  if (await collapsedInput.isVisible().catch(() => false)) {
    await expandCommentInput(page);
  }

  const input = CommentSelectors.input(page);
  await input.clear();
  await input.pressSequentially(text, { delay: 20 });
  await page.waitForTimeout(300);

  await CommentSelectors.sendButton(page).click({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Assert a comment with the given text exists
 */
export async function assertCommentExists(page: Page, text: string): Promise<void> {
  await expect(CommentSelectors.section(page)).toContainText(text);
}

/**
 * Assert a comment with the given text does NOT exist
 */
export async function assertCommentNotExists(page: Page, text: string): Promise<void> {
  await expect(CommentSelectors.section(page)).not.toContainText(text);
}

/**
 * Assert the exact number of comment items
 */
export async function assertCommentCount(page: Page, count: number): Promise<void> {
  await expect(CommentSelectors.items(page)).toHaveCount(count);
}

/**
 * Hover a comment to reveal its action buttons
 */
export async function hoverComment(page: Page, commentText: string): Promise<void> {
  const commentItem = CommentSelectors.itemWithText(page, commentText).first();
  await commentItem.scrollIntoViewIfNeeded();
  await commentItem.hover();
  await page.waitForTimeout(500);

  // Actions should appear on hover
  await expect(
    commentItem.locator('[data-testid="row-comment-actions"]')
  ).toBeVisible();
}

/**
 * Enter edit mode for a comment via the hover More menu
 */
export async function enterEditMode(page: Page, commentText: string): Promise<void> {
  await hoverComment(page, commentText);

  // Click the more button
  await CommentSelectors.itemWithText(page, commentText)
    .first()
    .locator('[data-testid="row-comment-more-button"]')
    .click({ force: true });
  await page.waitForTimeout(300);

  // Click Edit in dropdown
  await CommentSelectors.editAction(page).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Cancel an in-progress comment edit
 */
export async function cancelCommentEdit(page: Page): Promise<void> {
  await CommentSelectors.editCancelButton(page).click({ force: true });
  await page.waitForTimeout(300);
}

/**
 * Edit a comment: enter edit mode, clear text, type new text, save
 */
export async function editComment(
  page: Page,
  originalText: string,
  newText: string
): Promise<void> {
  await enterEditMode(page, originalText);

  // Find the edit textarea within the comment item being edited
  const commentItem = CommentSelectors.itemWithText(page, originalText).first();
  const textarea = commentItem.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 5000 });

  // Use triple-click + type to reliably replace content
  await textarea.click({ clickCount: 3 });
  await page.waitForTimeout(100);
  await page.keyboard.press('Meta+A');
  await page.waitForTimeout(100);
  await textarea.pressSequentially(newText, { delay: 20 });
  await page.waitForTimeout(300);

  await CommentSelectors.editSaveButton(page).click({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Delete a comment via hover More menu -> Delete -> confirm dialog
 */
export async function deleteComment(page: Page, commentText: string): Promise<void> {
  await hoverComment(page, commentText);

  await CommentSelectors.itemWithText(page, commentText)
    .first()
    .locator('[data-testid="row-comment-more-button"]')
    .click({ force: true });
  await page.waitForTimeout(300);

  await CommentSelectors.deleteAction(page).click({ force: true });
  await page.waitForTimeout(500);

  await CommentSelectors.deleteConfirmButton(page).click({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Toggle resolve/reopen on a comment via hover action
 */
export async function toggleResolveComment(page: Page, commentText: string): Promise<void> {
  await hoverComment(page, commentText);

  await CommentSelectors.itemWithText(page, commentText)
    .first()
    .locator('[data-testid="row-comment-resolve-button"]')
    .click();
  await page.waitForTimeout(2000);
}

/**
 * Add an emoji reaction to a comment by searching
 */
export async function addReactionToComment(
  page: Page,
  commentText: string,
  searchTerm: string
): Promise<void> {
  await hoverComment(page, commentText);

  await CommentSelectors.itemWithText(page, commentText)
    .first()
    .locator('[data-testid="row-comment-emoji-button"]')
    .click({ force: true });
  await page.waitForTimeout(500);

  // Search using the emoji search input
  const searchInput = page
    .locator('.emoji-picker .search-emoji-input input, .emoji-picker input')
    .first();
  await searchInput.clear();
  await searchInput.pressSequentially(searchTerm, { delay: 20 });
  await page.waitForTimeout(800);

  // Click the first emoji result
  await page.locator('.emoji-picker .List button').first().click({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Assert that at least one reaction badge exists on a comment
 */
export async function assertAnyReactionExists(page: Page, commentText: string): Promise<void> {
  await expect(
    CommentSelectors.itemWithText(page, commentText)
      .first()
      .locator('[data-testid^="row-comment-reaction-"]')
  ).toHaveCount(1, { timeout: 5000 });
}

/**
 * Assert edit mode UI elements are visible
 */
export async function assertEditInputShown(page: Page): Promise<void> {
  await expect(page.locator('textarea:visible').first()).toBeVisible();
}

/**
 * Assert edit mode buttons (cancel, save) are shown
 */
export async function assertEditModeButtonsShown(page: Page): Promise<void> {
  await expect(CommentSelectors.editSaveButton(page)).toBeVisible();
  await expect(CommentSelectors.editCancelButton(page)).toBeVisible();
}
