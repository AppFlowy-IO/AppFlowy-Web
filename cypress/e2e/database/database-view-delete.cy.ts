import {
  DatabaseViewSelectors,
  PageSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { generateRandomEmail } from '../../support/test-config';
import { expandSpaceByName } from '../../support/page-utils';

/**
 * Database View Deletion Tests
 *
 * Tests for deleting database views:
 * - Deleting a non-last view via the tab context menu
 * - After deletion, another view becomes active
 * - The last view cannot be deleted (delete option hidden or disabled)
 *
 * Bug context: Previously, deleting a database view would fail with
 * "unable to find space corresponds to {view_id}" because the backend
 * moveToTrash API couldn't resolve the space for the database view.
 */
describe('Database View Deletion', () => {
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
  const createGridAndWait = (testEmail: string) => {
    return signInAndCreateDatabaseView(testEmail, 'Grid', {
      verify: () => {
        cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist');
        DatabaseViewSelectors.viewTab().should('have.length.at.least', 1);
      },
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
   * Helper: Open tab context menu by label using pointerdown (right-click)
   */
  const openTabMenuByLabel = (label: string) => {
    cy.contains('[data-testid^="view-tab-"] span', label, { timeout: 10000 })
      .should('be.visible')
      .trigger('pointerdown', { button: 2, pointerType: 'mouse', force: true });
    waitForReactUpdate(500);
  };

  /**
   * Helper: Delete a view via context menu and confirm
   */
  const deleteViewByLabel = (label: string) => {
    openTabMenuByLabel(label);
    DatabaseViewSelectors.tabActionDelete().should('be.visible').click({ force: true });
    waitForReactUpdate(500);

    // Confirm deletion in the dialog
    DatabaseViewSelectors.deleteViewConfirmButton()
      .should('be.visible')
      .click({ force: true });
    waitForReactUpdate(2000);
  };

  /**
   * Helper: Expand database container in sidebar
   */
  const expandDatabaseInSidebar = (dbName: string) => {
    PageSelectors.itemByName(dbName, { timeout: 10000 }).then(($dbItem) => {
      const expandToggle = $dbItem.find('[data-testid="outline-toggle-expand"]');

      if (expandToggle.length > 0) {
        cy.wrap(expandToggle[0]).click({ force: true });
        waitForReactUpdate(500);
      }
    });
  };

  /**
   * Test: Delete a database view and verify it's removed
   *
   * Steps:
   * 1. Create a Grid database
   * 2. Add a Board view (now 2 tabs: Grid + Board)
   * 3. Delete the Board view via context menu
   * 4. Verify only Grid tab remains
   * 5. Verify Grid becomes the active tab
   */
  it('deletes a database view and switches to remaining view', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Delete database view - Email: ${testEmail}`);

    createGridAndWait(testEmail).then(() => {
      // Add Board view
      cy.task('log', '[STEP 1] Adding Board view');
      addViewViaButton('Board');
      waitForReactUpdate(3000);
      cy.contains('[data-testid^="view-tab-"]', 'Board', { timeout: 10000 }).should('exist');
      DatabaseViewSelectors.viewTab().should('have.length', 2);

      // Delete the Board view
      cy.task('log', '[STEP 2] Deleting Board view');
      deleteViewByLabel('Board');

      // Verify Board tab is gone and only Grid remains
      cy.task('log', '[STEP 3] Verifying Board tab removed');
      DatabaseViewSelectors.viewTab().should('have.length', 1);
      cy.contains('[data-testid^="view-tab-"]', 'Board').should('not.exist');
      cy.contains('[data-testid^="view-tab-"]', 'Grid').should('exist');

      // Verify Grid is now the active tab
      DatabaseViewSelectors.activeViewTab().should('contain.text', 'Grid');

      cy.task('log', '[TEST COMPLETE] Database view deletion successful');
    });
  });

  /**
   * Test: Delete the currently active view
   *
   * Steps:
   * 1. Create a Grid database
   * 2. Add a Board view (switches to Board as active)
   * 3. Delete the active Board view
   * 4. Verify Grid becomes active and Board is gone
   */
  it('deletes the currently active view and falls back to another', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Delete active view - Email: ${testEmail}`);

    createGridAndWait(testEmail).then(() => {
      // Add Board view (this makes Board the active tab)
      cy.task('log', '[STEP 1] Adding Board view');
      addViewViaButton('Board');
      waitForReactUpdate(3000);
      DatabaseViewSelectors.activeViewTab().should('contain.text', 'Board');

      // Delete the active Board view
      cy.task('log', '[STEP 2] Deleting active Board view');
      deleteViewByLabel('Board');

      // Verify Board is gone and Grid is now active
      cy.task('log', '[STEP 3] Verifying fallback to Grid');
      DatabaseViewSelectors.viewTab().should('have.length', 1);
      cy.contains('[data-testid^="view-tab-"]', 'Board').should('not.exist');
      DatabaseViewSelectors.activeViewTab().should('contain.text', 'Grid');

      // Verify database still renders correctly
      cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist');

      cy.task('log', '[TEST COMPLETE] Active view deletion with fallback successful');
    });
  });

  /**
   * Test: Delete one of three views, remaining two persist
   *
   * Steps:
   * 1. Create a Grid database
   * 2. Add Board and Calendar views (3 tabs total)
   * 3. Delete the Board view (middle tab)
   * 4. Verify Grid and Calendar remain
   * 5. Verify sidebar reflects the change
   */
  it('deletes one view from three and remaining views persist', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Delete one of three views - Email: ${testEmail}`);

    createGridAndWait(testEmail).then(() => {
      // Add Board and Calendar views
      cy.task('log', '[STEP 1] Adding Board view');
      addViewViaButton('Board');
      waitForReactUpdate(3000);

      cy.task('log', '[STEP 2] Adding Calendar view');
      addViewViaButton('Calendar');
      waitForReactUpdate(3000);

      DatabaseViewSelectors.viewTab().should('have.length', 3);

      // Delete the Board view
      cy.task('log', '[STEP 3] Deleting Board view');
      deleteViewByLabel('Board');

      // Verify only Grid and Calendar remain
      cy.task('log', '[STEP 4] Verifying remaining tabs');
      DatabaseViewSelectors.viewTab().should('have.length', 2);
      cy.contains('[data-testid^="view-tab-"]', 'Board').should('not.exist');
      cy.contains('[data-testid^="view-tab-"]', 'Grid').should('exist');
      cy.contains('[data-testid^="view-tab-"]', 'Calendar').should('exist');

      // Verify sidebar reflects the change
      cy.task('log', '[STEP 5] Verifying sidebar');
      expandSpaceByName(spaceName);
      waitForReactUpdate(500);
      expandDatabaseInSidebar('New Database');

      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        cy.contains('Grid').should('exist');
        cy.contains('Calendar').should('exist');
        cy.contains('Board').should('not.exist');
      });

      cy.task('log', '[TEST COMPLETE] Delete one of three views successful');
    });
  });

  /**
   * Test: Last view delete option is disabled
   *
   * Steps:
   * 1. Create a Grid database (single view)
   * 2. Open context menu on Grid tab
   * 3. Verify delete option is disabled
   */
  it('does not allow deleting the last remaining view', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Cannot delete last view - Email: ${testEmail}`);

    createGridAndWait(testEmail).then(() => {
      // Verify only one tab exists
      DatabaseViewSelectors.viewTab().should('have.length', 1);

      // Open context menu on the single Grid tab
      cy.task('log', '[STEP 1] Opening context menu on last view');
      openTabMenuByLabel('Grid');

      // Verify delete option is disabled (rendered but not interactive)
      cy.task('log', '[STEP 2] Verifying delete option is disabled');
      cy.get('[data-testid="database-view-action-delete"]')
        .should('exist')
        .and('have.attr', 'data-disabled');

      cy.task('log', '[TEST COMPLETE] Last view delete prevention verified');
    });
  });
});
