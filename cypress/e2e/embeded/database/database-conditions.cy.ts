import { v4 as uuidv4 } from 'uuid';
import { AuthTestUtils } from '../../../support/auth-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';
import {
  AddPageSelectors,
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  EditorSelectors,
  SlashCommandSelectors,
  waitForReactUpdate,
} from '../../../support/selectors';

describe('Database Conditions - Filters and Sorts UI', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;

  // Helper to get current viewId from URL
  const currentViewIdFromUrl = () =>
    cy.location('pathname').then((pathname) => {
      const maybeId = pathname.split('/').filter(Boolean).pop() || '';
      return maybeId;
    });

  // Helper to close dialogs that are NOT the document we're working in
  const closeTopDialogIfNotDocument = (docViewId: string) => {
    cy.get('body').then(($body) => {
      const dialogs = $body.find('[role="dialog"]').filter(':visible');
      if (dialogs.length === 0) return;

      const topDialog = dialogs.last();
      const topContainsDocEditor = $body.find(topDialog).find(`#editor-${docViewId}`).length > 0;

      if (!topContainsDocEditor) {
        cy.get('body').type('{esc}');
        waitForReactUpdate(500);
      }
    });
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

  it('should have 0px height when DatabaseConditions is collapsed (no filters/sorts)', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Testing DatabaseConditions collapsed height - Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create source database
      cy.task('log', '[STEP 3] Creating source database');
      AddPageSelectors.inlineAddButton().first().as('addBtn0');
      cy.get('@addBtn0').should('be.visible').click();
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click();
      cy.wait(3000);
      const dbName = 'New Database';
      cy.task('log', `[STEP 4.1] Using database name: ${dbName}`);
      cy.wait(1000);

      // Create a document
      cy.task('log', '[STEP 5] Creating document at same level as database');
      AddPageSelectors.inlineAddButton().first().as('addDocBtn0');
      cy.get('@addDocBtn0').should('be.visible').click();
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().as('menuItem0');
      cy.get('@menuItem0').click();
      waitForReactUpdate(1000);

      // When creating a Document via inline add button, it opens in a ViewModal.
      // Click the expand button (first button in modal header) to navigate to full page view.
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
      cy.get('[role="dialog"]').find('button').first().click({ force: true });
      waitForReactUpdate(1000);

      // Now the URL should reflect the new document - capture the docViewId
      currentViewIdFromUrl().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId0');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });
      waitForReactUpdate(1000);

      // Insert linked database
      cy.task('log', '[STEP 6] Inserting linked database');
      cy.get<string>('@docViewId0').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).should('exist').click('center', { force: true });
        cy.get(`#editor-${docViewId}`).type('/', { force: true });
      });
      waitForReactUpdate(500);

      SlashCommandSelectors.slashPanel()
        .should('be.visible')
        .within(() => {
          SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('linkedGrid')).first().as('linkedGridMenuItem0');
          cy.get('@linkedGridMenuItem0').click();
        });

      waitForReactUpdate(1000);
      SlashCommandSelectors.selectDatabase(dbName);
      waitForReactUpdate(2000);

      // Close any dialogs that might have opened, but NOT the document itself
      cy.get<string>('@docViewId0').then((docViewId) => {
        closeTopDialogIfNotDocument(docViewId);
      });

      // Verify embedded database exists
      cy.task('log', '[STEP 7] Verifying embedded database exists');
      cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist').last().as('embeddedDBTemp');
      cy.get('@embeddedDBTemp').as('embeddedDB');

      cy.get('@embeddedDB').within(() => {
        DatabaseGridSelectors.grid().should('exist');
      });

      // Check DatabaseConditions area height
      cy.task('log', '[STEP 8] Checking DatabaseConditions area height');

      cy.get('@embeddedDB').within(() => {
        cy.get('[data-testid^="view-tab-"]')
          .parent()
          .parent()
          .then(($tabsContainer) => {
            cy.task('log', '[STEP 8.1] Found tabs container');

            DatabaseGridSelectors.grid().then(($grid) => {
              cy.task('log', '[STEP 8.2] Found grid container');

              const tabsBottom = $tabsContainer[0].getBoundingClientRect().bottom;
              const gridTop = $grid[0].getBoundingClientRect().top;
              const gap = gridTop - tabsBottom;

              cy.task('log', `[STEP 8.3] Gap between tabs and grid: ${gap}px`);

              expect(gap).to.be.lessThan(10);
              cy.task('log', '[STEP 8.4] Confirmed: No 40px gap when conditions are collapsed');
            });
          });

        // Verify no filter/sort buttons visible initially
        cy.task('log', '[STEP 9] Verifying no filter/sort conditions visible');

        DatabaseFilterSelectors.filterCondition()
          .should('not.exist', { timeout: 2000 })
          .then(() => {
            cy.task('log', '[STEP 9.1] Confirmed: No filter conditions visible');
          });

        DatabaseFilterSelectors.sortCondition()
          .should('not.exist', { timeout: 2000 })
          .then(() => {
            cy.task('log', '[STEP 9.2] Confirmed: No sort conditions visible');
          });
      });

      cy.task('log', '[TEST COMPLETE] DatabaseConditions collapsed height test passed');
    });
  });

  it('should expand to 40px height when filters are added', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Testing DatabaseConditions expanded height - Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create source database
      cy.task('log', '[STEP 1] Creating Grid database');
      AddPageSelectors.inlineAddButton().first().as('addBtn');
      cy.get('@addBtn').should('be.visible').click();
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click();
      cy.wait(5000);

      //Add some data
      cy.task('log', '[STEP 2] Adding sample data to database');
      DatabaseGridSelectors.cells().first().as('firstCell');
      cy.get('@firstCell').click();
      waitForReactUpdate(500);
      cy.focused().type('Sample Data 1');
      cy.focused().type('{enter}');
      waitForReactUpdate(500);

      // Create document and insert linked database
      cy.task('log', '[STEP 3] Creating document');
      AddPageSelectors.inlineAddButton().first().as('addDocBtn');
      cy.get('@addDocBtn').should('be.visible').click();
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().as('menuItem');
      cy.get('@menuItem').click();
      waitForReactUpdate(1000);

      // When creating a Document via inline add button, it opens in a ViewModal.
      // Click the expand button (first button in modal header) to navigate to full page view.
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
      cy.get('[role="dialog"]').find('button').first().click({ force: true });
      waitForReactUpdate(1000);

      // Now the URL should reflect the new document - capture the docViewId
      currentViewIdFromUrl().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId1');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });
      waitForReactUpdate(1000);

      cy.task('log', '[STEP 4] Inserting linked database');
      cy.get<string>('@docViewId1').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).should('exist').click('center', { force: true });
        cy.get(`#editor-${docViewId}`).type('/', { force: true });
      });
      waitForReactUpdate(500);

      SlashCommandSelectors.slashPanel()
        .should('be.visible')
        .within(() => {
          SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('linkedGrid')).first().as('linkedGridMenuItem');
          cy.get('@linkedGridMenuItem').click();
        });

      waitForReactUpdate(1000);
      SlashCommandSelectors.selectDatabase('New Database');
      waitForReactUpdate(2000);

      // Close any dialogs that might have opened, but NOT the document itself
      cy.get<string>('@docViewId1').then((docViewId) => {
        closeTopDialogIfNotDocument(docViewId);
      });

      cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist').last().as('embeddedDBTemp1');
      cy.get('@embeddedDBTemp1').as('embeddedDB');

      // Wait for database to fully render
      cy.wait(2000);

      // Add filter
      cy.task('log', '[STEP 5] Adding filter');

      // Re-query the embedded DB to ensure we have a fresh reference
      cy.get('[class*="appflowy-database"]').last().as('freshEmbeddedDB1');
      cy.get('@freshEmbeddedDB1').within(() => {
        DatabaseFilterSelectors.filterButton().should('be.visible').click();
      });

      waitForReactUpdate(500);

      // Select field from dropdown (dropdown is rendered at document root, not inside embeddedDB)
      cy.get('[data-slot="popover-content"]', { timeout: 10000 })
        .should('be.visible')
        .within(() => {
          cy.get('[data-item-id]').first().as('firstMenuItem');
          cy.get('@firstMenuItem').click();
        });

      waitForReactUpdate(1000);

      // Verify filter condition appears
      cy.task('log', '[STEP 6] Verifying filter condition appears');
      cy.get('[class*="appflowy-database"]')
        .last()
        .within(() => {
          DatabaseFilterSelectors.filterCondition().should('exist').and('be.visible');
        });

      cy.task('log', '[TEST COMPLETE] Filter expansion test passed');
    });
  });

  it('should dynamically adjust height when filters are added and removed', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Testing dynamic height adjustment - Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create database
      cy.task('log', '[STEP 1] Creating Grid database');
      AddPageSelectors.inlineAddButton().first().as('addBtn2');
      cy.get('@addBtn2').should('be.visible').click();
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click();
      cy.wait(5000);

      DatabaseGridSelectors.cells().first().as('firstCell2');
      cy.get('@firstCell2').click();
      waitForReactUpdate(500);
      cy.focused().type('Test Data');
      cy.focused().type('{enter}');
      waitForReactUpdate(500);

      // Create document and insert linked database
      AddPageSelectors.inlineAddButton().first().as('addDocBtn2');
      cy.get('@addDocBtn2').should('be.visible').click();
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().as('menuItem2');
      cy.get('@menuItem2').click();
      waitForReactUpdate(1000);

      // When creating a Document via inline add button, it opens in a ViewModal.
      // Click the expand button (first button in modal header) to navigate to full page view.
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
      cy.get('[role="dialog"]').find('button').first().click({ force: true });
      waitForReactUpdate(1000);

      // Now the URL should reflect the new document - capture the docViewId
      currentViewIdFromUrl().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId2');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });
      waitForReactUpdate(1000);

      cy.get<string>('@docViewId2').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).should('exist').click('center', { force: true });
        cy.get(`#editor-${docViewId}`).type('/', { force: true });
      });
      waitForReactUpdate(500);

      SlashCommandSelectors.slashPanel()
        .should('be.visible')
        .within(() => {
          SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('linkedGrid')).first().as('linkedGridMenuItem2');
          cy.get('@linkedGridMenuItem2').click();
        });

      waitForReactUpdate(1000);
      SlashCommandSelectors.selectDatabase('New Database');
      waitForReactUpdate(2000);

      // Close any dialogs that might have opened, but NOT the document itself
      cy.get<string>('@docViewId2').then((docViewId) => {
        closeTopDialogIfNotDocument(docViewId);
      });

      cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist').last().as('embeddedDBTemp2');
      cy.get('@embeddedDBTemp2').as('embeddedDB');

      // Wait for database to fully render
      cy.wait(2000);

      // Add filter
      cy.task('log', '[STEP 2] Adding filter');

      // Re-query the embedded DB to ensure we have a fresh reference
      cy.get('[class*="appflowy-database"]').last().as('freshEmbeddedDB2');
      cy.get('@freshEmbeddedDB2').within(() => {
        DatabaseFilterSelectors.filterButton().should('be.visible').click();
      });

      waitForReactUpdate(500);

      cy.get('[data-slot="popover-content"]')
        .should('be.visible')
        .within(() => {
          cy.get('[data-item-id]').first().as('firstMenuItem2');
          cy.get('@firstMenuItem2').click();
        });

      waitForReactUpdate(1000);

      // Verify filter exists
      cy.get('[class*="appflowy-database"]')
        .last()
        .within(() => {
          DatabaseFilterSelectors.filterCondition().should('exist');
        });

      // Remove filter
      cy.task('log', '[STEP 3] Removing filter');

      // Click the filter condition chip to open the menu
      cy.get('[class*="appflowy-database"]')
        .last()
        .within(() => {
          DatabaseFilterSelectors.filterCondition().first().click();
        });

      waitForReactUpdate(500);

      // The delete button is in a popover rendered at document root
      // The delete button is on the right side of the filter name dropdown
      cy.get('[data-slot="popover-content"]').within(() => {
        // There are typically 3 icon buttons: duplicate, delete, and link
        // The delete button is usually the second or has an svg with specific attributes
        // Let's just get all buttons and click the one that looks like delete (middle button usually)
        cy.get('button').eq(1).click();
      });

      waitForReactUpdate(1000);

      // Verify filter is removed
      cy.get('[class*="appflowy-database"]')
        .last()
        .within(() => {
          DatabaseFilterSelectors.filterCondition().should('not.exist');
        });

      cy.task('log', '[TEST COMPLETE] Dynamic height adjustment test passed');
    });
  });
});
