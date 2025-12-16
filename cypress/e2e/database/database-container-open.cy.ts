import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import { closeModalsIfOpen, testLog } from '../../support/test-helpers';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  ModalSelectors,
  PageSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

describe('Database Container Open Behavior', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const dbName = 'New Database';
  const spaceName = 'General';

  const currentViewIdFromUrl = () =>
    cy.location('pathname').then((pathname) => {
      const maybeId = pathname.split('/').filter(Boolean).pop() || '';
      return maybeId;
    });

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

  it('opens the first child view when clicking a database container', () => {
    const testEmail = generateRandomEmail();
    testLog.testStart('Database container opens first child');
    testLog.info(`Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create a standalone database (container + first child view)
      testLog.step(1, 'Create standalone Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });

      // Wait for the database UI to appear
      // The grid container may exist before it has a stable height; wait for cells to render.
      cy.wait(7000);
      DatabaseGridSelectors.grid().should('exist');
      DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);

      // Scenario 1 parity: a newly created container has exactly 1 child view
      DatabaseViewSelectors.viewTab()
        .should('have.length', 1)
        .first()
        .should('have.attr', 'data-state', 'active')
        .and('contain.text', 'Grid'); // First tab shows child view name, not container name

      // Ensure sidebar is visible and space expanded
      SpaceSelectors.itemByName(spaceName).should('exist');
      SpaceSelectors.itemByName(spaceName).then(($space) => {
        const expandedIndicator = $space.find('[data-testid="space-expanded"]');
        const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

        if (!isExpanded) {
          SpaceSelectors.itemByName(spaceName).find('[data-testid="space-name"]').click({ force: true });
          waitForReactUpdate(500);
        }
      });

      // Capture the currently active viewId (the first child view opened after container creation)
      testLog.step(2, 'Capture first child view id');
      currentViewIdFromUrl().then((firstChildViewId) => {
        expect(firstChildViewId).to.not.equal('');
        cy.wrap(firstChildViewId).as('firstChildViewId');
      });

      // Navigate away to a document page so we can click the container again
      testLog.step(3, 'Navigate away to a new document');
      closeModalsIfOpen();
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="new-page-modal"]').length > 0) {
          ModalSelectors.newPageModal()
            .should('be.visible')
            .within(() => {
              ModalSelectors.spaceItemInModal().first().click({ force: true });
              waitForReactUpdate(500);
              cy.contains('button', 'Add').click({ force: true });
            });
        }
      });
      waitForReactUpdate(2000);

      // Click on the database container in the sidebar and ensure we land on its first child view id
      testLog.step(4, 'Click container and verify redirect');
      PageSelectors.nameContaining(dbName).first().click({ force: true });

      cy.get<string>('@firstChildViewId').then((firstChildViewId) => {
        cy.location('pathname', { timeout: 20000 }).should('include', `/${firstChildViewId}`);
        DatabaseViewSelectors.viewTab(firstChildViewId).should('have.attr', 'data-state', 'active');
      });

      DatabaseGridSelectors.grid().should('exist');
      DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);

      testLog.testEnd('Database container opens first child');
    });
  });
});
