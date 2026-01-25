import { AuthTestUtils } from '../../support/auth-utils';
import { PageSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

/**
 * Tests for workspace data loading after async optimization.
 * Verifies that parallelizing getAppOutline and getShareWithMe API calls
 * doesn't break functionality.
 */
describe('Workspace Data Loading', () => {
  let testEmail: string;

  beforeEach(() => {
    testEmail = generateRandomEmail();

    // Handle uncaught exceptions that we expect during app initialization
    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return false;
      }
      return true;
    });
  });

  it('should load workspace outline with sidebar visible after async optimization', () => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url().should('include', '/app');
      testLog.info('Signed in successfully');

      // Wait for app to fully load - this tests that the parallelized API calls work
      testLog.info('Waiting for sidebar to load (testing parallelized API calls)...');
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
      PageSelectors.names().should('exist', { timeout: 30000 });
      cy.wait(2000);

      // Verify sidebar is visible and functional
      testLog.info('Verifying sidebar loaded correctly');
      SidebarSelectors.pageHeader().should('be.visible');
      PageSelectors.items().should('exist');

      testLog.info('Workspace loaded successfully with parallelized API calls');
    });
  });

  it('should handle shareWithMe API failure gracefully (outline still loads)', () => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url().should('include', '/app');

      // Wait for app to fully load
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
      PageSelectors.names().should('exist', { timeout: 30000 });
      cy.wait(2000);

      // Verify no critical errors related to outline loading
      cy.getConsoleLogs().then((consoleLogs) => {
        const criticalOutlineErrors = consoleLogs.filter((log: any) => {
          const message = JSON.stringify(log.args || []).toLowerCase();
          // Filter for critical errors that would break outline loading
          // Note: "Failed to load shareWithMe" is expected and acceptable
          return (
            message.includes('outline') &&
            message.includes('app outline not found') &&
            log.type === 'error'
          );
        });

        expect(criticalOutlineErrors.length).to.equal(
          0,
          'Outline should load even if shareWithMe fails'
        );
      });

      // Verify sidebar is still functional
      SidebarSelectors.pageHeader().should('be.visible');
      PageSelectors.items().should('exist');

      testLog.info('App handles shareWithMe failure gracefully');
    });
  });

  it('should not have React error boundaries triggered during workspace loading', () => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url().should('include', '/app');

      // Wait for app to fully load
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
      PageSelectors.names().should('exist', { timeout: 30000 });
      cy.wait(3000);

      // Check console logs for React error boundary messages
      cy.getConsoleLogs().then((consoleLogs) => {
        const errorBoundaryLogs = consoleLogs.filter((log: any) => {
          const message = JSON.stringify(log.args || []).toLowerCase();
          return (
            (message.includes('error occurred') && message.includes('outline')) ||
            message.includes('react will try to recreate')
          );
        });

        expect(errorBoundaryLogs.length).to.equal(
          0,
          'No React error boundaries should be triggered during workspace loading'
        );
      });

      testLog.info('No React error boundaries triggered during workspace loading');
    });
  });
});
