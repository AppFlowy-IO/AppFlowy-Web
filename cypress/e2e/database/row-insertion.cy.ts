import {
  AddPageSelectors,
  DatabaseGridSelectors,
  RowControlsSelectors,
  waitForReactUpdate
} from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

describe('Database Row Insertion', () => {
  let testEmail: string;

  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should insert rows above and below existing row', () => {
    const originalContent = `Original Row ${Date.now()}`;
    const aboveContent = `Above Row ${Date.now()}`;
    const belowContent = `Below Row ${Date.now()}`;

    cy.log(`[TEST START] Testing row insertion above and below`);

    // Login
    cy.log('[STEP 1] Starting authentication');
    cy.loginTestUser().then((email) => {
      testEmail = email;
      cy.log('[STEP 2] Authentication successful');

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
        cy.focused().type(originalContent);
        cy.focused().type('{enter}');
        waitForReactUpdate(1000);

        // Verify data was entered
        cy.log('[STEP 8] Verifying content was added');
        cy.wrap($cells.first()).should('contain.text', originalContent);
      });

      // Get initial row count
      cy.log('[STEP 9] Getting initial row count');
      DatabaseGridSelectors.rows().then($rows => {
        const initialRowCount = $rows.length;
        cy.log(`[STEP 9.1] Initial row count: ${initialRowCount}`);

        // Insert a row above
        cy.log('[STEP 10] Inserting row above');

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
        cy.log('[STEP 12] Looking for insert above option in dropdown menu');

        // Wait for the dropdown menu to be visible
        cy.get('[role="menu"], [data-slot="dropdown-menu-content"]').should('be.visible');

        // Click on the insert above option - using data-testid first
        RowControlsSelectors.rowMenuInsertAbove().then($insertAbove => {
          if ($insertAbove.length > 0) {
            cy.log('[STEP 12.1] Found insert above menu item by data-testid');
            cy.wrap($insertAbove).click();
          } else {
            cy.log('[STEP 12.1] Looking for insert above by position');
            // First menu item is typically insert above
            cy.get('[role="menuitem"]').first().click();
          }
        });

        cy.wait(2000);

        // Verify a new row was added
        cy.log('[STEP 13] Verifying row was inserted above');
        DatabaseGridSelectors.rows().should('have.length', initialRowCount + 1);

        // Add content to the newly inserted row (which should be the first row now)
        cy.log('[STEP 14] Adding content to newly inserted row above');
        DatabaseGridSelectors.cells().first().click();
        waitForReactUpdate(500);
        cy.focused().type(aboveContent);
        cy.focused().type('{enter}');
        waitForReactUpdate(1000);

        // Now insert a row below the original row (which is now the second row)
        cy.log('[STEP 15] Inserting row below original row');

        // Get the second row and hover over it
        DatabaseGridSelectors.rows().eq(1)
          .parent()
          .parent()
          .trigger('mouseenter', { force: true })
          .trigger('mouseover', { force: true });

        cy.wait(1000);

        // Click on the drag icon/row accessory button again
        cy.log('[STEP 16] Looking for and clicking row accessory button for second row');

        // The row controls should appear for the second row after hovering
        RowControlsSelectors.rowAccessoryButton().then($buttons => {
          if ($buttons.length > 0) {
            cy.log('[STEP 16.1] Found row accessory button');
            // Click the last visible button (should be for the hovered row)
            cy.wrap($buttons.last()).click({ force: true });
          } else {
            cy.log('[STEP 16.1] Looking for drag icon by class');
            cy.get('div[class*="cursor-pointer"]').last().click({ force: true });
          }
        });

        cy.wait(1000);

        // Now the dropdown menu should be open
        cy.log('[STEP 17] Looking for insert below option in dropdown menu');

        // Wait for the dropdown menu to be visible
        cy.get('[role="menu"], [data-slot="dropdown-menu-content"]').should('be.visible');

        // Click on the insert below option - using data-testid first
        RowControlsSelectors.rowMenuInsertBelow().then($insertBelow => {
          if ($insertBelow.length > 0) {
            cy.log('[STEP 17.1] Found insert below menu item by data-testid');
            cy.wrap($insertBelow).click();
          } else {
            cy.log('[STEP 17.1] Looking for insert below by position');
            // Second menu item is typically insert below
            cy.get('[role="menuitem"]').eq(1).click();
          }
        });

        cy.wait(2000);

        // Verify another new row was added
        cy.log('[STEP 18] Verifying row was inserted below');
        DatabaseGridSelectors.rows().should('have.length', initialRowCount + 2);

        // Add content to the newly inserted row below (should be the third row)
        cy.log('[STEP 19] Adding content to newly inserted row below');
        DatabaseGridSelectors.rows().eq(2).within(() => {
          DatabaseGridSelectors.cells().first().click();
        });
        waitForReactUpdate(500);
        cy.focused().type(belowContent);
        cy.focused().type('{enter}');
        waitForReactUpdate(1000);

        // Final verification - check all cells have the correct content
        cy.log('[STEP 20] Final verification of content');
        DatabaseGridSelectors.cells().then($allCells => {
          // Find cells that contain our test content
          let foundAbove = false;
          let foundOriginal = false;
          let foundBelow = false;

          $allCells.each((index, cell) => {
            const text = Cypress.$(cell).text();
            if (text.includes(aboveContent)) {
              foundAbove = true;
              cy.log(`[STEP 20.1] Found above content at index ${index}`);
            }
            if (text.includes(originalContent)) {
              foundOriginal = true;
              cy.log(`[STEP 20.2] Found original content at index ${index}`);
            }
            if (text.includes(belowContent)) {
              foundBelow = true;
              cy.log(`[STEP 20.3] Found below content at index ${index}`);
            }
          });

          // Verify all content was found
          expect(foundAbove).to.be.true;
          expect(foundOriginal).to.be.true;
          expect(foundBelow).to.be.true;
        });

        cy.log('[STEP 21] Row insertion test completed successfully');
      });
    });
  });
});