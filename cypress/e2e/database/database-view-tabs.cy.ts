import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  BreadcrumbSelectors,
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

      // Verify children exist and match the database views (Grid, Board, Calendar)
      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        PageSelectors.names().should('have.length.at.least', 3);
        // Verify each view type exists in sidebar
        cy.contains('Grid').should('exist');
        cy.contains('Board').should('exist');
        cy.contains('Calendar').should('exist');
      });

      // Step 7.1: Verify tab bar and sidebar have matching views
      cy.task('log', '[STEP 7.1] Verifying tab bar and sidebar views match');
      DatabaseViewSelectors.viewTab().contains('Grid').should('exist');
      DatabaseViewSelectors.viewTab().contains('Board').should('exist');
      DatabaseViewSelectors.viewTab().contains('Calendar').should('exist');

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

  /**
   * Regression test: breadcrumb should reflect the active database tab view.
   */
  it('breadcrumb shows active database tab view', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Breadcrumb reflects active tab - Email: ${testEmail}`);

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

      // Add a Board view
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });
      waitForReactUpdate(3000);

      // Switch to Board tab
      DatabaseViewSelectors.viewTab().contains('Board').click({ force: true });
      waitForReactUpdate(1000);
      DatabaseViewSelectors.activeViewTab().should('contain.text', 'Board');

      // Verify breadcrumb shows Board as the active view
      BreadcrumbSelectors.navigation()
        .find('[data-testid^="breadcrumb-item-"]')
        .should('have.length.at.least', 1)
        .last()
        .should('contain.text', 'Board')
        .and('not.contain.text', 'Grid');

      cy.task('log', '[TEST COMPLETE] Breadcrumb shows active tab view');
    });
  });

  /**
   * Regression test for: newly created views should appear immediately in tab bar.
   *
   * Previously, views wouldn't appear until the folder/outline synced from the server.
   * The fix ensures views from Yjs (database_update) are shown immediately without
   * waiting for folder sync.
   *
   * See: selector.ts - useDatabaseViewsSelector now includes non-embedded views from Yjs
   */
  it('newly created view appears immediately in tab bar (no sync delay)', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Immediate view appearance - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create a Grid database
      cy.task('log', '[STEP 1] Creating Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Verify initial state - should have exactly 1 tab (Grid)
      cy.task('log', '[STEP 2] Verifying initial tab count');
      DatabaseViewSelectors.viewTab().should('have.length.at.least', 1);
      DatabaseViewSelectors.viewTab().then(($tabs) => {
        cy.wrap($tabs.length).as('initialTabCount');
      });

      // Click + button to add Board view
      cy.task('log', '[STEP 3] Clicking + button to add Board view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(300); // Short wait for menu to appear

      // Click Board option
      cy.get('[role="menu"], [role="menuitem"]', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });

      // CRITICAL: Verify tab appears quickly (within 1s)
      // This tests that the view appears from Yjs immediately, not waiting for folder sync
      // Previously this would fail because views only appeared after folder sync (3+ seconds)
      cy.task('log', '[STEP 4] Verifying Board tab appears quickly (within 1s)');
      waitForReactUpdate(200); // Minimal wait for React to process the state update
      cy.get('@initialTabCount').then((initialCount) => {
        cy.get('[data-testid^="view-tab-"]', { timeout: 1000 }).should(
          'have.length',
          (initialCount as number) + 1
        );
      });

      // Verify the Board tab is active (selected)
      cy.task('log', '[STEP 5] Verifying Board tab is active');
      DatabaseViewSelectors.activeViewTab().should('exist');
      cy.get('[data-testid^="view-tab-"][data-state="active"]')
        .should('contain.text', 'Board');

      // Add Calendar view with same immediate check
      cy.task('log', '[STEP 6] Adding Calendar view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(300);

      cy.get('[role="menu"], [role="menuitem"]', { timeout: 5000 })
        .should('be.visible')
        .contains('Calendar')
        .click({ force: true });

      // Verify Calendar tab appears immediately
      cy.task('log', '[STEP 7] Verifying Calendar tab appears IMMEDIATELY');
      cy.get('@initialTabCount').then((initialCount) => {
        cy.get('[data-testid^="view-tab-"]', { timeout: 500 }).should(
          'have.length',
          (initialCount as number) + 2
        );
      });

      // Step 8: Verify sidebar matches tab bar views
      cy.task('log', '[STEP 8] Verifying sidebar matches tab bar views');
      ensureSpaceExpanded(spaceName);
      waitForReactUpdate(500);

      // Expand the database to see children
      PageSelectors.itemByName('New Database', { timeout: 10000 }).then(($dbItem) => {
        const expandToggle = $dbItem.find('[data-testid="outline-toggle-expand"]');
        if (expandToggle.length > 0) {
          cy.wrap(expandToggle).first().click({ force: true });
          waitForReactUpdate(500);
        }
      });

      // Verify sidebar contains all view types
      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        cy.contains('Grid').should('exist');
        cy.contains('Board').should('exist');
        cy.contains('Calendar').should('exist');
      });

      cy.task('log', '[TEST COMPLETE] Views appear immediately without sync delay');
    });
  });
});
