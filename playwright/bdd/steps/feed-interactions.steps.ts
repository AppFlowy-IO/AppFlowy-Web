import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { FieldType } from '../../../src/application/database-yjs/database.type';
import {
  activeDatabaseViewId,
  addFeedView,
  getFeedCardRowIds,
  switchToFeedOrGridView,
  waitForFeedCards,
} from '../../support/feed-test-helpers';
import { generateRandomEmail, getPrimaryFieldId, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { createFieldDirect, setCellDirect } from '../../support/gallery-test-helpers';
import { DatabaseFeedSelectors, RowDetailSelectors } from '../../support/selectors';

// Documented behavior and the limits of the Notion comparison are recorded in
// playwright/bdd/feed-interactions-evidence.md. These scenarios exercise AppFlowy's UI
// against real row collabs; direct writes below only establish fixture data.
async function openProperties(page: Page) {
  await page.getByTestId('database-actions-settings').click();
  const trigger = page.getByTestId('database-properties-settings-trigger');

  await trigger.click();
  const submenu = page.locator('[data-slot="dropdown-menu-sub-content"]');

  await expect(submenu).toBeVisible();
  const menuBox = await submenu.boundingBox();
  const triggerBox = await trigger.boundingBox();

  // Enter through the submenu's side before moving down to a property. A
  // diagonal teleport can cross the Layout item and dismiss the submenu.
  await page.mouse.move(menuBox!.x + menuBox!.width / 2, triggerBox!.y + triggerBox!.height / 2, { steps: 20 });
}

async function closeProperties(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(DatabaseFeedSelectors.settingsMenu(page)).toBeHidden();
}


const { Given, When, Then } = createBdd();
interface FeedInteractionState {
  gridId: string;
  feedId: string;
  statusId: string;
  scoreId: string;
  rowId: string;
  primaryId: string;
  mentionName: string;
  remotePage?: Page;
}
const scenarios = new WeakMap<Page, FeedInteractionState>();

function scenario(page: Page): FeedInteractionState {
  const state = scenarios.get(page);

  if (!state) throw new Error('Feed interaction fixture was not initialized');
  return state;
}

Given('the Feed interaction fixture is ready', async ({ page, request }) => {
  scenarios.set(page, { gridId: '', feedId: '', statusId: '', scoreId: '', rowId: '', primaryId: '', mentionName: '' });
  setupPageErrorHandling(page);
  await page.setViewportSize({ height: 1000, width: 1440 });
  await loginAndCreateGrid(page, request, generateRandomEmail());
});

Given('a Feed with two populated properties hidden by default', async ({ page }) => {
  const state = scenario(page);

  state.gridId = await activeDatabaseViewId(page);
  state.primaryId = await getPrimaryFieldId(page);
  state.statusId = await createFieldDirect(page, {
    name: 'Feed status', fieldType: FieldType.SingleSelect,
    selectOptions: [{ id: 'ready', name: 'Ready' }],
  });
  state.scoreId = await createFieldDirect(page, { name: 'Feed score', fieldType: FieldType.Number });
  state.feedId = await addFeedView(page);
  await waitForFeedCards(page, 3);
  [state.rowId] = await getFeedCardRowIds(page);
  await setCellDirect(page, state.rowId, state.statusId, FieldType.SingleSelect, 'ready');
  await setCellDirect(page, state.rowId, state.scoreId, FieldType.Number, '42');
  await expect(page.getByTestId(`feed-card-properties-${state.rowId}`)).toHaveCount(0);
});

When('the user shows both properties with the eye controls', async ({ page }) => {
  const state = scenario(page);

  await openProperties(page);
  await expect(page.getByTestId(`database-property-${state.primaryId}`)).toHaveCount(0);
  await page.getByTestId(`database-property-visibility-${state.statusId}`).click();
  await page.getByTestId(`database-property-visibility-${state.scoreId}`).click();
  await closeProperties(page);
});

Then('values appear horizontally below the title without visible field labels', async ({ page }) => {
  const state = scenario(page);
  const status = page.getByTestId(`feed-field-${state.statusId}-${state.rowId}`);
  const score = page.getByTestId(`feed-field-${state.scoreId}-${state.rowId}`);

  await expect(status).toContainText('Ready');
  await expect(score).toContainText('42');
  const titleBox = await DatabaseFeedSelectors.titleByRowId(page, state.rowId).boundingBox();
  const statusBox = await status.boundingBox();
  const scoreBox = await score.boundingBox();

  expect(statusBox!.y).toBeGreaterThan(titleBox!.y);
  expect(Math.abs(statusBox!.y - scoreBox!.y)).toBeLessThan(5);
  expect(statusBox!.x).toBeLessThan(scoreBox!.x);
  await expect(status.locator('dt')).toHaveClass('sr-only');
  await status.click();
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
});

When('the user searches for a Feed property value', async ({ page }) => {
  await page.getByTestId('database-actions-search').click();
  await page.getByTestId('database-actions-search-input').fill('42');
});

Then('only the matching Feed card is visible', async ({ page }) => {
  const state = scenario(page);

  await expect(DatabaseFeedSelectors.cardByRowId(page, state.rowId)).toBeVisible();
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(1);
});

When('that property changes while the search is active', async ({ page }) => {
  const state = scenario(page);

  await setCellDirect(page, state.rowId, state.scoreId, FieldType.Number, '7');
  await expect(DatabaseFeedSelectors.cardByRowId(page, state.rowId)).toBeHidden();
  await setCellDirect(page, state.rowId, state.scoreId, FieldType.Number, '42');
  await expect(DatabaseFeedSelectors.cardByRowId(page, state.rowId)).toBeVisible();
});

Then('Feed search updates and respects hiding that property', async ({ page }) => {
  const state = scenario(page);

  await openProperties(page);
  await page.getByTestId(`database-property-visibility-${state.scoreId}`).click();
  await closeProperties(page);
  await expect(DatabaseFeedSelectors.cardByRowId(page, state.rowId)).toBeHidden();
  await openProperties(page);
  await page.getByTestId(`database-property-visibility-${state.scoreId}`).click();
  await closeProperties(page);
  await expect(DatabaseFeedSelectors.cardByRowId(page, state.rowId)).toBeVisible();
  await page.getByTestId('database-actions-search-clear').click();
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(3);
});

When('the user drags score before status and hides status', async ({ page }) => {
  const state = scenario(page);

  await openProperties(page);
  const source = page.getByTestId(`database-property-${state.scoreId}`).locator('.cursor-grab');
  const target = page.getByTestId(`database-property-${state.statusId}`);

  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();

  await page.mouse.move(from!.x + 8, from!.y + from!.height / 2, { steps: 20 });
  await page.mouse.down();
  await page.mouse.move(from!.x + 16, from!.y + from!.height / 2 - 4, { steps: 5 });
  await page.mouse.move(to!.x + 40, to!.y + 3, { steps: 20 });
  await page.mouse.up();
  await closeProperties(page);
  await expect.poll(() => page.getByTestId(`feed-card-properties-${state.rowId}`).locator('[data-testid^="feed-field-"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid'))))
    .toEqual([`feed-field-${state.scoreId}-${state.rowId}`, `feed-field-${state.statusId}-${state.rowId}`]);
  await openProperties(page);
  await page.getByTestId(`database-property-visibility-${state.statusId}`).click();
  await closeProperties(page);
  await expect(page.getByTestId(`feed-field-${state.statusId}-${state.rowId}`)).toHaveCount(0);
});

