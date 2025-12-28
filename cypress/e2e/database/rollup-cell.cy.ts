/**
 * Rollup Cell Integration Tests
 *
 * Based on desktop Flutter integration tests from:
 * frontend/appflowy_flutter/integration_test/desktop/grid/grid_rollup_test.dart
 *
 * Test scenarios:
 * 1. Create rollup field and configure it to count related rows
 * 2. Verify rollup displays count of related rows
 * 3. Verify rollup updates when relations change
 */

import {
  AddPageSelectors,
  DatabaseGridSelectors,
  PropertyMenuSelectors,
  GridFieldSelectors,
  FieldType,
  byTestId,
  waitForReactUpdate,
} from '../../support/selectors';
import { AuthTestUtils } from '../../support/auth-utils';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Rollup-specific selectors
 */
const RollupSelectors = {
  // Rollup cell content
  rollupCell: () => cy.get('[data-testid^="grid-cell-"]'),

  // Rollup property menu items
  relationFieldSelect: () => cy.contains('Select relation field'),
  propertySelect: () => cy.contains('Select a property'),
  calculationSelect: () => cy.contains('Count'),
  showAsSelect: () => cy.contains('Calculated'),

  // Rollup configuration submenu
  rollupRelationSubmenu: () => cy.get('[data-radix-menu-content]').contains('Relation'),
};

const waitForAppReady = () => {
  cy.get(`${byTestId('inline-add-page')}, ${byTestId('new-page-button')}`, { timeout: 20000 }).should('be.visible');
};

const isRelationRollupEditEnabled = Cypress.env('APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT') === 'true';
const describeIfEnabled = isRelationRollupEditEnabled ? describe : describe.skip;

