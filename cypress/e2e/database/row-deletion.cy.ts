import {
  AddPageSelectors,
  DatabaseGridSelectors,
  RowControlsSelectors,
  waitForReactUpdate
} from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

describe('Database Row Deletion', () => {
  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should delete a row from the grid', () => {
    let testEmail: string;
    const testContent = `Test Row ${Date.now()}`;

    cy.log(`[TEST START] Testing row deletion`);

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

      // Get initial row count
      cy.log('[STEP 9] Getting initial row count');
      DatabaseGridSelectors.rows().then($rows => {
        const initialRowCount = $rows.length;
        cy.log(`[STEP 9.1] Initial row count: ${initialRowCount}`);

        // Now hover over the first row to show controls
        cy.log('[STEP 10] Hovering over first row to show controls');

        // Get the first row and hover over it
        DatabaseGridSelectors.firstRow()
          .parent()
          .parent()
          .trigger('mouseenter', { force: true })
          .trigger('mouseover', { force: true });

        cy.wait(1000);

        // Click on the drag icon/row accessory button
        cy.log('[STEP 11] Looking for and clicking row accessory button');

        RowControlsSelectors.rowAccessoryButton().then($button => {
          if ($button.length > 0) {
            cy.log('[STEP 11.1] Found row accessory button with data-testid');
            cy.wrap($button.first()).click({ force: true });
          } else {
            cy.log('[STEP 11.1] Looking for drag icon by class');
            cy.get('div[class*="cursor-pointer"]').first().click({ force: true });
          }
        });

        cy.wait(1000);

        // Now the dropdown menu should be open
        cy.log('[STEP 12] Looking for delete option in dropdown menu');

        // Wait for the dropdown menu to be visible
        cy.get('[role="menu"], [data-slot="dropdown-menu-content"]').should('be.visible');

        // Click on the delete option
        RowControlsSelectors.rowMenuDelete().then($delete => {
          if ($delete.length > 0) {
            cy.log('[STEP 12.1] Found delete menu item by data-testid');
            cy.wrap($delete).click();
          } else {
            cy.log('[STEP 12.1] Looking for delete by text');
            // Look for delete option by text
            cy.get('[role="menuitem"]').contains(/delete/i).click();
          }
        });

        cy.wait(1000);

        // Handle the confirmation dialog
        cy.log('[STEP 13] Handling deletion confirmation dialog');

        // Click the confirm button
        RowControlsSelectors.deleteRowConfirmButton().then($confirm => {
          if ($confirm.length > 0) {
            cy.log('[STEP 13.1] Found delete confirmation button by data-testid');
            cy.wrap($confirm).click();
          } else {
            cy.log('[STEP 13.1] Looking for delete confirmation by button text');
            // Look for a button with text "Delete" or similar
            cy.get('button').contains(/delete/i).click();
          }
        });

        cy.wait(2000);

        // Verify the row was deleted
        cy.log('[STEP 14] Verifying row was deleted');
        
        // Check that we now have fewer rows
        DatabaseGridSelectors.rows().should('have.length', initialRowCount - 1);

        // Verify the content is gone
        cy.log('[STEP 15] Verifying deleted content is gone');
        DatabaseGridSelectors.cells().then($allCells => {
          let foundContent = false;
          
          $allCells.each((index, cell) => {
            const text = Cypress.$(cell).text();
            if (text.includes(testContent)) {
              foundContent = true;
              cy.log(`[STEP 15.1] ERROR: Found deleted content at index ${index}`);
            }
          });
          
          // The content should be gone
          expect(foundContent).to.be.false;
        });

        cy.log('[STEP 16] Row deletion test completed successfully');
      });
    });
  });
});