Then('the saved settings survive view switching and reload', async ({ page }) => {
  const state = scenario(page);

  await switchToFeedOrGridView(page, state.gridId, 'Grid');
  await switchToFeedOrGridView(page, state.feedId, 'Feed');
  await expect(page.getByTestId(`feed-field-${state.scoreId}-${state.rowId}`)).toContainText('42');
  await page.reload();
  await expect(page.getByTestId(`feed-field-${state.scoreId}-${state.rowId}`)).toContainText('42', { timeout: 30_000 });
  await expect(page.getByTestId(`feed-field-${state.statusId}-${state.rowId}`)).toHaveCount(0);
  await openProperties(page);
  await page.getByTestId(`database-property-visibility-${state.statusId}`).click();
  await closeProperties(page);
  await expect.poll(() => page.getByTestId(`feed-card-properties-${state.rowId}`).locator('[data-testid^="feed-field-"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid'))))
    .toEqual([`feed-field-${state.scoreId}-${state.rowId}`, `feed-field-${state.statusId}-${state.rowId}`]);
});

Given('a Feed card with an existing discussion', async ({ page }) => {
  const state = scenario(page);

  await addFeedView(page);
  [state.rowId] = await getFeedCardRowIds(page);
  await DatabaseFeedSelectors.addCommentByRowId(page, state.rowId).click();
  await DatabaseFeedSelectors.addCommentInputByRowId(page, state.rowId).fill('Feedback requested');
  await page.keyboard.press('Enter');
  await expect(DatabaseFeedSelectors.addCommentByRowId(page, state.rowId)).toBeHidden();
  const card = DatabaseFeedSelectors.cardByRowId(page, state.rowId);
  const before = await card.boundingBox();

  await DatabaseFeedSelectors.commentSummaryByRowId(page, state.rowId).click();
  await expect(page.getByTestId(`feed-discussion-${state.rowId}`).getByTestId('row-comment-content'))
    .toHaveText('Feedback requested');
  const after = await card.boundingBox();

  expect(after!.height).toBeCloseTo(before!.height, 0);
});