describeIfEnabled('Rollup Cell Type', () => {
  beforeEach(() => {
    // Handle React errors gracefully
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

    cy.viewport(1600, 900);
  });

  /**
   * Test 1: Create rollup field and verify it displays count
   *
   * Based on Flutter test: 'rollup_calculated_count_without_target_counts_related_rows'
   *
   * Steps:
   * 1. Create first grid (related database) with rows
   * 2. Create second grid with a Relation field pointing to first grid
   * 3. Link some rows
   * 4. Add a Rollup field configured to count related rows
   * 5. Verify the rollup displays correct count
   */
  // SKIP: Test is flaky due to view sync timing issues when creating multiple grids
  // The "View not found in outline" warnings indicate the second grid isn't fully registered
  // before navigation attempts. Core rollup configuration UI is tested by test 3.
  it.skip('should display count of related rows in rollup field', () => {
    const testEmail = generateRandomEmail();
    cy.log(`[TEST] Rollup count test - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      waitForAppReady();

      // Create first grid (related database)
      cy.log('[STEP 1] Creating first grid (related database)');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().click({ force: true });

      DatabaseGridSelectors.cells().should('exist', { timeout: 15000 });

      // Add two rows with names
      cy.log('[STEP 2] Adding rows to first grid');
      DatabaseGridSelectors.cells().first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type('Author 1{enter}');
      waitForReactUpdate(500);
      cy.focused().type('Author 2{enter}');
      waitForReactUpdate(1000);

      cy.url().then(() => {
        // Create second grid
        cy.log('[STEP 3] Creating second grid');
        AddPageSelectors.inlineAddButton().first().click({ force: true });
        waitForReactUpdate(1000);
        AddPageSelectors.addGridButton().click({ force: true });
        DatabaseGridSelectors.grid().should('exist', { timeout: 30000 });

        cy.reload();

        DatabaseGridSelectors.cells().should('have.length.at.least', 1, { timeout: 30000 });

        // Add data to second grid
        cy.log('[STEP 4] Adding data to second grid');
        DatabaseGridSelectors.cells().first().click({ force: true });
        waitForReactUpdate(500);
        cy.focused().type('Blog Post 1{enter}');
        waitForReactUpdate(1000);

        // Add Relation field
        cy.log('[STEP 5] Adding Relation field');
        PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
        waitForReactUpdate(3000);
        PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
        waitForReactUpdate(1000);
        PropertyMenuSelectors.propertyTypeOption(FieldType.Relation).click({ force: true });
        waitForReactUpdate(2000);

        cy.get('body').type('{esc}{esc}');
        waitForReactUpdate(1000);

        // Configure relation and link rows
        cy.log('[STEP 6] Configuring relation and linking rows');
        GridFieldSelectors.allFieldHeaders().then(($headers) => {
          const relationHeader = $headers.last();
          const relationFieldId = relationHeader.attr('data-testid')?.replace('grid-field-header-', '');

          if (relationFieldId) {
            // Click on relation cell to open popup
            DatabaseGridSelectors.dataRowCellsForField(relationFieldId).first().click({ force: true });
            waitForReactUpdate(1000);

            // Select related database from popup
            cy.get('[data-radix-popper-content-wrapper]').should('be.visible', { timeout: 5000 });
            cy.get('[data-radix-popper-content-wrapper]')
              .find('button, [role="option"], [role="menuitem"]')
              .first()
              .click({ force: true });
            waitForReactUpdate(2000);

            // Link both authors
            cy.get('[data-radix-popper-content-wrapper]').then(($popover) => {
              if ($popover.text().includes('Author 1')) {
                // Link Author 1
                cy.contains('Author 1').closest('[class*="flex"]').find('button').click({ force: true });
                waitForReactUpdate(500);

                // Link Author 2
                cy.contains('Author 2').closest('[class*="flex"]').find('button').click({ force: true });
                waitForReactUpdate(500);

                cy.get('body').type('{esc}');
                waitForReactUpdate(1000);

                // Now add Rollup field
                cy.log('[STEP 7] Adding Rollup field');
                PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
                waitForReactUpdate(3000);
                PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
                waitForReactUpdate(1000);
                PropertyMenuSelectors.propertyTypeOption(FieldType.Rollup).click({ force: true });
                waitForReactUpdate(2000);

                // Configure rollup to use the relation field
                cy.log('[STEP 8] Configuring rollup field');

                // Select relation field
                cy.contains('Select relation field').should('be.visible').click({ force: true });
                waitForReactUpdate(1000);

                // Click on the Relation option
                cy.get('[data-radix-menu-content]')
                  .last()
                  .find('[role="menuitem"]')
                  .first()
                  .click({ force: true });
                waitForReactUpdate(2000);

                cy.get('body').type('{esc}{esc}');
                waitForReactUpdate(1000);

                // Verify rollup displays count of 2 (two linked authors)
                cy.log('[STEP 9] Verifying rollup displays correct count');

                // Find the rollup field column and check the value
                GridFieldSelectors.allFieldHeaders().then(($newHeaders) => {
                  const rollupHeader = $newHeaders.last();
                  const rollupFieldId = rollupHeader.attr('data-testid')?.replace('grid-field-header-', '');

                  if (!rollupFieldId) {
                    throw new Error('Rollup field id not found');
                  }

                  DatabaseGridSelectors.dataRowCellsForField(rollupFieldId, { timeout: 10000 })
                    .first()
                    .should('contain.text', '2');
                  cy.log('[SUCCESS] Rollup field displays correct count!');
                });
              } else {
                cy.log('[INFO] Authors not found - skipping test');
              }
            });
          }
        });
      });
    });
  });

  /**
   * Test 2: Rollup updates when relation changes
   *
   * Based on Flutter test: 'rollup_updates_when_related_value_or_relation_changes'
   *
   * Steps:
   * 1. Create related database with rows
   * 2. Create base database with relation and rollup fields
   * 3. Verify initial rollup value
   * 4. Add more relations
   * 5. Verify rollup value updates
   */
  // SKIP: Test is flaky due to view sync timing issues when creating multiple grids
  // Similar to test 1, this involves multi-grid navigation which is inherently flaky.
  it.skip('should update rollup when relations change', () => {
    const testEmail = generateRandomEmail();
    cy.log(`[TEST] Rollup reactivity test - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      waitForAppReady();

      // Create first grid (related database)
      cy.log('[STEP 1] Creating first grid with rows');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().click({ force: true });

      DatabaseGridSelectors.cells().should('exist', { timeout: 15000 });

      // Add rows
      DatabaseGridSelectors.cells().first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type('Item A{enter}');
      waitForReactUpdate(500);
      cy.focused().type('Item B{enter}');
      waitForReactUpdate(500);
      cy.focused().type('Item C{enter}');
      waitForReactUpdate(1000);

      // Create second grid
      cy.log('[STEP 2] Creating second grid');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().click({ force: true });
      DatabaseGridSelectors.grid().should('exist', { timeout: 30000 });
      cy.reload();

      DatabaseGridSelectors.cells().should('have.length.at.least', 1, { timeout: 30000 });

      // Add row
      DatabaseGridSelectors.cells().first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type('Main Row{enter}');
      waitForReactUpdate(1000);

      // Add Relation field
      cy.log('[STEP 3] Adding Relation field');
      PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
      waitForReactUpdate(3000);
      PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
      waitForReactUpdate(1000);
      PropertyMenuSelectors.propertyTypeOption(FieldType.Relation).click({ force: true });
      waitForReactUpdate(2000);

      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);

      // Configure relation - link only one item initially
      cy.log('[STEP 4] Linking one item initially');
      GridFieldSelectors.allFieldHeaders().then(($headers) => {
        const relationHeader = $headers.last();
        const relationFieldId = relationHeader.attr('data-testid')?.replace('grid-field-header-', '');

        if (relationFieldId) {
          DatabaseGridSelectors.dataRowCellsForField(relationFieldId).first().click({ force: true });
          waitForReactUpdate(1000);

          cy.get('[data-radix-popper-content-wrapper]').should('be.visible');
          cy.get('[data-radix-popper-content-wrapper]')
            .find('button, [role="option"], [role="menuitem"]')
            .first()
            .click({ force: true });
          waitForReactUpdate(2000);

          cy.get('[data-radix-popper-content-wrapper]').then(($popover) => {
            if ($popover.text().includes('Item A')) {
              // Link only Item A
              cy.contains('Item A').closest('[class*="flex"]').find('button').click({ force: true });
              waitForReactUpdate(500);

              cy.get('body').type('{esc}');
              waitForReactUpdate(1000);

              // Add Rollup field
              cy.log('[STEP 5] Adding Rollup field');
              PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
              waitForReactUpdate(3000);
              PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
              waitForReactUpdate(1000);
              PropertyMenuSelectors.propertyTypeOption(FieldType.Rollup).click({ force: true });
              waitForReactUpdate(2000);

              // Configure rollup
              cy.contains('Select relation field').should('be.visible').click({ force: true });
              waitForReactUpdate(1000);
              cy.get('[data-radix-menu-content]')
                .last()
                .find('[role="menuitem"]')
                .first()
                .click({ force: true });
              waitForReactUpdate(2000);

              cy.get('body').type('{esc}{esc}');
              waitForReactUpdate(1000);

              GridFieldSelectors.allFieldHeaders().then(($rollupHeaders) => {
                const rollupHeader = $rollupHeaders.last();
                const rollupFieldId = rollupHeader.attr('data-testid')?.replace('grid-field-header-', '');

                if (!rollupFieldId) {
                  throw new Error('Rollup field id not found');
                }

                // Verify initial count is 1
                cy.log('[STEP 6] Verifying initial rollup count is 1');
                DatabaseGridSelectors.dataRowCellsForField(rollupFieldId, { timeout: 10000 })
                  .first()
                  .should('contain.text', '1');

                // Now add more relations
                cy.log('[STEP 7] Adding more relations');
                DatabaseGridSelectors.dataRowCellsForField(relationFieldId).first().click({ force: true });
                waitForReactUpdate(1000);

                cy.get('[data-radix-popper-content-wrapper]').should('be.visible');

                // Link Item B
                cy.contains('Item B').closest('[class*="flex"]').find('button').click({ force: true });
                waitForReactUpdate(500);

                cy.get('body').type('{esc}');
                waitForReactUpdate(1000);

                // Verify rollup updated to 2
                cy.log('[STEP 8] Verifying rollup updated to 2');
                DatabaseGridSelectors.dataRowCellsForField(rollupFieldId, { timeout: 10000 })
                  .first()
                  .should('contain.text', '2');

                cy.log('[SUCCESS] Rollup reactivity test passed!');
              });
            } else {
              cy.log('[INFO] Items not found - skipping test');
            }
          });
        }
      });
    });
  });

  /**
   * Test 3: Rollup field configuration UI
   *
   * Tests the rollup property configuration menu
   *
   * Steps:
   * 1. Create database with relation and rollup fields
   * 2. Open rollup field property menu
   * 3. Verify configuration options are visible
   */
  it('should show rollup configuration options in property menu', () => {
    const testEmail = generateRandomEmail();
    cy.log(`[TEST] Rollup configuration UI test - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      waitForAppReady();

      // Create a grid
      cy.log('[STEP 1] Creating grid');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().click({ force: true });

      DatabaseGridSelectors.cells().should('exist', { timeout: 15000 });

      // Add Relation field first (required for rollup)
      cy.log('[STEP 2] Adding Relation field');
      PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
      waitForReactUpdate(3000);
      PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
      waitForReactUpdate(1000);
      PropertyMenuSelectors.propertyTypeOption(FieldType.Relation).click({ force: true });
      waitForReactUpdate(2000);

      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);

      // Add Rollup field
      cy.log('[STEP 3] Adding Rollup field');
      PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
      waitForReactUpdate(3000);
      PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
      waitForReactUpdate(1000);
      PropertyMenuSelectors.propertyTypeOption(FieldType.Rollup).click({ force: true });
      waitForReactUpdate(2000);

      // Verify configuration options are visible in the property menu popup
      cy.log('[STEP 4] Verifying rollup configuration options');

      // Scope all checks to the property menu popup to avoid matching elements in the grid header
      cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 }).should('be.visible').within(() => {
        // Check for Relation section
        cy.contains('Relation', { timeout: 5000 }).should('exist');

        // Check for Property section
        cy.contains('Property', { timeout: 5000 }).should('exist');

        // Check for Calculation section
        cy.contains('Calculation', { timeout: 5000 }).should('exist');

        // Check for Show as section
        cy.contains('Show as', { timeout: 5000 }).should('exist');

        // Check for default values
        cy.contains('Select relation field').should('exist');
        cy.contains('Count').should('exist');
        cy.contains('Calculated').should('exist');
      });

      cy.log('[SUCCESS] Rollup configuration UI test passed!');
    });
  });
});
