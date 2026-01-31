import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  BreadcrumbSelectors,
  DatabaseViewSelectors,
  ModalSelectors,
  PageSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

/**
 * Database View Tabs Tests
 *
 * Tests for database view tab functionality:
 * - Creating multiple views and immediate appearance
 * - Renaming views
 * - Tab selection updates sidebar selection
 * - Breadcrumb reflects active tab
 * - Navigation persistence
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
      cy.wait(5000);

      cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist');
      DatabaseViewSelectors.viewTab().should('have.length.at.least', 1);
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
   * Helper: Expand database container in sidebar
   */
  const expandDatabaseInSidebar = () => {
    PageSelectors.itemByName('New Database', { timeout: 10000 }).then(($dbItem) => {
      const expandToggle = $dbItem.find('[data-testid="outline-toggle-expand"]');
      if (expandToggle.length > 0) {
        cy.wrap(expandToggle.first()).click({ force: true });
        waitForReactUpdate(500);
      }
    });
  };

  /**
   * Helper: Add a view via the + button
   */
  const addViewViaButton = (viewType: 'Board' | 'Calendar') => {
    DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
    waitForReactUpdate(300);

    cy.get('[role="menu"], [role="menuitem"]', { timeout: 5000 })
      .should('be.visible')
      .contains(viewType)
      .click({ force: true });
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

  /**
   * Test: Creates multiple views and verifies immediate appearance
   *
   * Regression test: Previously views wouldn't appear until folder synced (3+ seconds).
   * Now views from Yjs should appear immediately.
   */
  it('creates multiple views that appear immediately in tab bar and sidebar', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Multiple views creation - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();
    createGridAndWait(authUtils, testEmail).then(() => {
      // Get initial tab count
      DatabaseViewSelectors.viewTab().then(($tabs) => {
        cy.wrap($tabs.length).as('initialTabCount');
      });

      // Add Board view - verify IMMEDIATE appearance (within 1s)
      cy.task('log', '[STEP 1] Adding Board view');
      addViewViaButton('Board');

      cy.task('log', '[STEP 2] Verifying Board tab appears immediately');
      waitForReactUpdate(200);
      cy.get('@initialTabCount').then((initialCount) => {
        cy.get('[data-testid^="view-tab-"]', { timeout: 1000 }).should(
          'have.length',
          (initialCount as number) + 1
        );
      });

      // Verify Board tab is active
      cy.get('[data-testid^="view-tab-"][data-state="active"]').should('contain.text', 'Board');

      // Add Calendar view - verify IMMEDIATE appearance
      cy.task('log', '[STEP 3] Adding Calendar view');
      addViewViaButton('Calendar');

      cy.task('log', '[STEP 4] Verifying Calendar tab appears immediately');
      cy.get('@initialTabCount').then((initialCount) => {
        cy.get('[data-testid^="view-tab-"]', { timeout: 500 }).should(
          'have.length',
          (initialCount as number) + 2
        );
      });

      // Verify sidebar shows all views
      cy.task('log', '[STEP 5] Verifying sidebar shows all views');
      ensureSpaceExpanded(spaceName);
      waitForReactUpdate(500);
      expandDatabaseInSidebar();

      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        cy.contains('Grid').should('exist');
        cy.contains('Board').should('exist');
        cy.contains('Calendar').should('exist');
      });

      // Verify tab bar matches
      DatabaseViewSelectors.viewTab().contains('Grid').should('exist');
      DatabaseViewSelectors.viewTab().contains('Board').should('exist');
      DatabaseViewSelectors.viewTab().contains('Calendar').should('exist');

      // Navigate away and back to verify persistence
      cy.task('log', '[STEP 6] Navigating away and back');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(2000);

      ensureSpaceExpanded(spaceName);
      PageSelectors.itemByName('New Database', { timeout: 10000 }).first().click({ force: true });
      waitForReactUpdate(3000);

      // Verify all tabs persist
      cy.task('log', '[STEP 7] Verifying all tabs persist');
      cy.get('@initialTabCount').then((initialCount) => {
        DatabaseViewSelectors.viewTab().should('have.length', (initialCount as number) + 2);
      });

      cy.task('log', '[TEST COMPLETE] Multiple views created and persisted');
    });
  });

  /**
   * Test: Renames views correctly and syncs with sidebar
   */
  it('renames views correctly', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Rename views - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();
    createGridAndWait(authUtils, testEmail).then(() => {
      // Rename Grid -> MyGrid
      cy.task('log', '[STEP 1] Renaming Grid to MyGrid');
      openTabMenuByLabel('Grid');
      DatabaseViewSelectors.tabActionRename().should('be.visible').click({ force: true });
      ModalSelectors.renameInput().should('be.visible').clear().type('MyGrid');
      ModalSelectors.renameSaveButton().click({ force: true });
      waitForReactUpdate(1000);
      cy.contains('[data-testid^="view-tab-"]', 'MyGrid', { timeout: 10000 }).should('exist');

      // Add a Board view
      cy.task('log', '[STEP 2] Adding Board view');
      addViewViaButton('Board');
      waitForReactUpdate(2000);

      // Rename Board -> MyBoard
      cy.task('log', '[STEP 3] Renaming Board to MyBoard');
      openTabMenuByLabel('Board');
      DatabaseViewSelectors.tabActionRename().should('be.visible').click({ force: true });
      ModalSelectors.renameInput().should('be.visible').clear().type('MyBoard');
      ModalSelectors.renameSaveButton().click({ force: true });
      waitForReactUpdate(1000);
      cy.contains('[data-testid^="view-tab-"]', 'MyBoard', { timeout: 10000 }).should('exist');

      // Verify both renamed tabs exist
      cy.task('log', '[STEP 4] Verifying renamed tabs exist');
      DatabaseViewSelectors.viewTab().should('have.length', 2);
      cy.contains('[data-testid^="view-tab-"]', 'MyGrid').should('exist');
      cy.contains('[data-testid^="view-tab-"]', 'MyBoard').should('exist');

      cy.task('log', '[TEST COMPLETE] Views renamed successfully');
    });
  });

  /**
   * Test: Tab selection updates sidebar selection
   */
  it('tab selection updates sidebar selection', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Tab selection - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();
    createGridAndWait(authUtils, testEmail).then(() => {
      // Add a Board view
      addViewViaButton('Board');
      waitForReactUpdate(3000);

      // Expand database in sidebar
      ensureSpaceExpanded(spaceName);
      waitForReactUpdate(500);
      expandDatabaseInSidebar();

      // Click on Grid tab
      cy.task('log', '[STEP 1] Clicking Grid tab');
      DatabaseViewSelectors.viewTab().contains('Grid').click({ force: true });
      waitForReactUpdate(1000);

      // Verify Grid is selected in sidebar
      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        cy.get('[data-selected="true"]').should('contain.text', 'Grid');
      });

      // Click on Board tab
      cy.task('log', '[STEP 2] Clicking Board tab');
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
   * Test: Breadcrumb shows active database tab view
   */
  it('breadcrumb shows active database tab view', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Breadcrumb reflects active tab - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();
    createGridAndWait(authUtils, testEmail).then(() => {
      // Add a Board view
      addViewViaButton('Board');
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
});
