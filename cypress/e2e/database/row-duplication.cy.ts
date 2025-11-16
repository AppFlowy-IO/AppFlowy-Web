import {
  AddPageSelectors,
  DatabaseGridSelectors,
  RowControlsSelectors,
  waitForReactUpdate
} from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

describe('Database Row Duplication', () => {
  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should create a new grid, add content to first row, and duplicate it', () => {
    let testEmail: string;
    const testContent = `Test Content ${Date.now()}`;

    cy.log(`[TEST START] Testing row duplication`);

    // Login
    cy.log('[STEP 1] Starting authentication');
    cy.loginTestUser().then((email) => {
      testEmail = email;
      cy.log('[STEP 2] Authentication successful');
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create a new grid
      cy.log('[STEP 4] Creating new grid');
      AddPageSelectors.inlineAddButton().first().should('be.visible').click();
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click();
      cy.wait(8000);

      // Verify grid exists
      cy.log('[STEP 5] Verifying grid exists');
      DatabaseGridSelectors.grid().should('exist');

      // Get cells and edit the first one
      cy.log('[STEP 6] Getting cells and editing first cell');
      DatabaseGridSelectors.cells().should('exist');

      DatabaseGridSelectors.cells().then($cells => {
        cy.log(`[STEP 7] Found ${$cells.length} cells`);

        // Click first cell and type content
        cy.wrap($cells.first()).click();
        waitForReactUpdate(500);
        cy.focused().type(testContent);
        cy.focused().type('{enter}');
        waitForReactUpdate(1000);

        // Verify data was entered
        cy.log('[STEP 8] Verifying content was added');
        cy.wrap($cells.first()).should('contain.text', testContent);
      });

      // Now hover over the first row to show controls
      cy.log('[STEP 9] Hovering over first row to show controls');

      // Get the first row and hover over it
      DatabaseGridSelectors.firstRow()
        .parent()
        .parent()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });

      cy.wait(1000);

      // Click on the drag icon/row accessory button
      cy.log('[STEP 10] Looking for and clicking row accessory button');

      // The drag icon should be visible after hovering
      // Try to find it by the data-testid we added or by its class
      RowControlsSelectors.rowAccessoryButton().then($button => {
        if ($button.length > 0) {
          cy.log('[STEP 10.1] Found row accessory button with data-testid');
          cy.wrap($button.first()).click({ force: true });
        } else {
          cy.log('[STEP 10.1] Looking for drag icon by class');
          // Try to find the drag icon button
          cy.get('div[class*="cursor-pointer"]').first().click({ force: true });
        }
      });

      cy.wait(1000);

      // Now the dropdown menu should be open
      cy.log('[STEP 11] Looking for duplicate option in dropdown menu');

      // Wait for the dropdown menu to be visible
      cy.get('[role="menu"], [data-slot="dropdown-menu-content"]').should('be.visible');

      // Click on the duplicate option
      cy.get('[role="menuitem"]').then($items => {
        let found = false;
        $items.each((index, item) => {
          const text = Cypress.$(item).text();
          if (text.includes('Duplicate') || text.includes('duplicate')) {
            cy.log('[STEP 11.1] Found duplicate menu item by text');
            cy.wrap(item).click();
            found = true;
            return false;
          }
        });

        if (!found) {
          // Try clicking by the data-testid we added
          RowControlsSelectors.rowMenuDuplicate().then($duplicate => {
            if ($duplicate.length > 0) {
              cy.log('[STEP 11.2] Found duplicate menu item by data-testid');
              cy.wrap($duplicate).click();
            } else {
              // Fallback: click the third menu item (typically duplicate is after insert above/below)
              cy.log('[STEP 11.3] Clicking third menu item as fallback');
              cy.get('[role="menuitem"]').eq(2).click();
            }
          });
        }
      });

      cy.wait(2000);

      // Verify the row was duplicated
      cy.log('[STEP 12] Verifying row was duplicated');
      DatabaseGridSelectors.rows().should('have.length.at.least', 2);

      // Get all cells again and verify the duplicated content
      cy.log('[STEP 13] Verifying duplicated content');
      DatabaseGridSelectors.cells().then($allCells => {
        // The duplicated row should have the same content
        // Find cells that contain our test content
        let contentCount = 0;
        $allCells.each((index, cell) => {
          if (Cypress.$(cell).text().includes(testContent)) {
            contentCount++;
          }
        });

        cy.log(`[STEP 14] Found ${contentCount} cells with test content`);
        // We should have at least 2 cells with the same content (original and duplicate)
        expect(contentCount).to.be.at.least(2);
      });

      cy.log('[STEP 15] Row duplication test completed successfully');
    });
  });
});