When('the user replies with a mention and file, then dismisses and reopens the discussion', async ({ page }) => {
  const state = scenario(page);

  const card = page.getByTestId(`feed-discussion-${state.rowId}`);

  await card.getByRole('button', { name: 'Reply', exact: true }).click();
  const input = card.getByTestId('row-comment-input');

  await expect(input).toBeFocused();
  await input.fill('@');
  const person = page.getByRole('listbox').getByRole('option').first();

  await expect(person).toBeVisible();
  state.mentionName = (await person.textContent())!;
  await person.click();
  await page.keyboard.type('please review');
  await card.getByTestId('row-comment-attachment-input').setInputFiles({
    name: 'feedback.txt', mimeType: 'text/plain', buffer: Buffer.from('Feed reply attachment'),
  });
  await expect(card.getByTestId('comment-pending-attachment')).toHaveText('feedback.txt');
  await page.mouse.click(1400, 950);
  await expect(card).toBeHidden();
  await expect(input).toBeHidden();
  await DatabaseFeedSelectors.commentSummaryByRowId(page, state.rowId).click();
  await expect(input).toHaveValue(`@${state.mentionName} please review`);
  await expect(card.getByTestId('comment-pending-attachment')).toHaveText('feedback.txt');
  await input.focus();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await DatabaseFeedSelectors.commentSummaryByRowId(page, state.rowId).click();
  await expect(input).toHaveValue(`@${state.mentionName} please review`);
  await card.getByTestId('row-comment-send-button').click();
});

Then('the reply is saved and the popover accepts another comment', async ({ page }) => {
  const state = scenario(page);

  const card = page.getByTestId(`feed-discussion-${state.rowId}`);

  await expect(card.locator('[data-mention-id]')).toHaveText(`@${state.mentionName}`);
  await expect(card.getByTestId('row-comment-attachment')).toHaveText('feedback.txt');
  await expect(DatabaseFeedSelectors.commentSummaryByRowId(page, state.rowId)).toContainText('2 replies');
  await expect(DatabaseFeedSelectors.addCommentByRowId(page, state.rowId)).toBeHidden();
  const rootComposer = card.getByTestId('row-comment-root-composer');

  await rootComposer.getByTestId('row-comment-collapsed-input').click();
  await rootComposer.getByTestId('row-comment-input').fill('Another thought');
  await page.keyboard.press('Enter');
  await expect(card.getByTestId('row-comment-content')).toHaveText([
    'Feedback requested', `@${state.mentionName} please review`, 'Another thought',
  ]);
  await expect(DatabaseFeedSelectors.commentSummaryByRowId(page, state.rowId)).toContainText('3 replies');
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
  await page.reload();
  await DatabaseFeedSelectors.commentSummaryByRowId(page, state.rowId).click();
  await expect(card.locator('[data-mention-id]')).toHaveText(`@${state.mentionName}`);
  await expect(card.getByTestId('row-comment-attachment')).toHaveText('feedback.txt');
});

