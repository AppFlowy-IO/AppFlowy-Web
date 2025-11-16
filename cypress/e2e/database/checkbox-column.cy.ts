import {
  AddPageSelectors,
  DatabaseGridSelectors,
  CheckboxSelectors,
  byTestId,
  waitForReactUpdate
} from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

describe('Checkbox Column Type', () => {
  let testEmail: string;

  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should create grid and interact with cells', () => {
    cy.log(`[TEST START] Testing grid cell interaction`);

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

      // Verify cells exist
      cy.log('[STEP 7] Verifying cells exist');
      DatabaseGridSelectors.cells().should('exist');

      // Click on first cell
      cy.log('[STEP 8] Clicking on first cell');
      DatabaseGridSelectors.cells().first().click();
      waitForReactUpdate(500);

      // Look for any checkbox-specific elements that might appear
      cy.log('[STEP 9] Looking for checkbox elements');
      cy.get('body').then($body => {
        // Check for checkbox cells with our data-testid
        const checkboxCells = $body.find('[data-testid^="checkbox-cell-"]');
        if (checkboxCells.length > 0) {
          cy.log(`[STEP 10] Found ${checkboxCells.length} checkbox cells`);

          // Click first checkbox cell
          CheckboxSelectors.allCheckboxCells().first().click();
          waitForReactUpdate(500);
          cy.log('[STEP 11] Clicked checkbox cell');
        } else {
          cy.log('[STEP 10] No checkbox cells found, cell interaction test completed');
        }
      });

      cy.log('[STEP 12] Test completed successfully');
    });
  });
});