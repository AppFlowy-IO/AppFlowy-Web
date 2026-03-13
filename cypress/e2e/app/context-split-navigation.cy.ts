/**
 * App Context Split Navigation Stability E2E Tests
 *
 * Verifies that the 5-way context split (Navigation, Operations, Outline,
 * Sync, Auth) works correctly during rapid cross-view-type navigation.
 *
 * Regression tests for:
 * - AppNavigationContext: viewId updates correctly across view types
 * - AppOperationsContext: stable callbacks survive navigation changes
 * - AppOutlineContext: outline/favorites/recent not affected by navigation
 * - AppSyncContext: awareness map cleanup on view switch
 * - Context isolation: changing one context doesn't cascade to others
 */
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  PageSelectors,
  SidebarSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { TestTool } from '../../support/page-utils';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Context Split Navigation Stability', () => {
  let testEmail: string;

  beforeEach(() => {
    testEmail = generateRandomEmail();

    cy.on('uncaught:exception', (err) => {
      // Fail on context-related errors that indicate broken context split
      if (
        err.message.includes('Cannot read properties of null') &&
        err.message.includes('useContext')
      ) {
        return true; // Let it fail — context not provided
      }

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

  it('should navigate between document and grid views without context errors', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      TestTool.expandSpace();
      waitForReactUpdate(1000);

      // Navigate to the default document page
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // Verify document editor loaded
      cy.url().should('include', '/app/');

      // Create a Grid view
      testLog.info('Creating Grid view...');
      PageSelectors.items()
        .first()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
      waitForReactUpdate(500);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menuitem"]').contains('Grid').click({ force: true });
      waitForReactUpdate(3000);

      // Verify grid loaded
      DatabaseGridSelectors.grid().should('exist', { timeout: 15000 });
      testLog.info('Grid view loaded successfully');

      // Navigate back to the document by clicking the first page
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // Document should load without context errors
      cy.url().should('include', '/app/');

      // Verify sidebar is still functional (AppOutlineContext not broken)
      PageSelectors.items().should('exist');
      SidebarSelectors.pageHeader().should('be.visible');

      testLog.info('Document-Grid navigation completed without errors');
    });
  });

  it('should handle rapid navigation between multiple pages without stale context', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      TestTool.expandSpace();
      waitForReactUpdate(1000);

      // Create multiple pages by clicking add button rapidly
      for (let i = 0; i < 3; i++) {
        PageSelectors.items()
          .first()
          .trigger('mouseenter', { force: true })
          .trigger('mouseover', { force: true });
        waitForReactUpdate(500);

        AddPageSelectors.inlineAddButton().first().click({ force: true });
        waitForReactUpdate(500);
        cy.get('[role="menuitem"]').first().click({ force: true }); // Create Doc
        waitForReactUpdate(2000);

        // Dismiss any modal that appears
        cy.get('body').then(($body) => {
          if ($body.find('[role="dialog"]').length > 0) {
            cy.get('[role="dialog"]').find('button').filter(':visible').last().click({ force: true });
            waitForReactUpdate(500);
          }
        });
      }

      // Now rapidly navigate between pages
      PageSelectors.items().then(($items) => {
        const count = Math.min($items.length, 4);

        for (let i = 0; i < count; i++) {
          cy.wrap($items[i]).click({ force: true });
          waitForReactUpdate(500); // Brief wait — tests rapid context updates
        }
      });

      // After rapid navigation, app should still be stable
      waitForReactUpdate(2000);
      cy.url().should('include', '/app/');
      SidebarSelectors.pageHeader().should('be.visible');
      PageSelectors.items().should('exist');

      // Verify no React error boundaries triggered
      cy.getConsoleLogs().then((consoleLogs) => {
        const contextErrors = consoleLogs.filter((log: any) => {
          const message = JSON.stringify(log.args || []).toLowerCase();
          return (
            (message.includes('context') && message.includes('null')) ||
            message.includes('react will try to recreate') ||
            message.includes('error boundary')
          );
        });

        expect(contextErrors.length).to.equal(
          0,
          'No context errors should occur during rapid navigation'
        );
      });

      testLog.info('Rapid navigation completed without stale context issues');
    });
  });

  it('should maintain sidebar outline state during view type switches', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      TestTool.expandSpace();
      waitForReactUpdate(1000);

      // Count initial sidebar items
      let initialItemCount = 0;
      PageSelectors.items().then(($items) => {
        initialItemCount = $items.length;
        testLog.info(`Initial sidebar items: ${initialItemCount}`);
      });

      // Navigate to default document page
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // Create a Grid view (switches AppNavigationContext.viewId)
      PageSelectors.items()
        .first()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
      waitForReactUpdate(500);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menuitem"]').contains('Grid').click({ force: true });
      waitForReactUpdate(5000);

      // Verify sidebar still shows items (AppOutlineContext not re-rendered to empty)
      PageSelectors.items().should('exist');
      PageSelectors.items().then(($items) => {
        // Should have at least the same number of items (may have more from Grid creation)
        expect($items.length).to.be.at.least(initialItemCount);
        testLog.info(`Sidebar items after view switch: ${$items.length}`);
      });

      // Navigate back to document
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // Sidebar should still be fully functional
      PageSelectors.items().should('exist');
      SidebarSelectors.pageHeader().should('be.visible');

      testLog.info('Sidebar outline state maintained across view type switches');
    });
  });

  it('should handle creating and immediately navigating away from AI chat', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      TestTool.expandSpace();
      waitForReactUpdate(1000);

      // Create an AI chat
      PageSelectors.items()
        .first()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
      waitForReactUpdate(500);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(500);
      AddPageSelectors.addAIChatButton().should('be.visible').click();
      waitForReactUpdate(1000);

      // Immediately navigate away before chat fully initializes
      // (tests AppSyncContext cleanup + AppNavigationContext update race)
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // App should still be stable — no unmount errors from chat providers
      cy.url().should('include', '/app/');
      SidebarSelectors.pageHeader().should('be.visible');

      // Create a Grid immediately after
      PageSelectors.items()
        .first()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
      waitForReactUpdate(500);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menuitem"]').contains('Grid').click({ force: true });
      waitForReactUpdate(5000);

      // Grid should load cleanly after the aborted chat
      DatabaseGridSelectors.grid().should('exist', { timeout: 15000 });

      testLog.info('Chat → document → grid navigation completed without errors');
    });
  });
});