Given('the same empty Feed card is open in two tabs', async ({ page }) => {
  const state = scenario(page);

  state.primaryId = await getPrimaryFieldId(page);
  state.feedId = await addFeedView(page);
  [state.rowId] = await getFeedCardRowIds(page);
  await setCellDirect(page, state.rowId, state.primaryId, FieldType.RichText, 'Cross-tab discussion');
  state.remotePage = await page.context().newPage();
  setupPageErrorHandling(state.remotePage);
  await state.remotePage.goto(page.url());
  await expect.poll(() => activeDatabaseViewId(state.remotePage!)).toBe(state.feedId);
  await expect(DatabaseFeedSelectors.titleByRowId(state.remotePage, state.rowId)).toHaveText('Cross-tab discussion');
  await expect(DatabaseFeedSelectors.addCommentByRowId(state.remotePage, state.rowId)).toBeVisible();
});

When('a first comment arrives while the original tab holds an unsent draft', async ({ page }) => {
  const state = scenario(page);
  const remote = state.remotePage!;

  await page.bringToFront();
  await DatabaseFeedSelectors.addCommentByRowId(page, state.rowId).click();
  await DatabaseFeedSelectors.addCommentInputByRowId(page, state.rowId).fill('Keep my unsent feedback');
  await remote.bringToFront();
  await DatabaseFeedSelectors.addCommentByRowId(remote, state.rowId).click();
  await DatabaseFeedSelectors.addCommentInputByRowId(remote, state.rowId).fill('First comment from another tab');
  await DatabaseFeedSelectors.addCommentInputByRowId(remote, state.rowId).press('Enter');
  await expect(DatabaseFeedSelectors.commentSummaryByRowId(remote, state.rowId)).toContainText('1 reply');
  await expect(DatabaseFeedSelectors.commentSummaryByRowId(page, state.rowId)).toContainText('1 reply');
});

Then('the draft survives and both tabs receive further discussion updates', async ({ page }) => {
  const state = scenario(page);
  const remote = state.remotePage!;
  const localDraft = DatabaseFeedSelectors.addCommentInputByRowId(page, state.rowId);

  await page.bringToFront();
  await expect(localDraft).toBeVisible();
  await expect(localDraft).toHaveValue('Keep my unsent feedback');
  await localDraft.press('Enter');
  await expect(DatabaseFeedSelectors.addCommentByRowId(page, state.rowId)).toBeHidden();
  await expect(DatabaseFeedSelectors.commentSummaryByRowId(remote, state.rowId)).toContainText('2 replies');
  await DatabaseFeedSelectors.commentSummaryByRowId(page, state.rowId).click();
  await remote.bringToFront();
  await DatabaseFeedSelectors.commentSummaryByRowId(remote, state.rowId).click();
  const remoteDiscussion = remote.getByTestId(`feed-discussion-${state.rowId}`);
  const localDiscussion = page.getByTestId(`feed-discussion-${state.rowId}`);

  await expect(localDiscussion.getByTestId('row-comment-content')).toHaveText([
    'First comment from another tab', 'Keep my unsent feedback',
  ]);
  await remoteDiscussion.getByTestId('row-comment-root-composer').getByTestId('row-comment-collapsed-input').click();
  await remoteDiscussion.getByTestId('row-comment-input').fill('Live follow-up');
  await remoteDiscussion.getByTestId('row-comment-input').press('Enter');
  await expect(localDiscussion.getByTestId('row-comment-content')).toHaveText([
    'First comment from another tab', 'Keep my unsent feedback', 'Live follow-up',
  ]);
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
  await remote.close();
});

