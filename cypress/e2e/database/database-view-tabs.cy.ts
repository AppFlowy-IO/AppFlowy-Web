import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  DatabaseViewSelectors,
  PageSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

/**
 * Tests that database view tabs work correctly.
 * Based on Desktop test: database_view_test.dart
 */
describe('Database View Tabs', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
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
   * Similar to Desktop test: 'create linked view'
   * Creates a database and adds multiple views via the + button.
   * Verifies all views appear as tabs.
   */
  it('creates multiple views and shows all in tab bar', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Database view tabs - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 1: Create a Grid database
      cy.task('log', '[STEP 1] Creating Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Step 2: Verify Grid tab exists
      cy.task('log', '[STEP 2] Verifying Grid tab exists');
      cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist');
      DatabaseViewSelectors.viewTab().should('have.length.at.least', 1);

      // Get initial tab count
      DatabaseViewSelectors.viewTab().then(($tabs) => {
        cy.task('log', `[STEP 2.1] Initial tab count: ${$tabs.length}`);
        cy.wrap($tabs.length).as('initialTabCount');
      });

      // Step 3: Create a Board view via + button
      cy.task('log', '[STEP 3] Creating Board view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);

      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });

      waitForReactUpdate(3000);

      // Step 4: Verify Board tab was added
      cy.task('log', '[STEP 4] Verifying Board tab was added');
      cy.get('@initialTabCount').then((initialCount) => {
        DatabaseViewSelectors.viewTab().should('have.length', (initialCount as number) + 1);
      });

      // Step 5: Create a Calendar view via + button
      cy.task('log', '[STEP 5] Creating Calendar view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);

      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Calendar')
        .click({ force: true });

      waitForReactUpdate(3000);

      // Step 6: Verify Calendar tab was added (now 3 total tabs)
      cy.task('log', '[STEP 6] Verifying Calendar tab was added');
      cy.get('@initialTabCount').then((initialCount) => {
        DatabaseViewSelectors.viewTab().should('have.length', (initialCount as number) + 2);
      });

      // Step 7: Verify sidebar shows all children
      cy.task('log', '[STEP 7] Verifying sidebar shows all views');
      ensureSpaceExpanded(spaceName);
      waitForReactUpdate(1000);

      // Expand the database to see children
      PageSelectors.itemByName('New Database', { timeout: 10000 }).then(($dbItem) => {
        const expandToggle = $dbItem.find('[data-testid="outline-toggle-expand"]');
        if (expandToggle.length > 0) {
          cy.wrap(expandToggle.first()).click({ force: true });
          waitForReactUpdate(500);
        }
      });

      // Verify children exist
      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        PageSelectors.names().should('have.length.at.least', 3);
      });

      // Step 8: Navigate away and back to verify tabs persist
      cy.task('log', '[STEP 8] Navigating away and back');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true }); // Create document
      waitForReactUpdate(2000);

      // Navigate back to database
      ensureSpaceExpanded(spaceName);
      PageSelectors.itemByName('New Database', { timeout: 10000 }).first().click({ force: true });
      waitForReactUpdate(3000);

      // Step 9: Verify all tabs are still present
      cy.task('log', '[STEP 9] Verifying all tabs persist after navigation');
      cy.get('@initialTabCount').then((initialCount) => {
        DatabaseViewSelectors.viewTab().should('have.length', (initialCount as number) + 2);
      });

      cy.task('log', '[TEST COMPLETE] All views appear in tab bar correctly');
    });
  });

  /**
   * Similar to Desktop test: 'tab selection updates sidebar selection'
   * Verifies that clicking a tab updates the sidebar selection.
   */
  it('tab selection updates sidebar selection', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Tab selection - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create a Grid database
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Create a Board view
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });
      waitForReactUpdate(3000);

      // Expand database in sidebar
      ensureSpaceExpanded(spaceName);
      waitForReactUpdate(500);
      PageSelectors.itemByName('New Database', { timeout: 10000 }).then(($dbItem) => {
        const expandToggle = $dbItem.find('[data-testid="outline-toggle-expand"]');
        if (expandToggle.length > 0) {
          cy.wrap(expandToggle.first()).click({ force: true });
          waitForReactUpdate(500);
        }
      });

      // Click on Grid tab
      cy.task('log', '[STEP] Clicking Grid tab');
      DatabaseViewSelectors.viewTab().contains('Grid').click({ force: true });
      waitForReactUpdate(1000);

      // Verify Grid is selected in sidebar
      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        cy.get('[data-selected="true"]').should('contain.text', 'Grid');
      });

      // Click on Board tab
      cy.task('log', '[STEP] Clicking Board tab');
      DatabaseViewSelectors.viewTab().contains('Board').click({ force: true });
      waitForReactUpdate(1000);

      // Verify Board is selected in sidebar
      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        cy.get('[data-selected="true"]').should('contain.text', 'Board');
      });

      cy.task('log', '[TEST COMPLETE] Tab selection updates sidebar');
    });
  });
});
