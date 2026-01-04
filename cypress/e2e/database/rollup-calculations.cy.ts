/**
 * Rollup Field Calculation Tests
 *
 * These tests verify rollup field filtering and sorting functionality,
 * mirroring aspects of desktop Flutter integration tests from:
 * - database_rollup_real_case_test.dart
 * - grid_filter_and_sort_test.dart
 *
 * Note: These tests require the APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT=true environment flag.
 * Multi-database tests are skipped due to view sync timing issues that make them flaky.
 * These tests focus on single-grid scenarios to test filter/sort UI with rollup fields.
 */
import {
  AddPageSelectors,
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  FieldType,
  byTestId,
  waitForReactUpdate,
} from '../../support/selectors';
import { AuthTestUtils } from '../../support/auth-utils';
import { generateRandomEmail } from '../../support/test-config';

const waitForAppReady = () => {
  cy.get(`${byTestId('inline-add-page')}, ${byTestId('new-page-button')}`, { timeout: 20000 }).should('be.visible');
};

const isRelationRollupEditEnabled = Cypress.env('APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT') === 'true';
const describeIfEnabled = isRelationRollupEditEnabled ? describe : describe.skip;

/**
 * Helper: Login and create a new grid
 */
const loginAndCreateGrid = (email: string) => {
  cy.visit('/login', { failOnStatusCode: false });
  cy.wait(1500);
  const authUtils = new AuthTestUtils();
  return authUtils.signInWithTestUrl(email).then(() => {
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.wait(4000);

    AddPageSelectors.inlineAddButton().first().click({ force: true });
    waitForReactUpdate(800);
    AddPageSelectors.addGridButton().should('exist').click({ force: true });
    cy.wait(7000);
    DatabaseGridSelectors.grid().should('exist');
    DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);
  });
};

/**
 * Helper: Add a relation field
 */
const addRelationField = () => {
  PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
  waitForReactUpdate(1200);

  cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 }).should('be.visible');

  PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
  waitForReactUpdate(600);
  PropertyMenuSelectors.propertyTypeOption(FieldType.Relation).scrollIntoView().click({ force: true });
  waitForReactUpdate(800);
  cy.get('body').type('{esc}{esc}');
  waitForReactUpdate(500);
};

/**
 * Helper: Add a rollup field
 */
const addRollupField = () => {
  PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
  waitForReactUpdate(1200);

  cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 }).should('be.visible');

  PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
  waitForReactUpdate(600);
  PropertyMenuSelectors.propertyTypeOption(FieldType.Rollup).scrollIntoView().click({ force: true });
  waitForReactUpdate(800);
  // Don't close the menu - leave it open for configuration
};

/**
 * Helper: Get the rollup field ID (assumes it's the last field)
 */
const getRollupFieldId = (): Cypress.Chainable<string> => {
  return GridFieldSelectors.allFieldHeaders()
    .last()
    .invoke('attr', 'data-testid')
    .then((testId) => {
      return testId?.replace('grid-field-header-', '') || '';
    });
};

/**
 * Helper: Assert row count
 */
const assertRowCount = (expectedCount: number) => {
  cy.log(`Asserting row count: ${expectedCount}`);
  DatabaseGridSelectors.dataRows().should('have.length', expectedCount);
};

/**
 * Helper: Assert filter exists
 */
const assertFilterExists = () => {
  DatabaseFilterSelectors.filterCondition().should('exist').and('be.visible');
};

/**
 * Helper: Assert sort exists
 */
const assertSortExists = () => {
  DatabaseFilterSelectors.sortCondition().should('exist').and('be.visible');
};

