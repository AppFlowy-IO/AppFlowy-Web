import { test, expect } from '@playwright/test';
import { PageSelectors, SpaceSelectors, SidebarSelectors, ModalSelectors } from '../../support/selectors';
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
        if (err.message.includes('No workspace or service found') || err.message.includes('View not found')) {
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

      // Step 4: Creation uses the same full settings panel as Manage Space,
      // but remains a local draft until the explicit Create action.
      const createSpaceModal = SpaceSelectors.createSpaceModal(page);

      await expect(createSpaceModal).toBeVisible({ timeout: 20000 });
      await expect(SpaceSelectors.manageSpaceModal(page)).toHaveCount(0);
      await expect(createSpaceModal.getByTestId('space-settings-panel')).toBeVisible();
      await expect(createSpaceModal.getByText('Create space', { exact: true })).toBeVisible();
      await expect(createSpaceModal.getByTestId('manage-space-public-access-card')).toBeVisible();

      const nameInput = SpaceSelectors.spaceNameInput(page);

      await expect(nameInput).toBeEnabled();
      await expect(nameInput).toHaveValue('General');

      // Step 5: Editing the draft does not add it to the sidebar. Only Create
      // persists the space and its initial document.
      await nameInput.fill(spaceName);
      const renamedSpace = SpaceSelectors.itemByName(page, spaceName);

      await expect(renamedSpace).toHaveCount(0);
      await createSpaceModal.getByTestId('create-space-submit').click();

      // Step 6: Confirmation closes Create Space and opens the initial page.
      await expect(createSpaceModal).toBeHidden({ timeout: 20000 });
      await expect(renamedSpace).toBeVisible({ timeout: 20000 });
      const viewModal = page.getByRole('dialog').filter({ has: page.getByTestId('view-modal-close') });

      await expect(viewModal.getByTestId('view-modal-close')).toBeVisible({ timeout: 20000 });
      await expect(viewModal.getByTestId('page-title-input')).toBeVisible({ timeout: 20000 });

      // Step 7: The created space remains present and interactive.
      await viewModal.getByTestId('view-modal-close').click();
      const expandedMarker = renamedSpace.getByTestId('space-expanded');
      const wasExpanded = (await expandedMarker.getAttribute('data-expanded')) === 'true';

      await renamedSpace.getByTestId('space-name').click();
      await expect(expandedMarker).toHaveAttribute('data-expanded', String(!wasExpanded));
    });
  });
});
