import {
  AddPageSelectors,
  DatabaseGridSelectors,
  waitForReactUpdate
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Database Grid Edit Operations', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  it('should create a database grid page, refresh, edit first row, and verify the changes', () => {
    const testEmail = generateRandomEmail();

    // Login
    cy.log('Step 1: Logging in to the application');
    cy.signIn(testEmail).then(() => {
      // Wait for app to load
      cy.log('Step 2: Waiting for application to load');
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Find the add page button
      cy.log('Step 3: Opening add page menu');
      AddPageSelectors.inlineAddButton().first().should('be.visible').click();

      // Wait for dropdown menu to appear
      waitForReactUpdate(1000);

      // Click on Grid option to create a new grid database
      cy.log('Step 4: Creating a new Grid database');
      AddPageSelectors.addGridButton().should('be.visible').click();

      // Wait for navigation to the new grid page
      cy.log('Step 5: Waiting for Grid database to be created');
      cy.wait(8000); // Give it time to create and navigate

      // Get the current URL to navigate back after refresh
      cy.url().then((currentUrl) => {
        cy.log('Current Grid URL: ' + currentUrl);

        // Refresh the page to ensure the grid database was properly saved
        cy.log('Step 6: Refreshing the page to verify grid database persistence');
        cy.reload();
        cy.wait(5000); // Wait for page to reload

        // Verify we're still on the grid page
        cy.url().should('include', currentUrl.split('/').pop());

        // Now verify the grid is loaded after refresh
        cy.log('Step 7: Verifying Grid database loaded after refresh');
        DatabaseGridSelectors.grid().should('be.visible');

        // Try to interact with any cell that exists
        cy.log('Step 8: Looking for cells to edit');
        waitForReactUpdate(2000);

        // Try to find the first cell and click it
        DatabaseGridSelectors.firstCell().then($cell => {
          cy.log('Found a cell, clicking to edit');
          cy.wrap($cell).click({ force: true });
          waitForReactUpdate(1000);

          // Type some text
          const testText = 'Test Edit ' + Date.now();
          cy.log('Typing test text: ' + testText);

          // Try typing directly into the focused element
          cy.focused().type(testText);
          waitForReactUpdate(1000);

          // Press Enter to save
          cy.focused().type('{enter}');
          waitForReactUpdate(2000);

          // Refresh again to verify the edit persists
          cy.log('Step 9: Refreshing to verify edit persistence');
          cy.reload();
          cy.wait(5000);

          // Verify the text still appears in the grid after refresh
          cy.log('Step 10: Verifying the edit was saved and persists after refresh');
          DatabaseGridSelectors.grid().should('be.visible');
          DatabaseGridSelectors.grid().should('contain.text', testText.substring(0, 10));

          cy.log('Test completed: Successfully created grid database, edited a cell, and verified persistence after refresh');
        });
      });
    });
  });

});
