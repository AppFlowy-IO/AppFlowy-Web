import {
  AddPageSelectors,
  DatabaseGridSelectors,
  PropertyMenuSelectors,
  GridFieldSelectors,
  PersonSelectors,
  PageSelectors,
  FieldType,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Person Cell', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return false;
      }

      return true;
    });

    cy.viewport(1280, 720);
  });

  it('should create Person column, open menu, and convert to RichText and back', () => {
    const testEmail = generateRandomEmail();
    cy.log(`[TEST START] Person Cell Test - Test email: ${testEmail}`);

    cy.log('[STEP 1] Starting authentication');
    cy.signIn(testEmail).then(() => {
      cy.log('[STEP 2] Authentication successful');
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(5000);

      cy.log('[STEP 2.1] Verifying workspace loaded');
      cy.get('body').should('exist');
      cy.wait(2000);

      // Create a new grid
      cy.log('[STEP 4] Creating new grid');
      AddPageSelectors.inlineAddButton().then(($inlineAdd) => {
        const inlineAddExists = $inlineAdd.length > 0;

        PageSelectors.newPageButton().then(($newPage) => {
          const newPageExists = $newPage.length > 0;

          if (inlineAddExists) {
            cy.log('[STEP 4.1] Using inline add button');
            AddPageSelectors.inlineAddButton().first().click({ force: true });
          } else if (newPageExists) {
            cy.log('[STEP 4.1] Using new page button instead');
            PageSelectors.newPageButton().first().click({ force: true });
          } else {
            cy.log('[STEP 4.1] Waiting for UI to stabilize');
            cy.wait(3000);
            AddPageSelectors.inlineAddButton().should('exist', { timeout: 15000 });
            AddPageSelectors.inlineAddButton().first().click({ force: true });
          }
        });
      });

      waitForReactUpdate(1000);
      cy.log('[STEP 4.2] Clicking add grid button');
      AddPageSelectors.addGridButton().should('exist', { timeout: 10000 });
      AddPageSelectors.addGridButton().click({ force: true });
      cy.wait(8000);

      // Verify grid exists
      cy.log('[STEP 5] Verifying grid exists');
      DatabaseGridSelectors.grid().should('exist', { timeout: 15000 });
      DatabaseGridSelectors.cells().should('have.length.at.least', 1);

      // Add new column as Person
      cy.log('[STEP 6] Adding new Person column');
      PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
      waitForReactUpdate(3000);

      // Change to Person type
      cy.log('[STEP 7] Changing column type to Person');
      PropertyMenuSelectors.propertyTypeTrigger().then(($trigger) => {
        if ($trigger.length > 0) {
          cy.wrap($trigger.first()).click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeOption(FieldType.Person).click({ force: true });
          waitForReactUpdate(2000);
        } else {
          GridFieldSelectors.allFieldHeaders().last().scrollIntoView().click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeOption(FieldType.Person).click({ force: true });
          waitForReactUpdate(2000);
        }
      });

      // Close menu
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);

      // Verify Person cells exist
      cy.log('[STEP 8] Verifying Person cells exist');
      PersonSelectors.allPersonCells().should('exist', { timeout: 10000 });

      // Click on a Person cell to open the menu
      cy.log('[STEP 9] Clicking on Person cell to open menu');
      PersonSelectors.allPersonCells().first().click({ force: true });
      waitForReactUpdate(1000);

      // Verify the person cell menu opens
      cy.log('[STEP 10] Verifying Person cell menu opens');
      PersonSelectors.personCellMenu().should('exist', { timeout: 5000 });

      // Verify notify assignee toggle exists
      cy.log('[STEP 11] Verifying notify assignee toggle exists');
      PersonSelectors.notifyAssigneeToggle().should('exist');

      // Toggle the notify assignee switch
      cy.log('[STEP 12] Toggling notify assignee switch');
      PersonSelectors.notifyAssigneeToggle().click({ force: true });
      waitForReactUpdate(500);

      // Close the menu
      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      // Convert Person to RichText
      cy.log('[STEP 13] Opening field menu to convert to RichText');
      GridFieldSelectors.allFieldHeaders().last().click({ force: true });
      waitForReactUpdate(1000);

      PropertyMenuSelectors.editPropertyMenuItem().then(($edit) => {
        if ($edit.length > 0) {
          cy.wrap($edit).click();
          waitForReactUpdate(1000);
        }
      });

      cy.log('[STEP 14] Converting Person to RichText');
      PropertyMenuSelectors.propertyTypeTrigger().click({ force: true });
      waitForReactUpdate(500);
      PropertyMenuSelectors.propertyTypeOption(FieldType.RichText).click({ force: true });
      waitForReactUpdate(2000);

      // Close menu
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);

      // Verify Person cells no longer exist (converted to text)
      cy.log('[STEP 15] Verifying field converted to RichText');
      PersonSelectors.allPersonCells().should('not.exist');

      // Convert back to Person
      cy.log('[STEP 16] Converting back to Person');
      GridFieldSelectors.allFieldHeaders().last().click({ force: true });
      waitForReactUpdate(1000);

      PropertyMenuSelectors.editPropertyMenuItem().then(($edit) => {
        if ($edit.length > 0) {
          cy.wrap($edit).click();
          waitForReactUpdate(1000);
        }
      });

      PropertyMenuSelectors.propertyTypeTrigger().click({ force: true });
      waitForReactUpdate(500);
      PropertyMenuSelectors.propertyTypeOption(FieldType.Person).click({ force: true });
      waitForReactUpdate(2000);

      // Close menu
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);

      // Verify Person cells exist again
      cy.log('[STEP 17] Verifying Person cells exist after conversion');
      PersonSelectors.allPersonCells().should('exist', { timeout: 10000 });

      cy.log('[STEP 18] Person cell test completed successfully');
    });
  });
});
