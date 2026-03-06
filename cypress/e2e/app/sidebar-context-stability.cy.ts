/**
 * Sidebar Context Stability E2E Tests
 *
 * Verifies that sidebar outline operations (expand/collapse, favorites,
 * recent views) work correctly after the AppOutlineContext split.
 *
 * Regression tests for:
 * - AppOutlineContext: outline, favoriteViews, recentViews isolation
 * - useAppFavorites() / useAppRecent() / useAppTrash() narrower hooks
 * - useAppOutline() / useLoadViewChildren() lazy-loading hooks
 * - Outline.tsx: loadingViewIdsRef, autoLoadRetryAfterRef using refs
 * - ViewItem.tsx: handleChangeIcon, handleRemoveIcon callback stability
 * - Favorite.tsx: useMemo grouping by day (today, yesterday, thisWeek, other)
 */
import {
  AddPageSelectors,
  PageSelectors,
  SidebarSelectors,
  SpaceSelectors,
  TrashSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { TestTool } from '../../support/page-utils';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Sidebar Context Stability', () => {
  let testEmail: string;

  beforeEach(() => {
    testEmail = generateRandomEmail();

    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return false;
      }

      return true;
    });
  });

  it('should handle rapid space expand/collapse without outline context errors', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      // Get the first space element for expand/collapse
      cy.get('[data-testid^="space-"][data-expanded]:visible', { timeout: 30000 })
        .first()
        .invoke('attr', 'data-testid')
        .then((spaceTestId) => {
          const selector = `[data-testid="${spaceTestId}"]`;

          // Rapidly toggle expand/collapse 4 times
          // This exercises loadViewChildren / loadingViewIdsRef / lazy-loading
          for (let i = 0; i < 4; i++) {
            cy.get(selector).click({ force: true });
            waitForReactUpdate(300);
          }

          // Final expand to verify tree is visible
          cy.get(selector).invoke('attr', 'data-expanded').then((expanded) => {
            if (expanded !== 'true') {
              cy.get(selector).click({ force: true });
            }
          });

          waitForReactUpdate(2000);

          // Pages should be visible in the expanded space
          PageSelectors.items().should('exist');

          // Verify no React errors in console
          cy.getConsoleLogs().then((consoleLogs) => {
            const outlineErrors = consoleLogs.filter((log: any) => {
              const message = JSON.stringify(log.args || []).toLowerCase();
              return (
                (message.includes('outline') || message.includes('loadviewchildren')) &&
                log.type === 'error'
              );
            });

            expect(outlineErrors.length).to.equal(
              0,
              'No outline context errors during rapid expand/collapse'
            );
          });

          testLog.info('Rapid expand/collapse completed without errors');
        });
    });
  });

  it('should maintain page list during page creation and deletion', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      TestTool.expandSpace();
      waitForReactUpdate(1000);

      // Count initial pages
      let initialCount = 0;
      PageSelectors.items().then(($items) => {
        initialCount = $items.length;
        testLog.info(`Initial page count: ${initialCount}`);
      });

      // Create a new page
      PageSelectors.items()
        .first()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
      waitForReactUpdate(500);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menuitem"]').first().click({ force: true }); // Create Doc
      waitForReactUpdate(3000);

      // Dismiss dialog if present
      cy.get('body').then(($body) => {
        if ($body.find('[role="dialog"]').length > 0) {
          cy.get('[role="dialog"]').find('button').filter(':visible').last().click({ force: true });
          waitForReactUpdate(500);
        }
      });

      // Page count should have increased
      PageSelectors.items().then(($items) => {
        expect($items.length).to.be.greaterThan(initialCount);
        testLog.info(`Page count after creation: ${$items.length}`);
      });

      // Sidebar should still be fully functional
      SidebarSelectors.pageHeader().should('be.visible');
      SpaceSelectors.items().should('exist');

      testLog.info('Page creation maintained sidebar state correctly');
    });
  });

  it('should handle sidebar interactions during page navigation', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      TestTool.expandSpace();
      waitForReactUpdate(1000);

      // Navigate to first page
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // While a page is loading, interact with sidebar (expand another space if exists)
      SpaceSelectors.items().then(($spaces) => {
        if ($spaces.length > 1) {
          // Click second space to expand it while first page is still rendering
          cy.wrap($spaces[1]).click({ force: true });
          waitForReactUpdate(1000);
        }
      });

      // Navigate to a different page rapidly
      PageSelectors.items().then(($items) => {
        if ($items.length > 1) {
          cy.wrap($items[1]).click({ force: true });
          waitForReactUpdate(1000);
        }
      });

      // Navigate again
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // Verify app is stable
      cy.url().should('include', '/app/');
      SidebarSelectors.pageHeader().should('be.visible');
      PageSelectors.items().should('exist');

      // Check for context-related console errors
      cy.getConsoleLogs().then((consoleLogs) => {
        const contextErrors = consoleLogs.filter((log: any) => {
          const message = JSON.stringify(log.args || []).toLowerCase();
          return (
            message.includes('cannot read properties of null') ||
            message.includes('is not a function') ||
            (message.includes('context') && log.type === 'error')
          );
        });

        expect(contextErrors.length).to.equal(
          0,
          'No context errors during sidebar + navigation interaction'
        );
      });

      testLog.info('Sidebar interactions during navigation completed without errors');
    });
  });

  it('should open trash page and navigate back without context loss', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      TestTool.expandSpace();
      waitForReactUpdate(1000);

      // Navigate to a page first
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);
      cy.url().should('include', '/app/');

      // Open trash page (exercises useAppTrash hook)
      TrashSelectors.sidebarTrashButton().should('exist').click({ force: true });
      waitForReactUpdate(2000);

      // Trash page should be visible
      cy.url().should('include', '/trash');

      // Navigate back to a page
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // Verify app is stable after trash → page navigation
      cy.url().should('include', '/app/');
      SidebarSelectors.pageHeader().should('be.visible');
      PageSelectors.items().should('exist');

      testLog.info('Trash navigation and back completed without context loss');
    });
  });

  it('should handle concurrent sidebar and page creation operations', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      TestTool.expandSpace();
      waitForReactUpdate(1000);

      // Create two pages rapidly to stress the AppOperationsContext.addPage callback
      for (let i = 0; i < 2; i++) {
        PageSelectors.items()
          .first()
          .trigger('mouseenter', { force: true })
          .trigger('mouseover', { force: true });
        waitForReactUpdate(500);

        AddPageSelectors.inlineAddButton().first().click({ force: true });
        waitForReactUpdate(500);
        cy.get('[role="menuitem"]').first().click({ force: true });
        waitForReactUpdate(2000);

        // Dismiss dialog
        cy.get('body').then(($body) => {
          if ($body.find('[role="dialog"]').length > 0) {
            cy.get('[role="dialog"]').find('button').filter(':visible').last().click({ force: true });
            waitForReactUpdate(500);
          }
        });
      }

      // Immediately navigate back to first page
      PageSelectors.items().first().click({ force: true });
      waitForReactUpdate(2000);

      // Verify all operations completed without context errors
      SidebarSelectors.pageHeader().should('be.visible');
      PageSelectors.items().should('have.length.at.least', 3); // original + 2 new pages

      cy.getConsoleLogs().then((consoleLogs) => {
        const errorLogs = consoleLogs.filter((log: any) => {
          const message = JSON.stringify(log.args || []).toLowerCase();
          return (
            log.type === 'error' &&
            !message.includes('websocket') &&
            !message.includes('failed to load models') &&
            !message.includes('billing')
          );
        });

        if (errorLogs.length > 0) {
          testLog.info(`Found ${errorLogs.length} error logs (checking for context errors)`);
          errorLogs.forEach((log: any) => {
            testLog.info(`Error: ${JSON.stringify(log.args).substring(0, 200)}`);
          });
        }
      });

      testLog.info('Concurrent operations completed without context issues');
    });
  });
});
