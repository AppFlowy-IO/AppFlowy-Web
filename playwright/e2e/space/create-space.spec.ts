import { test, expect } from '@playwright/test';
import {
  PageSelectors,
  SpaceSelectors,
  SidebarSelectors,
  ModalSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * Space Creation Tests
 * Migrated from: cypress/e2e/space/create-space.cy.ts
 */
test.describe('Space Creation Tests', () => {
  let testEmail: string;
  let spaceName: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
    spaceName = `Test Space ${Date.now()}`;
  });

  test.describe('Create New Space', () => {
    test('should create a new space successfully', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (
          err.message.includes('No workspace or service found') ||
          err.message.includes('View not found')
        ) {
          return;
        }
      });

      // Step 1: Login
      await signInAndWaitForApp(page, request, testEmail);

      // Wait for the loading screen to disappear and main app to appear
      await expect(page.locator('body')).not.toContainText('Welcome!', { timeout: 30000 });

      // Wait for the sidebar to be visible (indicates app is loaded)
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

      // Wait for at least one page to exist in the sidebar
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2000);

      // Step 2: Open the global new page flow
      await expect(PageSelectors.newPageButton(page)).toBeVisible({ timeout: 20000 });
      await PageSelectors.newPageButton(page).click();
      await expect(ModalSelectors.newPageModal(page)).toBeVisible({ timeout: 5000 });

      // Step 3: Create a space from the new page modal
      await expect(ModalSelectors.createNewSpaceButton(page)).toBeVisible({ timeout: 5000 });
      await ModalSelectors.createNewSpaceButton(page).click();

      // Step 4: Fill in the space details
      const createSpaceModal = SpaceSelectors.createSpaceModal(page);

      await expect(createSpaceModal).toBeVisible({ timeout: 5000 });
      const nameInputContainer = createSpaceModal.getByTestId('space-name-input');
      await expect(nameInputContainer).toBeVisible();
      const nameInput = nameInputContainer.locator('input');
      await nameInput.clear();
      await nameInput.fill(spaceName);

      // Step 5: Save the new space
      const saveButton = createSpaceModal.getByTestId('modal-ok-button');

      await expect(saveButton).toBeVisible();
      await saveButton.click();
      await page.waitForTimeout(3000);

      // Step 6: Verify the new space appears in the sidebar
      // Check that the new space exists — retry with wait if not immediately visible
      const spaceNames = SpaceSelectors.names(page);
      const spaceFilter = spaceNames.filter({ hasText: spaceName });

      const spaceCount = await spaceFilter.count();
      if (spaceCount === 0) {
        // Sometimes the space might be created but not immediately visible
        await page.waitForTimeout(2000);
      }

      // Verify space exists (either exact name or contains 'Test Space')
      const allSpaceTexts = await spaceNames.allTextContents();
      const trimmedNames = allSpaceTexts.map((t) => t.trim());
      const spaceExists = trimmedNames.some(
        (name) => name === spaceName || name.includes('Test Space')
      );
      expect(spaceExists).toBe(true);

      // Step 7: Verify the new space is clickable
      await spaceNames.filter({ hasText: spaceName }).first().click({ force: true });
      await page.waitForTimeout(1000);
    });
  });
});
