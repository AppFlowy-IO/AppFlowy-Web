import { v4 as uuidv4 } from 'uuid';
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
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';

/**
 * Database Container Open Behavior Tests
 *
 * Tests that clicking a database container in the sidebar
 * correctly opens its first child view.
 */
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

  /**
   * Helper: Create a Grid database and wait for it to load
   */
  const createGridAndWait = (testEmail: string) => {
    return signInAndCreateDatabaseView(testEmail, 'Grid', {
      createWaitMs: 7000,
      verify: () => {
        DatabaseGridSelectors.grid().should('exist');
        DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);
      },
    });
  };

  it('opens the first child view when clicking a database container', () => {
    const testEmail = generateRandomEmail();
    testLog.testStart('Database container opens first child');
    testLog.info(`Test email: ${testEmail}`);

    createGridAndWait(testEmail).then(() => {
      // Verify: a newly created container has exactly 1 child view
      testLog.step(1, 'Verify database has one child view');
      DatabaseViewSelectors.viewTab()
        .should('have.length', 1)
        .first()
        .should('have.attr', 'data-state', 'active')
        .and('contain.text', 'Grid');

      // Ensure sidebar space is expanded
      SpaceSelectors.itemByName(spaceName).should('exist');
      SpaceSelectors.itemByName(spaceName).then(($space) => {
        const expandedIndicator = $space.find('[data-testid="space-expanded"]');
        const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

        if (!isExpanded) {
          SpaceSelectors.itemByName(spaceName).find('[data-testid="space-name"]').click({ force: true });
          waitForReactUpdate(500);
        }
      });

      // Capture the currently active viewId (the first child view)
      testLog.step(2, 'Capture first child view id');
      currentViewIdFromUrl().then((firstChildViewId) => {
        expect(firstChildViewId).to.not.equal('');
        cy.wrap(firstChildViewId).as('firstChildViewId');
      });

      // Navigate away to a document page
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

      // Click on the database container in sidebar and verify redirect to first child
      testLog.step(4, 'Click container and verify redirect to first child');
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
