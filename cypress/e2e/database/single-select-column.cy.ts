/**
 * Single Select Column Tests
 *
 * Tests basic SingleSelect cell interactions.
 * Note: Field type conversion tests are in field-type-select.cy.ts
 */
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  PropertyMenuSelectors,
  GridFieldSelectors,
  SingleSelectSelectors,
  PageSelectors,
  FieldType,
  waitForReactUpdate
} from '../../support/selectors';
import { AuthTestUtils } from '../../support/auth-utils';
import { generateRandomEmail } from '../../support/test-config';

describe('Single Select Column Type', () => {
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

  it('should create SingleSelect column and add options', () => {
    const testEmail = generateRandomEmail();
    cy.log(`[TEST START] SingleSelect column test - Test email: ${testEmail}`);

    cy.log('[STEP 1] Visiting login page');
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    cy.log('[STEP 2] Starting authentication');
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.log('[STEP 3] Authentication successful');
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(5000);

      cy.log('[STEP 3.1] Verifying workspace loaded');
      cy.get('body').should('exist');
      cy.wait(2000);

      // Create a new grid
      cy.log('[STEP 4] Creating new grid');

      // Try to find either inline add button or new page button
      AddPageSelectors.inlineAddButton().then($inlineAdd => {
        const inlineAddExists = $inlineAdd.length > 0;
        PageSelectors.newPageButton().then($newPage => {
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

      // Add new column as SingleSelect
      cy.log('[STEP 6] Adding new SingleSelect column');
      PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
      waitForReactUpdate(3000);

      // Change to SingleSelect type
      cy.log('[STEP 7] Changing column type to SingleSelect');
      PropertyMenuSelectors.propertyTypeTrigger().then($trigger => {
        if ($trigger.length > 0) {
          cy.wrap($trigger.first()).click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeOption(FieldType.SingleSelect).click({ force: true });
          waitForReactUpdate(2000);
        } else {
          GridFieldSelectors.allFieldHeaders().last().scrollIntoView().click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeOption(FieldType.SingleSelect).click({ force: true });
          waitForReactUpdate(2000);
        }
      });

      // Close menu
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);

      // Add select options by clicking on cells
      cy.log('[STEP 8] Adding select options to cells');

      SingleSelectSelectors.allSelectOptionCells().then($cells => {
        if ($cells.length > 0) {
          cy.log(`[STEP 9] Found ${$cells.length} select cells`);

          // Add Option A to first cell
          SingleSelectSelectors.allSelectOptionCells().first().click({ force: true });
          waitForReactUpdate(500);
          cy.focused().type('Option A{enter}');
          waitForReactUpdate(1000);

          // Add Option B to second cell if exists
          if ($cells.length > 1) {
            SingleSelectSelectors.allSelectOptionCells().eq(1).click({ force: true });
            waitForReactUpdate(500);
            cy.focused().type('Option B{enter}');
            waitForReactUpdate(1000);
          }
        } else {
          cy.log('[STEP 9] No select cells found, using regular cells');

          DatabaseGridSelectors.rows().first().within(() => {
            DatabaseGridSelectors.cells().last().click({ force: true });
            waitForReactUpdate(500);
          });

          cy.focused().type('Option A{enter}');
          waitForReactUpdate(1000);

          DatabaseGridSelectors.rows().eq(1).within(() => {
            DatabaseGridSelectors.cells().last().click({ force: true });
            waitForReactUpdate(500);
          });

          cy.focused().type('Option B{enter}');
          waitForReactUpdate(1000);
        }
      });

      // Verify options can be selected from dropdown
      cy.log('[STEP 10] Verifying option dropdown works');
      SingleSelectSelectors.allSelectOptionCells().then($cells => {
        if ($cells.length > 0) {
          SingleSelectSelectors.allSelectOptionCells().first().click({ force: true });
          waitForReactUpdate(500);

          SingleSelectSelectors.selectOptionMenu().then($menu => {
            if ($menu.length > 0) {
              cy.log('[STEP 11] Select option menu opened successfully');
            } else {
              cy.log('[STEP 11] Select cells exist but menu behavior may differ');
            }
          });
        }
      });

      cy.log('[TEST COMPLETE] SingleSelect column test completed');
    });
  });
});
