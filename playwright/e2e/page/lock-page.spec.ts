import { test, expect, Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { DropdownSelectors, EditorSelectors, HeaderSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Lock Page Tests
 *
 * Covers the "Lock page" toggle migrated from desktop: toggling persists the
 * folder `is_locked` attribute (via the updatePage endpoint), which makes the
 * document read-only, shows the orange "Locked" badge, and toasts.
 */

const PAGE_LOCKED_TOAST = 'Page locked. Editing is disabled until someone unlocks it.';
const PAGE_UNLOCKED_TOAST = 'Page unlocked. Editing is enabled.';

const lockItem = (page: Page) => page.getByTestId('more-page-lock');
const lockSwitch = (page: Page) => lockItem(page).locator('[data-slot="switch"]');
const lockedBadge = (page: Page) => page.getByTestId('page-locked-badge');
const bodyEditor = (page: Page) => page.getByTestId('editor-content');

async function setup(page: Page, request: import('@playwright/test').APIRequestContext, email: string) {
  page.on('pageerror', (err) => {
    if (err.message.includes('No workspace or service found')) return;
  });
  await signInAndWaitForApp(page, request, email);
  await expect(page).toHaveURL(/\/app/);
  await page.waitForTimeout(3000);
  await expect(EditorSelectors.slateEditor(page)).toBeVisible({ timeout: 20000 });
}

async function openMoreMenu(page: Page) {
  await HeaderSelectors.moreActionsButton(page).click();
  await expect(DropdownSelectors.content(page)).toBeVisible();
}

/** Click the Lock page toggle (menu stays open) and wait for the expected toast. */
async function toggleLock(page: Page, expectLocked: boolean) {
  await openMoreMenu(page);
  await expect(lockItem(page)).toBeVisible();
  await lockItem(page).click();
  await expect(page.getByText(expectLocked ? PAGE_LOCKED_TOAST : PAGE_UNLOCKED_TOAST)).toBeVisible({ timeout: 5000 });
  // Close the menu so the editor/badge are observable.
  await page.keyboard.press('Escape');
  await expect(DropdownSelectors.content(page)).toBeHidden();
}

test.describe('Lock Page', () => {
  let testEmail: string;

  test.beforeEach(() => {
    testEmail = generateRandomEmail();
  });

  test('Lock page toggle is present and off by default for a document', async ({ page, request }) => {
    await setup(page, request, testEmail);
    await openMoreMenu(page);

    await expect(lockItem(page)).toBeVisible();
    await expect(lockSwitch(page)).toHaveAttribute('data-state', 'unchecked');
    await expect(bodyEditor(page)).toHaveAttribute('contenteditable', 'true');
  });

  test('locking shows the toast, the "Locked" badge, and makes the editor read-only', async ({ page, request }) => {
    await setup(page, request, testEmail);

    await toggleLock(page, true);

    await expect(lockedBadge(page)).toBeVisible({ timeout: 10000 });
    await expect(lockedBadge(page)).toContainText('Locked');
    await expect(bodyEditor(page)).toHaveAttribute('contenteditable', 'false', { timeout: 10000 });
  });

  test('unlocking removes the badge and re-enables editing', async ({ page, request }) => {
    await setup(page, request, testEmail);

    await toggleLock(page, true);
    await expect(lockedBadge(page)).toBeVisible({ timeout: 10000 });

    await toggleLock(page, false);
    await expect(lockedBadge(page)).toBeHidden({ timeout: 10000 });
    await expect(bodyEditor(page)).toHaveAttribute('contenteditable', 'true', { timeout: 10000 });
  });

  test('the toggle reflects the current lock state when the menu is reopened', async ({ page, request }) => {
    await setup(page, request, testEmail);

    await toggleLock(page, true);
    await expect(lockedBadge(page)).toBeVisible({ timeout: 10000 });

    await openMoreMenu(page);
    await expect(lockSwitch(page)).toHaveAttribute('data-state', 'checked');
    await page.keyboard.press('Escape');
  });

  test('lock state persists across a reload', async ({ page, request }) => {
    await setup(page, request, testEmail);

    await toggleLock(page, true);
    await expect(lockedBadge(page)).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForTimeout(3000);

    await expect(lockedBadge(page)).toBeVisible({ timeout: 15000 });
    await expect(bodyEditor(page)).toHaveAttribute('contenteditable', 'false', { timeout: 10000 });
  });

  test('the locked badge exposes an explanatory tooltip', async ({ page, request }) => {
    await setup(page, request, testEmail);
    await toggleLock(page, true);
    await expect(lockedBadge(page)).toBeVisible({ timeout: 10000 });

    await lockedBadge(page).hover();
    await expect(page.getByText('Page locked to prevent accidental editing. Click to unlock.')).toBeVisible({
      timeout: 5000,
    });
  });

  test('on a locked page, Find & Replace can find but cannot replace', async ({ page, request }) => {
    await setup(page, request, testEmail);

    // Add searchable content before locking.
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.press('Enter');
    await page.keyboard.type('lockedsearch lockedsearch');
    await page.waitForTimeout(800);

    await toggleLock(page, true);
    await expect(bodyEditor(page)).toHaveAttribute('contenteditable', 'false', { timeout: 10000 });

    // Open Find & Replace from the header menu.
    await HeaderSelectors.moreActionsButton(page).click();
    await expect(DropdownSelectors.content(page)).toBeVisible();
    await page.getByTestId('more-page-find-and-replace').click();
    await expect(page.getByTestId('find-and-replace-panel')).toBeVisible();

    await page.getByTestId('find-and-replace-find-input').fill('lockedsearch');
    await page.waitForTimeout(500);

    // Find still works...
    await expect(page.getByTestId('find-and-replace-panel')).toContainText('1/2');
    // ...but replace is disabled on a read-only page.
    await expect(page.getByTestId('find-and-replace-replace')).toBeDisabled();
    await expect(page.getByTestId('find-and-replace-replace-all')).toBeDisabled();
  });
});
