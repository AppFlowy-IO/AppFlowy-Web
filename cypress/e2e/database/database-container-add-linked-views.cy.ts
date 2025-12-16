import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import { closeModalsIfOpen, testLog } from '../../support/test-helpers';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  DropdownSelectors,
  PageSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

describe('Database Container - Add Linked Views via Tab Bar', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const dbName = 'New Database';
  const spaceName = 'General';

  const ensureSpaceExpanded = (name: string) => {
    SpaceSelectors.itemByName(name).should('exist');
    SpaceSelectors.itemByName(name).then(($space) => {
      const expandedIndicator = $space.find('[data-testid="space-expanded"]');
      const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

      if (!isExpanded) {
        SpaceSelectors.itemByName(name).find('[data-testid="space-name"]').click({ force: true });
        waitForReactUpdate(500);
      }
    });
  };

  const ensurePageExpanded = (name: string) => {
    PageSelectors.itemByName(name).should('exist');
    PageSelectors.itemByName(name).then(($page) => {
      const isExpanded = $page.find('[data-testid="outline-toggle-collapse"]').length > 0;

      if (!isExpanded) {
        PageSelectors.itemByName(name).find('[data-testid="outline-toggle-expand"]').first().click({ force: true });
        waitForReactUpdate(500);
      }
    });
  };

  const addViewViaPlus = (viewTypeLabel: 'Board' | 'Calendar') => {
    DatabaseViewSelectors.addViewButton().should('be.visible').scrollIntoView().click({ force: true });

    DropdownSelectors.content({ timeout: 10000 })
      .should('be.visible')
      .within(() => {
        cy.contains('[role="menuitem"]', viewTypeLabel).should('be.visible').click({ force: true });
      });

    waitForReactUpdate(3000);
    cy.contains('[data-testid^="view-tab-"]', viewTypeLabel, { timeout: 20000 })
      .should('exist')
      .and('have.attr', 'data-state', 'active');
  };

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

  it('adds Board and Calendar views and reflects them in tabs and sidebar', () => {
    const testEmail = generateRandomEmail();

    testLog.testStart('Database container add linked views');
    testLog.info(`Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // 1) Create standalone Grid database (container + first child view)
      testLog.step(1, 'Create standalone Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      // The grid container may exist before it has a stable height; wait for cells to render.
      cy.wait(7000);
      DatabaseGridSelectors.grid().should('exist');
      DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);

      // Scenario 4 parity: tab bar "+" adds linked views to the same container
      testLog.step(2, 'Verify initial tabs (single tab)');
      DatabaseViewSelectors.viewTab()
        .should('have.length', 1)
        .first()
        .should('have.attr', 'data-state', 'active')
        .and('contain.text', 'Grid'); // First tab shows child view name, not container name

      testLog.step(3, 'Add Board view via tab bar "+"');
      addViewViaPlus('Board');
      DatabaseViewSelectors.viewTab().should('have.length', 2);

      testLog.step(4, 'Add Calendar view via tab bar "+"');
      addViewViaPlus('Calendar');
      DatabaseViewSelectors.viewTab().should('have.length', 3);

      testLog.step(5, 'Verify sidebar container children updated');
      closeModalsIfOpen();
      ensureSpaceExpanded(spaceName);
      ensurePageExpanded(dbName);

      PageSelectors.itemByName(dbName).within(() => {
        PageSelectors.nameContaining('Board').should('be.visible');
        PageSelectors.nameContaining('Calendar').should('be.visible');
        PageSelectors.items().should('have.length', 3);
      });

      testLog.testEnd('Database container add linked views');
    });
  });
});
