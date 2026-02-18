import { TestTool } from '../../support/page-utils';
import {
  WorkspaceSelectors,
  AuthSelectors,
  waitForReactUpdate
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import {
  assertLoginPageReady,
  signInAndWaitForApp,
  visitLoginPage,
} from '../../support/auth-flow-helpers';

describe('Login and Logout Flow', () => {
  beforeEach(() => {
    // Handle uncaught exceptions
    cy.on('uncaught:exception', (err) => {
      if (err.message.includes('Minified React error') ||
          err.message.includes('View not found') ||
          err.message.includes('No workspace or service found')) {
        return false;
      }
      return true;
    });
    cy.viewport(1280, 720);
  });

  describe('Test Case 1: Complete Login and Logout Flow', () => {
    it('should login and successfully logout with detailed verification', () => {
      const testEmail = generateRandomEmail();

      cy.log(`[TEST START] Complete Login and Logout Flow - Email: ${testEmail}`);

      // Step 1: Navigate to login page
      cy.log('[STEP 1] Visiting login page');
      visitLoginPage();

      // Step 2: Verify login page elements before authentication
      cy.log('[STEP 2] Verifying login page loaded with all elements');
      assertLoginPageReady();

      // Step 3: Use shared sign-in helper (more reliable than manual password entry)
      cy.log('[STEP 3] Starting authentication process');
      signInAndWaitForApp(testEmail).then(() => {
        cy.log('[STEP 4] Authentication successful');

        // Step 5: Verify workspace is loaded by checking dropdown trigger
        cy.log('[STEP 5] Verifying workspace loaded');
        WorkspaceSelectors.dropdownTrigger()
          .should('be.visible');

        // Step 6: Open workspace dropdown
        cy.log('[STEP 6] Opening workspace dropdown');
        TestTool.openWorkspaceDropdown();

        // Step 7: Verify dropdown content and user email
        cy.log('[STEP 7] Verifying dropdown content and user email');
        WorkspaceSelectors.dropdownContent()
          .should('be.visible');
        cy.contains(testEmail).should('be.visible');

        // Step 8: Click logout menu item
        cy.log('[STEP 8] Clicking logout menu item');
        AuthSelectors.logoutMenuItem()
          .should('be.visible')
          .click();

        waitForReactUpdate(1000);

        // Step 9: Verify logout confirmation dialog appears
        cy.log('[STEP 9] Verifying logout confirmation dialog');
        AuthSelectors.logoutConfirmButton()
          .should('be.visible');

        // Step 10: Confirm logout
        cy.log('[STEP 10] Confirming logout');
        AuthSelectors.logoutConfirmButton().click();

        waitForReactUpdate(2000);

        // Step 11: Verify redirect to login page
        cy.log('[STEP 11] Verifying redirect to login page');
        cy.url({ timeout: 10000 }).should('include', '/login');

        // Step 12: Verify login page elements are visible after logout
        cy.log('[STEP 12] Verifying login page elements after logout');
        assertLoginPageReady();

        cy.log('[STEP 13] Test completed successfully - Full login and logout flow verified');
      });
    });
  });

  describe('Test Case 2: Quick Login and Logout using Test URL', () => {
    it('should login with test URL and successfully logout', () => {
      const testEmail = generateRandomEmail();

      cy.log(`[TEST START] Quick Login and Logout using Test URL - Email: ${testEmail}`);

      // Step 1: Visit login page
      cy.log('[STEP 1] Signing in');

      // Step 2: Use shared sign-in helper for quick authentication
      cy.log('[STEP 2] Starting quick authentication with test URL');
      signInAndWaitForApp(testEmail).then(() => {
        cy.log('[STEP 3] Authentication successful');

        // Step 4: Verify user is logged in
        cy.log('[STEP 4] Verifying user is logged in');
        WorkspaceSelectors.dropdownTrigger()
          .should('be.visible');

        // Step 5: Open workspace dropdown
        cy.log('[STEP 5] Opening workspace dropdown');
        TestTool.openWorkspaceDropdown();

        // Verify dropdown is open and user email is visible
        WorkspaceSelectors.dropdownContent()
          .should('be.visible');
        cy.contains(testEmail).should('be.visible');

        // Step 6: Click logout menu item
        cy.log('[STEP 6] Clicking logout menu item');
        AuthSelectors.logoutMenuItem()
          .should('be.visible')
          .click();

        waitForReactUpdate(1000);

        // Step 7: Confirm logout
        cy.log('[STEP 7] Confirming logout');
        AuthSelectors.logoutConfirmButton()
          .should('be.visible')
          .click();

        waitForReactUpdate(2000);

        // Step 8: Verify redirect to login page
        cy.log('[STEP 8] Verifying redirect to login page');
        cy.url({ timeout: 10000 }).should('include', '/login');

        // Verify login page elements are visible
        assertLoginPageReady();

        cy.log('[STEP 9] Test completed successfully - Quick login and logout verified');
      });
    });
  });

  describe('Test Case 3: Cancel Logout Confirmation', () => {
    it('should cancel logout when clicking cancel button', () => {
      const testEmail = generateRandomEmail();

      cy.log(`[TEST START] Cancel Logout Confirmation - Email: ${testEmail}`);

      // Step 1: Visit login page
      cy.log('[STEP 1] Signing in');

      // Step 2: Use shared sign-in helper for quick authentication
      cy.log('[STEP 2] Starting authentication');
      signInAndWaitForApp(testEmail).then(() => {
        cy.log('[STEP 3] Authentication successful');

        // Step 4: Open workspace dropdown
        cy.log('[STEP 4] Opening workspace dropdown');
        WorkspaceSelectors.dropdownTrigger()
          .should('be.visible');
        TestTool.openWorkspaceDropdown();

        // Verify dropdown is open
        WorkspaceSelectors.dropdownContent()
          .should('be.visible');

        // Step 5: Click logout menu item
        cy.log('[STEP 5] Clicking logout menu item');
        AuthSelectors.logoutMenuItem()
          .should('be.visible')
          .click();

        waitForReactUpdate(1000);

        // Step 6: Click Cancel button in logout confirmation dialog
        cy.log('[STEP 6] Clicking Cancel button in logout confirmation');

        // Find and click the Cancel button using text content
        cy.contains('button', 'Cancel')
          .should('be.visible')
          .click();

        waitForReactUpdate(1000);

        // Step 7: Verify user remains logged in
        cy.log('[STEP 7] Verifying user remains logged in');

        // Should still be on /app page
        cy.url().should('include', '/app');

        // Workspace dropdown should still be accessible
        WorkspaceSelectors.dropdownTrigger()
          .should('be.visible');

        // Open dropdown again to verify user is still logged in
        TestTool.openWorkspaceDropdown();
        WorkspaceSelectors.dropdownContent()
          .should('be.visible');
        cy.contains(testEmail).should('be.visible');

        // Close dropdown
        cy.get('body').click(0, 0); // Click outside to close dropdown
        waitForReactUpdate(500);

        cy.log('[STEP 8] Test completed successfully - Logout cancellation verified');
      });
    });
  });
});
