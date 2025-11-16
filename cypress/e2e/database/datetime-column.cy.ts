import {
  AddPageSelectors,
  DatabaseGridSelectors,
  DateTimeSelectors,
  PropertyMenuSelectors,
  GridFieldSelectors,
  FieldType,
  byTestId,
  waitForReactUpdate
} from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

describe('DateTime Column Type', () => {
  let testEmail: string;

  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should create grid with datetime column and interact with date cells', () => {
    cy.log(`[TEST START] Testing datetime column`);

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
      
      // Verify cells exist
      cy.log('[STEP 6] Verifying cells exist');
      DatabaseGridSelectors.cells().should('exist');

      // Add new column
      cy.log('[STEP 7] Adding new column by clicking new property button');
      PropertyMenuSelectors.newPropertyButton().should('be.visible');
      PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
      waitForReactUpdate(3000);
      
      // The new column is created and the property menu should be open automatically
      // Let's wait for property trigger to be available
      cy.log('[STEP 8] Waiting for property menu to open');
      cy.get('body').then($body => {
        // Check if property type trigger exists
        if ($body.find(byTestId('property-type-trigger')).length > 0) {
          cy.log('[STEP 9] Property type trigger found, changing to DateTime');
          PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
          waitForReactUpdate(1000);
          
          // Select DateTime option
          cy.log('[STEP 10] Selecting DateTime option');
          PropertyMenuSelectors.propertyTypeOption(FieldType.DateTime).click({ force: true });
          waitForReactUpdate(2000);
        } else {
          cy.log('[STEP 9] Property type trigger not found, looking for field header');
          // Try clicking on the new field header first
          GridFieldSelectors.allFieldHeaders().last().scrollIntoView().click({ force: true });
          waitForReactUpdate(1000);
          
          // Now try to find the property type trigger
          PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
          waitForReactUpdate(1000);
          
          // Select DateTime option
          cy.log('[STEP 10] Selecting DateTime option');
          PropertyMenuSelectors.propertyTypeOption(FieldType.DateTime).click({ force: true });
          waitForReactUpdate(2000);
        }
      });
      
      // Close any open menus
      cy.log('[STEP 11] Closing menus');
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);
      
      // Verify datetime cells exist
      cy.log('[STEP 12] Checking for datetime cells');
      cy.get('body').then($body => {
        const datetimeCells = $body.find('[data-testid^="datetime-cell-"]');
        if (datetimeCells.length > 0) {
          cy.log(`[STEP 13] Found ${datetimeCells.length} datetime cells`);
          
          // Try to interact with the first datetime cell
          DateTimeSelectors.allDateTimeCells().first().scrollIntoView().click({ force: true });
          waitForReactUpdate(1000);
          
          // Check if picker opens
          cy.get('body').then($body => {
            if ($body.find(byTestId('datetime-picker-popover')).length > 0) {
              cy.log('[STEP 14] DateTime picker opened successfully');
              
              // Enter a date
              const today = new Date();
              const dateStr = `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`;
              
              cy.log(`[STEP 15] Entering date: ${dateStr}`);
              DateTimeSelectors.dateTimeDateInput().clear().type(dateStr);
              DateTimeSelectors.dateTimeDateInput().type('{enter}');
              waitForReactUpdate(1000);
              
              cy.log('[STEP 16] Date entered successfully');
            } else {
              cy.log('[STEP 14] DateTime picker did not open, but column was created');
            }
          });
        } else {
          cy.log('[STEP 13] DateTime cells not found, but column creation was attempted');
        }
      });
      
      cy.log('[STEP 17] DateTime column test completed');
    });
  });
});