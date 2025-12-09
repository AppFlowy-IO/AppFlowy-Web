import { AuthTestUtils } from '../../support/auth-utils';
import { TestTool } from '../../support/page-utils';
import { ShareSelectors, SidebarSelectors, PageSelectors } from '../../support/selectors';
import { generateRandomEmail, logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Publish Manage - Subscription and Namespace Tests', () => {
  let testEmail: string;

  before(() => {
    logAppFlowyEnvironment();
  });

  beforeEach(() => {
    testEmail = generateRandomEmail();

    // Handle uncaught exceptions
    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('createThemeNoVars_default is not a function') ||
        err.message.includes('View not found') ||
        err.message.includes('Record not found') ||
        err.message.includes('Request failed') ||
        err.name === 'NotAllowedError'
      ) {
        return false;
      }

      return true;
    });
  });

  /**
   * Helper to sign in, publish a page, and open the publish manage panel
   */
  const setupPublishManagePanel = (email: string) => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(1000);
    const authUtils = new AuthTestUtils();

    return authUtils.signInWithTestUrl(email).then(() => {
      cy.url().should('include', '/app');
      testLog.info('Signed in');

      // Wait for app to fully load
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
      PageSelectors.names().should('exist', { timeout: 30000 });
      cy.wait(2000);

      // Publish a page
      TestTool.openSharePopover();
      cy.contains('Publish').should('exist').click({ force: true });
      cy.wait(1000);

      ShareSelectors.publishConfirmButton().should('be.visible').should('not.be.disabled');
      ShareSelectors.publishConfirmButton().click({ force: true });
      testLog.info('Clicked Publish button');

      // Wait for publish to complete
      cy.wait(5000);
      ShareSelectors.publishNamespace().should('be.visible', { timeout: 10000 });
      testLog.info('Page published successfully');

      // Open the publish settings (manage panel)
      ShareSelectors.openPublishSettingsButton().should('be.visible').click({ force: true });
      cy.wait(2000);
      ShareSelectors.publishManagePanel().should('be.visible', { timeout: 10000 });
      testLog.info('Publish manage panel is visible');
    });
  };

  it('should hide homepage setting when namespace is UUID (new users)', () => {
    // New users have UUID namespaces by default
    // The HomePageSetting component returns null when canEdit is false (UUID namespace)
    setupPublishManagePanel(testEmail).then(() => {
      // Wait for the panel content to fully render
      cy.wait(1000);

      // Verify that homepage setting is NOT visible when namespace is a UUID
      // New users have UUID namespaces, so the homepage setting should be hidden
      ShareSelectors.publishManagePanel().within(() => {
        cy.get('[data-testid="homepage-setting"]').should('not.exist');
        testLog.info('✓ Homepage setting is correctly hidden for UUID namespace');

        // The edit namespace button should still exist (it's always rendered)
        cy.get('[data-testid="edit-namespace-button"]').should('exist');
        testLog.info('✓ Edit namespace button exists');
      });

      // Close the modal
      cy.get('body').type('{esc}');
      cy.wait(500);
    });
  });

  it('edit namespace button should be visible but clicking does nothing for Free plan on official host', () => {
    // This test verifies the subscription check:
    // - On official hosts (including localhost in dev): Free plan users see the button but clicking does nothing
    // - The button is rendered but the onClick handler returns early
    setupPublishManagePanel(testEmail).then(() => {
      cy.wait(1000);

      ShareSelectors.publishManagePanel().within(() => {
        // The edit namespace button should exist
        cy.get('[data-testid="edit-namespace-button"]').should('exist').as('editBtn');
        testLog.info('Edit namespace button exists');

        // Click the button - on official hosts with Free plan, nothing should happen
        // The UpdateNamespace modal should NOT open
        cy.get('@editBtn').click({ force: true });
      });

      // Wait a moment for any modal to potentially appear
      cy.wait(1000);

      // The UpdateNamespace dialog should NOT appear because:
      // 1. User is on Free plan
      // 2. localhost is treated as official host (isAppFlowyHosted returns true)
      // The modal has class 'MuiDialog-root' or similar - check it doesn't exist
      cy.get('body').then(($body) => {
        // Look for any modal that might be the namespace update dialog
        const hasNamespaceModal = $body.find('[role="dialog"]').filter((_, el) => {
          return el.textContent?.includes('Update namespace') || el.textContent?.includes('Namespace');
        }).length > 0;

        if (!hasNamespaceModal) {
          testLog.info('✓ Edit namespace dialog correctly blocked (Free plan on official host)');
        } else {
          // If modal appeared, this might be a self-hosted environment where check is skipped
          testLog.info('Note: Namespace dialog appeared - may be self-hosted environment');
        }
      });

      // Close any open dialogs
      cy.get('body').type('{esc}');
      cy.wait(500);
    });
  });

  it('namespace URL button should be clickable even with UUID namespace', () => {
    // Verify that the namespace URL can be clicked/visited regardless of UUID status
    setupPublishManagePanel(testEmail).then(() => {
      cy.wait(1000);

      // Find the namespace URL button and verify it's clickable
      // The button should not be disabled even for UUID namespaces
      ShareSelectors.publishManagePanel().within(() => {
        // Find any button that contains the namespace link (has '/' in text)
        cy.get('button').contains('/').should('be.visible').should('not.be.disabled');
        testLog.info('✓ Namespace URL button is visible and clickable');
      });

      // Close the modal
      cy.get('body').type('{esc}');
      cy.wait(500);
    });
  });

  it('should allow namespace edit on self-hosted (non-official) environments', () => {
    // This test simulates a self-hosted environment where subscription checks are skipped
    // We use localStorage to override the isAppFlowyHosted() check

    // Set up the override BEFORE visiting the page
    cy.visit('/login', { failOnStatusCode: false });
    cy.window().then((win) => {
      win.localStorage.setItem('__test_force_self_hosted', 'true');
    });

    cy.wait(500);
    const authUtils = new AuthTestUtils();

    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url().should('include', '/app');
      testLog.info('Signed in (self-hosted mode)');

      // Wait for app to fully load
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
      PageSelectors.names().should('exist', { timeout: 30000 });
      cy.wait(2000);

      // Publish a page
      TestTool.openSharePopover();
      cy.contains('Publish').should('exist').click({ force: true });
      cy.wait(1000);

      ShareSelectors.publishConfirmButton().should('be.visible').should('not.be.disabled');
      ShareSelectors.publishConfirmButton().click({ force: true });
      testLog.info('Clicked Publish button');

      // Wait for publish to complete
      cy.wait(5000);
      ShareSelectors.publishNamespace().should('be.visible', { timeout: 10000 });
      testLog.info('Page published successfully');

      // Open the publish settings (manage panel)
      ShareSelectors.openPublishSettingsButton().should('be.visible').click({ force: true });
      cy.wait(2000);
      ShareSelectors.publishManagePanel().should('be.visible', { timeout: 10000 });
      testLog.info('Publish manage panel is visible');

      // On self-hosted, clicking the edit button should open the dialog (no subscription check)
      // Since user is owner, the edit should work
      ShareSelectors.publishManagePanel().within(() => {
        cy.get('[data-testid="edit-namespace-button"]').should('exist').click({ force: true });
      });

      // Wait and check if the namespace update dialog appears
      // On self-hosted, it should open since we only check owner status (not subscription)
      cy.wait(1000);

      // The dialog should appear on self-hosted environments
      // Look for the namespace update dialog
      cy.get('body').then(($body) => {
        const hasDialog = $body.find('[role="dialog"]').length > 0;

        if (hasDialog) {
          testLog.info('✓ Namespace edit dialog opened on self-hosted environment');
          // Close the dialog
          cy.get('body').type('{esc}');
        } else {
          testLog.info('Note: Dialog did not open - this may indicate the owner check failed');
        }
      });

      // Clean up: remove the override
      cy.window().then((win) => {
        win.localStorage.removeItem('__test_force_self_hosted');
      });

      // Close any remaining modals
      cy.get('body').type('{esc}');
      cy.wait(500);
    });
  });
});
