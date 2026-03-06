/**
 * Board Scroll Stability E2E Tests
 *
 * Verifies that board view scrolling and navigation-away-while-scrolling
 * does not cause errors.
 *
 * Regression test for:
 * - Group.tsx: removeEventListener missing options (inconsistent with addEventListener)
 * - Ensures scroll listeners are properly cleaned up on unmount
 */
import {
  AddPageSelectors,
  BoardSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { generateRandomEmail } from '../../support/test-config';

describe('Board Scroll Stability', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes("Can't perform a React state update on an unmounted component") ||
        err.message.includes("Can't perform a React state update on a component that's been unmounted")
      ) {
        return true; // Let it fail — this is what the fix prevents
      }

      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return false;
      }

      return true;
    });

    cy.viewport(1280, 720);
  });

  it('should handle board horizontal scrolling without errors', () => {
    const testEmail = generateRandomEmail();

    signInAndCreateDatabaseView(testEmail, 'Board', {
      verify: () => {
        BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
        waitForReactUpdate(3000);
        BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
      },
    }).then(() => {
      // Scroll the board container horizontally
      cy.get('.appflowy-custom-scroller').first().then(($el) => {
        if ($el[0]) {
          $el[0].scrollLeft = 200;
        }
      });

      waitForReactUpdate(500);

      // Scroll back
      cy.get('.appflowy-custom-scroller').first().then(($el) => {
        if ($el[0]) {
          $el[0].scrollLeft = 0;
        }
      });

      waitForReactUpdate(500);

      // Board should still be functional
      BoardSelectors.boardContainer().should('exist');
      BoardSelectors.cards().should('have.length.at.least', 1);
    });
  });

  it('should handle navigating away while board is scrolling', () => {
    const testEmail = generateRandomEmail();

    signInAndCreateDatabaseView(testEmail, 'Board', {
      verify: () => {
        BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
        waitForReactUpdate(3000);
        BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
      },
    }).then(() => {
      // Trigger scroll events on the board's vertical scroll container
      cy.get('.appflowy-scroll-container').first().then(($el) => {
        if ($el[0]) {
          for (let i = 0; i < 5; i++) {
            $el[0].scrollTop = i * 30;
          }
        }
      });

      waitForReactUpdate(200);

      // Navigate away immediately while scroll listener may still be active
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menuitem"]').first().click({ force: true });

      // Wait to ensure cleanup happened properly
      waitForReactUpdate(2000);

      // If we reach here without error, cleanup is working
      cy.get('body').should('exist');
    });
  });
});