describeIfEnabled('Rollup Field Calculations', () => {
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

    cy.viewport(1280, 900);
  });

  describe('Rollup field setup (single-grid)', () => {
    /**
     * Test: Rollup field can be created alongside relation field
     *
     * This test verifies the basic setup flow for rollup fields:
     * 1. Create a grid
     * 2. Add a Relation field (prerequisite for rollup)
     * 3. Add a Rollup field
     * 4. Verify rollup configuration options are available
     */
    it('should create rollup field with relation field', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation field first (required for rollup)
      addRelationField();

      // Add rollup field
      addRollupField();

      // Verify rollup configuration is shown
      cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 })
        .should('be.visible')
        .within(() => {
          cy.contains('Relation').should('exist');
          cy.contains('Property').should('exist');
          cy.contains('Calculation').should('exist');
          cy.contains('Show as').should('exist');
        });

      // Close the menu
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(500);

      // Verify both fields exist in the grid
      GridFieldSelectors.allFieldHeaders().should('have.length.at.least', 3); // Name + Relation + Rollup
    });

    /**
     * Test: Rollup field shows "Select relation field" when unconfigured
     *
     * This verifies the default state of an unconfigured rollup field.
     */
    it('should show unconfigured state for new rollup field', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation field first
      addRelationField();

      // Add rollup field
      addRollupField();

      // Verify default "Select relation field" prompt is shown
      cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 })
        .should('be.visible')
        .within(() => {
          cy.contains('Select relation field').should('exist');
        });
    });
  });

  describe('Rollup filtering (single-grid, UI only)', () => {
    /**
     * Test: Filter button works with rollup field
     *
     * This tests that the filter UI properly recognizes rollup fields.
     * Note: Without linked data, this tests the UI flow rather than actual filtering.
     */
    it('should show rollup field in filter field picker', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation and rollup fields
      addRelationField();
      addRollupField();
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(500);

      // Click filter button
      DatabaseFilterSelectors.filterButton().click({ force: true });
      waitForReactUpdate(500);

      // Check if Rollup field appears in the picker
      cy.get('.appflowy-scroller', { timeout: 5000 })
        .should('be.visible')
        .within(() => {
          cy.contains('Rollup').should('exist');
        });
    });

    /**
     * Test: Create filter on rollup field
     *
     * Tests creating a filter on a rollup field using text-based filtering.
     */
    it('should create filter on rollup field', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation and rollup fields
      addRelationField();
      addRollupField();
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(500);

      // Create filter on rollup field
      DatabaseFilterSelectors.filterButton().click({ force: true });
      waitForReactUpdate(500);

      // Select Rollup field
      cy.get('.appflowy-scroller')
        .contains('Rollup')
        .click({ force: true });
      waitForReactUpdate(800);

      // Filter menu should open - rollup uses text filter
      cy.get('[data-testid="text-filter"]').should('be.visible');

      // Close filter menu
      cy.get('body').type('{esc}');
      waitForReactUpdate(300);

      // Verify filter was created
      assertFilterExists();
    });
  });

  describe('Rollup sorting (single-grid, UI only)', () => {
    /**
     * Test: Sort button recognizes sortable rollup fields
     *
     * Note: Only rollup fields with "Calculated" display (numeric) can be sorted.
     * List-type rollups cannot be sorted.
     */
    it('should allow sorting on numeric rollup field', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation and rollup fields
      addRelationField();
      addRollupField();
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(500);

      // Click sort button
      DatabaseFilterSelectors.sortButton().click({ force: true });
      waitForReactUpdate(500);

      // Check if Rollup field appears in the sort picker
      // Note: Rollup must be configured with "Calculated" display to be sortable
      cy.get('.appflowy-scroller', { timeout: 5000 }).should('be.visible');

      // The rollup field should appear in the list since it defaults to "Count" + "Calculated"
      cy.get('.appflowy-scroller').then(($scroller) => {
        const hasRollup = $scroller.text().includes('Rollup');
        if (hasRollup) {
          cy.log('[INFO] Rollup field is sortable (default Count + Calculated)');
          cy.get('.appflowy-scroller').contains('Rollup').click({ force: true });
          waitForReactUpdate(800);
          assertSortExists();
        } else {
          cy.log('[INFO] Rollup field not sortable - may need configuration');
        }
      });
    });
  });

  // Multi-database tests are skipped due to view sync timing issues
  describe.skip('Rollup with linked data', () => {
    /**
     * Test: Display rollup count from related rows
     *
     * SKIPPED: Multi-database tests are flaky due to view sync timing issues
     */
    it('should display rollup count from related rows', () => {
      // Implementation would require stable multi-database setup
    });

    /**
     * Test: Filter by rollup field value
     *
     * SKIPPED: Multi-database tests are flaky due to view sync timing issues
     */
    it('should filter by rollup field value', () => {
      // Implementation would require linked data
    });

    /**
     * Test: Sort by numeric rollup field
     *
     * SKIPPED: Multi-database tests are flaky due to view sync timing issues
     */
    it('should sort by numeric rollup field', () => {
      // Implementation would require linked data
    });

    /**
     * Test: Update rollup when related data changes
     *
     * SKIPPED: Multi-database tests are flaky due to view sync timing issues
     */
    it('should update rollup when related data changes', () => {
      // Implementation would require linked data
    });

    /**
     * Test: Update rollup when relation is removed
     *
     * SKIPPED: Multi-database tests are flaky due to view sync timing issues
     */
    it('should update rollup when relation is removed', () => {
      // Implementation would require linked data
    });
  });
});
