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

/**
 * Database Container Tab Operations Tests
 *
 * Tests for view tab operations:
 * - Renaming views
 * - Creating views via + button
 * - Sidebar sync after operations
 */
describe('Database Container - Tab Operations', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const dbName = 'New Database';
  const spaceName = 'General';

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
  const createGridAndWait = (authUtils: AuthTestUtils, testEmail: string) => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    return authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(7000);
      DatabaseGridSelectors.grid().should('exist');
      DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);
    });
  };

  /**
   * Helper: Ensure space is expanded in sidebar
   */
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

  /**
   * Helper: Ensure page/container is expanded in sidebar
   */
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

  /**
   * Helper: Open tab context menu by label using pointerdown
   */
  const openTabMenuByLabel = (label: string) => {
    cy.contains('[data-testid^="view-tab-"] span', label, { timeout: 10000 })
      .should('be.visible')
      .trigger('pointerdown', { button: 2, pointerType: 'mouse', force: true });
    waitForReactUpdate(500);
  };

  it('renames and creates views correctly', () => {
    const testEmail = generateRandomEmail();

    testLog.testStart('Database container tab operations');
    testLog.info(`Test email: ${testEmail}`);

    const authUtils = new AuthTestUtils();
    createGridAndWait(authUtils, testEmail).then(() => {
      // Step 1: Rename the first view (Grid -> MyGrid)
      testLog.step(1, 'Rename first tab to MyGrid');
      openTabMenuByLabel('Grid');
      DatabaseViewSelectors.tabActionRename().should('be.visible').click({ force: true });
      ModalSelectors.renameInput().should('be.visible').clear().type('MyGrid');
      ModalSelectors.renameSaveButton().click({ force: true });
      waitForReactUpdate(1000);
      cy.contains('[data-testid^="view-tab-"]', 'MyGrid', { timeout: 10000 }).should('exist');

      // Step 2: Add a Board view via tab bar (+)
      testLog.step(2, 'Add Board view via + button');
      DatabaseViewSelectors.addViewButton().should('be.visible').scrollIntoView().click({ force: true });
      cy.contains('Board', { timeout: 5000 }).should('be.visible').click({ force: true });
      waitForReactUpdate(3000);
      cy.contains('[data-testid^="view-tab-"]', 'Board', { timeout: 10000 })
        .should('exist')
        .and('have.attr', 'data-state', 'active');

      // Step 3: Rename Board -> MyBoard
      testLog.step(3, 'Rename Board tab to MyBoard');
      openTabMenuByLabel('Board');
      DatabaseViewSelectors.tabActionRename().should('be.visible').click({ force: true });
      ModalSelectors.renameInput().should('be.visible').clear().type('MyBoard');
      ModalSelectors.renameSaveButton().click({ force: true });
      waitForReactUpdate(1000);
      cy.contains('[data-testid^="view-tab-"]', 'MyBoard', { timeout: 10000 }).should('exist');
      cy.contains('[data-testid^="view-tab-"]', 'MyGrid', { timeout: 10000 }).should('exist');

      // Step 4: Verify sidebar container has 2 children
      testLog.step(4, 'Verify container children exist in sidebar');
      closeModalsIfOpen();
      ensureSpaceExpanded(spaceName);
      PageSelectors.itemByName(dbName).should('exist');
      ensurePageExpanded(dbName);

      waitForReactUpdate(2000);
      PageSelectors.itemByName(dbName).within(() => {
        cy.get('[data-testid="page-item"]').should('have.length', 2);
      });

      // Step 5: Verify tab bar has both renamed views
      testLog.step(5, 'Verify tab bar has both views');
      DatabaseViewSelectors.viewTab().should('have.length', 2);
      cy.contains('[data-testid^="view-tab-"]', 'MyGrid', { timeout: 5000 }).should('exist');
      cy.contains('[data-testid^="view-tab-"]', 'MyBoard', { timeout: 5000 }).should('exist');

      testLog.testEnd('Database container tab operations');
    });
  });
});