function discussionParent(page: Page, rowId: string, content: string) {
  return page.getByTestId(`feed-discussion-${rowId}`).getByTestId('row-comment-item').filter({
    has: page.getByText(content, { exact: true }),
  });
}

const firstReplyDraft = [
  'Reply for first parent',
  ...Array.from({ length: 9 }, (_, index) => `More feedback on line ${index + 2}`),
].join('\n');

When('the user drafts multiline replies, switches threads, and resizes the window', async ({ page }) => {
  const state = scenario(page);
  const discussion = page.getByTestId(`feed-discussion-${state.rowId}`);
  const root = discussion.getByTestId('row-comment-root-composer');

  await root.getByTestId('row-comment-collapsed-input').click();
  await root.getByTestId('row-comment-input').fill('Second parent');
  await page.keyboard.press('Enter');
  const first = discussionParent(page, state.rowId, 'Feedback requested');
  const second = discussionParent(page, state.rowId, 'Second parent');

  await first.locator('button[data-testid^="row-comment-reply-"]').click();
  const firstInput = first.getByTestId('row-comment-input');
  const expectScrollableDraft = async () => {
    await expect.poll(() => firstInput.evaluate((element) => {
      const style = window.getComputedStyle(element);

      return element.clientHeight >= Number.parseFloat(style.lineHeight) * 5 &&
        element.scrollHeight > element.clientHeight && style.overflowY === 'auto';
    })).toBe(true);
  };

  await firstInput.fill(firstReplyDraft);
  await expectScrollableDraft();
  await second.locator('button[data-testid^="row-comment-reply-"]').click();
  await second.getByTestId('row-comment-input').fill('Reply for second parent');
  await expect(firstInput).toBeHidden();
  await page.setViewportSize({ width: 1200, height: 900 });
  await first.locator('button[data-testid^="row-comment-reply-"]').click();
  await expect(firstInput).toBeFocused();
  await expect(firstInput).toHaveValue(firstReplyDraft);
  await expectScrollableDraft();
  await expect(second.getByTestId('row-comment-input')).toBeHidden();
  await first.getByTestId('row-comment-send-button').click();
  await second.locator('button[data-testid^="row-comment-reply-"]').click();
  await expect(second.getByTestId('row-comment-input')).toHaveValue('Reply for second parent');
  await second.getByTestId('row-comment-send-button').click();
});

Then('each reply is sent to its original parent and both parents can be resolved independently', async ({ page }) => {
  const state = scenario(page);
  const discussion = page.getByTestId(`feed-discussion-${state.rowId}`);
  const first = discussionParent(page, state.rowId, 'Feedback requested');
  const second = discussionParent(page, state.rowId, 'Second parent');

  // Replies render directly after their parent, so this order also catches a
  // draft accidentally submitted under the last-selected thread.
  await expect(discussion.getByTestId('row-comment-content')).toHaveText([
    'Feedback requested', firstReplyDraft, 'Second parent', 'Reply for second parent',
  ]);
  await first.hover();
  await first.getByTestId('row-comment-more-button').click();
  await expect(page.getByTestId('row-comment-edit-action')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('row-comment-edit-action')).toBeHidden();
  await expect(discussion).toBeVisible();
  await first.getByTestId('row-comment-emoji-button').click();
  await expect(page.locator('.emoji-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.emoji-picker')).toBeHidden();
  await expect(discussion).toBeVisible();
  await first.hover();
  await first.getByRole('button', { name: 'Resolve', exact: true }).click();
  await second.hover();
  await second.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(first.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(second.getByText('Resolved', { exact: true })).toBeVisible();
  await second.hover();
  await second.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(first.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(second.getByText('Resolved', { exact: true })).toHaveCount(0);
  await expect(second.locator('button[data-testid^="row-comment-reply-"]')).toBeVisible();
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
});
