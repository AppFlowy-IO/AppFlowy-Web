import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  BoardSelectors,
  RowDetailSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { closeRowDetailWithEscape, typeInRowDocument } from '../../support/row-detail-helpers';

/**
 * Row Document indicator test (Board view).
 *
 * Flow:
 * 1) Create a Board database
 * 2) Add a new card
 * 3) Open row detail modal
 * 4) Type into row document
 * 5) Verify row document indicator appears on the card
 */
describe('Row Document Test', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
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

  const createBoardAndWait = (authUtils: AuthTestUtils, testEmail: string) => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    return authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').contains('Board').click({ force: true });
      cy.wait(5000);

      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(3000);
      BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
    });
  };

  it('shows row document indicator after editing row document', () => {
    const testEmail = generateRandomEmail();
    const cardName = `RowDoc-${uuidv4().substring(0, 6)}`;
    const docText = `row-doc-${uuidv4().substring(0, 6)}`;

    const authUtils = new AuthTestUtils();

    createBoardAndWait(authUtils, testEmail).then(() => {
      // Add a new card to "To Do"
      BoardSelectors.boardContainer()
        .contains('To Do')
        .closest('[data-column-id]')
        .within(() => {
          cy.contains('New').click({ force: true });
        });
      waitForReactUpdate(1000);

      cy.focused().type(`${cardName}{enter}`, { force: true });
      waitForReactUpdate(2000);

      BoardSelectors.boardContainer().contains(cardName, { timeout: 10000 }).should('be.visible');

      // Open row detail modal
      BoardSelectors.boardContainer().contains(cardName).click({ force: true });
      RowDetailSelectors.modal().should('exist');
      RowDetailSelectors.documentArea().should('exist');

      // Edit row document
      typeInRowDocument(docText);

      // Close modal
      closeRowDetailWithEscape();
      waitForReactUpdate(1000);

      // Verify document indicator appears on the card
      BoardSelectors.boardContainer()
        .contains(cardName)
        .closest('.board-card')
        .within(() => {
          cy.get('.custom-icon', { timeout: 15000 }).should('exist');
        });
    });
  });
});
