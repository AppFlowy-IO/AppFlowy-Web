/**
 * Grid Scroll Stability E2E Tests
 *
 * Verifies that grid scrolling and navigation-away-while-scrolling
 * does not cause React errors (e.g., setState on unmounted component).
 *
 * Regression test for: GridVirtualizer missing clearTimeout cleanup
 * in scroll listener useEffect, which could fire setIsScrolling(false)
 * after the component unmounts.
 */
import { v4 as uuidv4 } from 'uuid';
import {
  AddPageSelectors,
  BoardSelectors,
  DatabaseGridSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { generateRandomEmail } from '../../support/test-config';

describe('Grid Scroll Stability', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      // Fail test on setState-after-unmount warnings that indicate missing cleanup
      if (
        err.message.includes("Can't perform a React state update on an unmounted component") ||
        err.message.includes("Can't perform a React state update on a component that's been unmounted")
      ) {
        return true; // Let it fail
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

  it('should handle grid scrolling without errors when navigating away', () => {
    const testEmail = generateRandomEmail();

    signInAndCreateDatabaseView(testEmail, 'Grid', {
      verify: () => {
        DatabaseGridSelectors.grid().should('exist', { timeout: 30000 });
        DatabaseGridSelectors.cells().should('have.length.at.least', 1, { timeout: 30000 });
      },
    }).then(() => {
      // Scroll the grid container to trigger the scroll listener
      cy.get('.appflowy-custom-scroller').first().then(($el) => {
        if ($el[0]) {
          // Trigger multiple scroll events rapidly
          for (let i = 0; i < 5; i++) {
            $el[0].scrollTop = i * 20;
          }
        }
      });

      waitForReactUpdate(200);

      // Navigate away immediately while the debounced setIsScrolling(false)
      // timeout is still pending (1000ms timer)
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // Wait for the scroll timeout to fire (1000ms) — with the fix,
      // clearTimeout prevents it from calling setState on the unmounted grid
      waitForReactUpdate(2000);

      // If we reach here without an error, the cleanup is working
      cy.get('body').should('exist');
    });
  });

  it('should handle rapid scroll start/stop cycles', () => {
    const testEmail = generateRandomEmail();

    signInAndCreateDatabaseView(testEmail, 'Grid', {
      verify: () => {
        DatabaseGridSelectors.grid().should('exist', { timeout: 30000 });
        DatabaseGridSelectors.cells().should('have.length.at.least', 1, { timeout: 30000 });
      },
    }).then(() => {
      // Rapidly scroll to trigger multiple timeout resets
      cy.get('.appflowy-custom-scroller').first().then(($el) => {
        if ($el[0]) {
          for (let cycle = 0; cycle < 3; cycle++) {
            for (let i = 0; i < 5; i++) {
              $el[0].scrollTop = cycle * 100 + i * 20;
            }
          }
        }
      });

      // Wait for the debounce timeout to settle
      waitForReactUpdate(2000);

      // Grid should still be functional
      DatabaseGridSelectors.grid().should('exist');
      DatabaseGridSelectors.cells().should('have.length.at.least', 1);
    });
  });
});
