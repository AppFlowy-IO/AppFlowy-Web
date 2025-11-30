import { v4 as uuidv4 } from 'uuid';
import { AuthTestUtils } from '../../../support/auth-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';
import {
  AddPageSelectors,
  EditorSelectors,
  ModalSelectors,
  PageSelectors,
  SlashCommandSelectors,
  SpaceSelectors,
  waitForReactUpdate
} from '../../../support/selectors';

describe('Embedded Database View Isolation', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const dbName = 'New Grid';
  const docName = 'Untitled';
  const spaceName = 'General'; // Default space name

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('useAppHandlers must be used within') ||
        err.message.includes('Cannot resolve a DOM node from Slate') ||
        err.message.includes('ResizeObserver loop')) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  /**
   * Expand a space in the sidebar by clicking on it
   */
  function expandSpaceInSidebar(spaceNameToExpand: string) {
    cy.task('log', `[ACTION] Expanding space "${spaceNameToExpand}" in sidebar`);

    // Check if space is already expanded
    SpaceSelectors.itemByName(spaceNameToExpand).then($space => {
      const expandedIndicator = $space.find('[data-testid="space-expanded"]');
      const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

      if (!isExpanded) {
        cy.task('log', `[ACTION] Space "${spaceNameToExpand}" is collapsed, clicking to expand`);
        // Click on the space name to expand it
        SpaceSelectors.itemByName(spaceNameToExpand)
          .find('[data-testid="space-name"]')
          .click({ force: true });
        waitForReactUpdate(500);
      } else {
        cy.task('log', `[ACTION] Space "${spaceNameToExpand}" is already expanded`);
      }
    });
  }

  /**
   * Expand a page in the sidebar to show its children
   */
  function expandPageInSidebar(pageName: string) {
    cy.task('log', `[ACTION] Expanding page "${pageName}" in sidebar`);
    PageSelectors.itemByName(pageName)
      .find('[data-testid="outline-toggle-expand"]')
      .first()
      .click({ force: true });
    waitForReactUpdate(500);
  }

  /**
   * Check if a page has the expand toggle (indicating it has or can have children)
   */
  function assertPageHasExpandToggle(pageName: string) {
    cy.task('log', `[ASSERT] Checking "${pageName}" has expand toggle in sidebar`);
    PageSelectors.itemByName(pageName).within(() => {
      cy.get('[data-testid="outline-toggle-expand"], [data-testid="outline-toggle-collapse"]')
        .should('exist');
    });
  }

  /**
   * Assert that a page has NO expand toggle (no children)
   */
  function assertPageHasNoExpandToggle(pageName: string) {
    cy.task('log', `[ASSERT] Checking "${pageName}" has NO expand toggle in sidebar`);
    PageSelectors.itemByName(pageName).then($pageItem => {
      const hasExpandToggle = $pageItem.find('[data-testid="outline-toggle-expand"], [data-testid="outline-toggle-collapse"]').length > 0;
      cy.task('log', `[ASSERT] "${pageName}" has expand toggle: ${hasExpandToggle}`);
      expect(hasExpandToggle).to.equal(false, `"${pageName}" should NOT have expand toggle (no children)`);
    });
  }

  /**
   * Assert that a page has NO children in the sidebar
   * Children are detected by nested [data-testid="page-item"] elements
   */
  function assertPageHasNoChildren(pageName: string) {
    cy.task('log', `[ASSERT] Checking "${pageName}" has NO children in sidebar`);
    PageSelectors.itemByName(pageName).then($pageItem => {
      const childCount = $pageItem.find('[data-testid="page-item"]').length;
      cy.task('log', `[ASSERT] "${pageName}" has ${childCount} children`);
      expect(childCount).to.equal(0, `"${pageName}" should have no children in sidebar`);
    });
  }

  /**
   * Assert that a page HAS children in the sidebar (after expanding)
   */
  function assertPageHasChildren(pageName: string, expectedMinCount = 1) {
    cy.task('log', `[ASSERT] Checking "${pageName}" HAS children in sidebar`);

    // First log all page names in sidebar for debugging
    PageSelectors.names().then($names => {
      const names = Array.from($names).map(el => Cypress.$(el).text().trim());
      cy.task('log', `[DEBUG] All page names in sidebar: ${JSON.stringify(names)}`);
    });

    PageSelectors.itemByName(pageName).then($pageItem => {
      const childCount = $pageItem.find('[data-testid="page-item"]').length;
      cy.task('log', `[ASSERT] "${pageName}" has ${childCount} children`);

      // Log the HTML structure for debugging
      cy.task('log', `[DEBUG] Page item HTML length: ${$pageItem.html().length}`);

      expect(childCount).to.be.at.least(expectedMinCount, `"${pageName}" should have at least ${expectedMinCount} children in sidebar`);
    });
  }

  /**
   * Assert that a child view exists under a parent in the sidebar
   */
  function assertChildViewExists(parentName: string, childNameContains: string) {
    cy.task('log', `[ASSERT] Checking "${parentName}" has child containing "${childNameContains}"`);
    PageSelectors.itemByName(parentName).within(() => {
      cy.get('[data-testid="page-name"]')
        .contains(childNameContains)
        .should('exist');
    });
  }

  it('should show embedded view as document child, NOT original database child', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Testing embedded view appears as document child - Test email: ${testEmail}`);

    // Step 1: Login
    cy.task('log', '[STEP 1] Visiting login page');
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.task('log', '[STEP 2] Authentication successful');
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 3: Create a standalone Grid database
      cy.task('log', '[STEP 3] Creating standalone Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Step 4: Verify original database has NO children in sidebar
      cy.task('log', '[STEP 4] Verifying original database has NO children');
      assertPageHasNoChildren(dbName);

      // Step 5: Create a new Document page
      cy.task('log', '[STEP 5] Creating new document page');

      // Close any open modals first
      cy.get('body').then(($body) => {
        if ($body.find('[role="dialog"]').length > 0) {
          cy.get('body').type('{esc}');
          cy.wait(500);
        }
      });

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // Handle the new page modal if it appears
      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="new-page-modal"]').length > 0) {
          cy.task('log', '[STEP 5.1] Handling new page modal');
          ModalSelectors.newPageModal().should('be.visible').within(() => {
            ModalSelectors.spaceItemInModal().first().click({ force: true });
            waitForReactUpdate(500);
            cy.contains('button', 'Add').click({ force: true });
          });
        }
      });

      cy.wait(3000);

      // Step 6: Verify document initially has NO children
      cy.task('log', '[STEP 6] Verifying document initially has NO children');
      assertPageHasNoChildren(docName);

      // Step 7: Insert embedded database via slash menu
      cy.task('log', '[STEP 7] Inserting embedded database via slash menu');
      EditorSelectors.firstEditor().should('exist', { timeout: 15000 });
      EditorSelectors.firstEditor().click().type('/');
      waitForReactUpdate(500);

      cy.task('log', '[STEP 7.1] Selecting Linked Grid option');
      SlashCommandSelectors.slashPanel()
        .should('be.visible', { timeout: 5000 })
        .within(() => {
          SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('linkedGrid')).first().click({ force: true });
        });

      waitForReactUpdate(1000);

      cy.task('log', `[STEP 7.2] Selecting database: ${dbName}`);
      SlashCommandSelectors.selectDatabase(dbName);
      waitForReactUpdate(3000);

      // Step 8: Verify embedded database was created successfully
      cy.task('log', '[STEP 8] Verifying embedded database was created successfully');

      // 8.1: Verify no error notification appeared
      cy.task('log', '[STEP 8.1] Checking no error notification appeared');
      cy.get('[data-sonner-toast][data-type="error"]', { timeout: 2000 }).should('not.exist');

      // 8.2: Wait for embedded database container to appear
      cy.task('log', '[STEP 8.2] Waiting for embedded database container');
      cy.get('[class*="appflowy-database"]', { timeout: 15000 })
        .should('exist')
        .last()
        .should('be.visible');

      // 8.3: Verify the embedded view tab shows "View of" prefix (indicates successful creation)
      cy.task('log', '[STEP 8.3] Verifying embedded view has correct name with "View of" prefix');
      cy.get('[role="tab"]', { timeout: 10000 })
        .should('be.visible')
        .and('contain.text', 'View of');

      // 8.4: Verify the grid structure is visible (columns exist)
      cy.task('log', '[STEP 8.4] Verifying grid structure is visible');
      cy.get('[class*="appflowy-database"]').last().within(() => {
        // Check for column headers or grid structure
        cy.get('button').should('have.length.at.least', 1);
      });

      cy.task('log', '[STEP 8.5] Embedded database successfully created and visible');

      // Step 9: KEY SIDEBAR VERIFICATION - Document should have subview, Database should NOT
      cy.task('log', '[STEP 9] Verifying sidebar structure after embedding');
      waitForReactUpdate(2000);

      // 9.0: First expand the space to see pages in sidebar
      cy.task('log', '[STEP 9.0] Expanding space to see pages in sidebar');
      expandSpaceInSidebar(spaceName);
      waitForReactUpdate(1000);

      // 9.1: Verify the document now has an expand toggle (indicating it has children)
      cy.task('log', '[STEP 9.1] Verifying document has expand toggle (has children)');
      assertPageHasExpandToggle(docName);

      // 9.2: Expand the document to see its children
      cy.task('log', '[STEP 9.2] Expanding document to see children');
      expandPageInSidebar(docName);
      waitForReactUpdate(1000);

      // 9.3: Verify the document has children (the embedded view)
      cy.task('log', '[STEP 9.3] Verifying document has children (embedded view)');
      assertPageHasChildren(docName);

      // 9.4: Verify the embedded view shows "View of" prefix in sidebar
      cy.task('log', '[STEP 9.4] Verifying embedded view name contains "View of"');
      assertChildViewExists(docName, 'View of');

      // Step 10: Verify original database STILL has NO children
      // This is the KEY assertion - embedded views should NOT appear as children of the original database
      cy.task('log', '[STEP 10] Verifying original database has NO children (no expand toggle)');
      assertPageHasNoExpandToggle(dbName);
      assertPageHasNoChildren(dbName);

      // Step 11: Create a SECOND view in the embedded database (using + button)
      // This view will also be a child of the document, not the original database
      cy.task('log', '[STEP 11] Creating second view in embedded database using + button');

      // Navigate back to the document first
      cy.task('log', '[STEP 11.1] Navigating back to document');
      PageSelectors.nameContaining(docName).first().click({ force: true });
      waitForReactUpdate(3000);

      // Get the embedded database container
      cy.task('log', '[STEP 11.2] Finding embedded database in document');
      cy.get('[class*="appflowy-database"]', { timeout: 10000 })
        .should('exist')
        .last()
        .as('embeddedDBInDoc');

      // Click the + button to add a new view
      cy.task('log', '[STEP 11.3] Clicking + button to add second view');
      cy.get('@embeddedDBInDoc').find('[data-testid="add-view-button"]')
        .scrollIntoView()
        .click({ force: true });

      waitForReactUpdate(500);

      // Select Board view type from dropdown - wait for menu and click Board option
      cy.task('log', '[STEP 11.4] Selecting Board view type');

      // Wait for the menu to appear and find the Board option within the visible dropdown
      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });

      // Wait for view to be created
      waitForReactUpdate(3000);

      // Step 12: Verify second view was created (now 2 tabs in the embedded database)
      cy.task('log', '[STEP 12] Verifying second view was created (2 tabs)');
      cy.get('@embeddedDBInDoc').within(() => {
        cy.get('[data-testid^="view-tab-"]', { timeout: 10000 })
          .should('have.length', 2);
      });

      // Step 13: Verify document now has TWO children, database still has ZERO
      cy.task('log', '[STEP 13] Verifying document has 2 children, database has 0');
      waitForReactUpdate(2000);

      // Expand space again if needed
      expandSpaceInSidebar(spaceName);
      waitForReactUpdate(500);

      // Expand document to see children
      cy.task('log', '[STEP 13.1] Expanding document to verify children');
      PageSelectors.itemByName(docName).then($docItem => {
        // Check if already expanded by looking for collapse toggle
        const isExpanded = $docItem.find('[data-testid="outline-toggle-collapse"]').length > 0;
        if (!isExpanded) {
          expandPageInSidebar(docName);
          waitForReactUpdate(500);
        }
      });

      cy.task('log', '[STEP 13.2] Verifying document has 2 children');
      assertPageHasChildren(docName, 2);

      cy.task('log', '[STEP 13.3] Verifying database still has NO children');
      assertPageHasNoExpandToggle(dbName);
      assertPageHasNoChildren(dbName);

      // Step 14: Navigate to the original database and create a NEW view directly in it
      cy.task('log', '[STEP 14] Navigating to original database to create a direct view');
      PageSelectors.nameContaining(dbName).first().click({ force: true });
      waitForReactUpdate(3000);

      // Step 15: Create a new view directly in the database using the + button
      cy.task('log', '[STEP 15] Creating new view directly in database');

      // Get the database view and find the add-view-button
      cy.get('[class*="appflowy-database"]', { timeout: 10000 })
        .should('exist')
        .first()
        .as('standaloneDB');

      cy.task('log', '[STEP 15.1] Clicking + button to add view');
      cy.get('@standaloneDB').find('[data-testid="add-view-button"]')
        .scrollIntoView()
        .click({ force: true });

      waitForReactUpdate(500);

      // Select Board view type from dropdown - wait for menu and click Board option
      cy.task('log', '[STEP 15.2] Selecting Board view type');

      // Wait for the menu to appear and find the Board option within the visible dropdown
      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });

      // Wait for view to be created
      waitForReactUpdate(3000);

      // Step 16: Verify database NOW has ONE child (the directly created view)
      cy.task('log', '[STEP 16] Verifying database now has 1 child');

      // Expand space again if needed
      expandSpaceInSidebar(spaceName);
      waitForReactUpdate(500);

      // Database should now have an expand toggle
      cy.task('log', '[STEP 16.1] Verifying database has expand toggle');
      assertPageHasExpandToggle(dbName);

      // Expand database to see its child
      cy.task('log', '[STEP 16.2] Expanding database to see children');
      expandPageInSidebar(dbName);
      waitForReactUpdate(500);

      // Verify database has exactly 1 child
      cy.task('log', '[STEP 16.3] Verifying database has 1 child');
      assertPageHasChildren(dbName, 1);

      // Step 17: Verify document STILL has exactly 2 children (unchanged)
      cy.task('log', '[STEP 17] Verifying document still has 2 children');

      // Expand document if needed
      PageSelectors.itemByName(docName).then($docItem => {
        const isExpanded = $docItem.find('[data-testid="outline-toggle-collapse"]').length > 0;
        if (!isExpanded) {
          expandPageInSidebar(docName);
          waitForReactUpdate(500);
        }
      });

      assertPageHasChildren(docName, 2);

      cy.task('log', '[TEST COMPLETE] Embedded view isolation verified:');
      cy.task('log', '  - Document has 2 children (both embedded views)');
      cy.task('log', '  - Database has 1 child (only the directly created view)');
      cy.task('log', '  - Embedded views do NOT appear as children of their source database');
    });
  });

});
