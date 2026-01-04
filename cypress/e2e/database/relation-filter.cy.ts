/**
 * Relation Field Filtering Tests
 *
 * These tests verify that relation field filtering works correctly,
 * mirroring the desktop Flutter integration tests from grid_relation_filter_test.dart.
 *
 * Based on desktop test: 'relation filter supports all conditions'
 *
 * Note: These tests require the APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT=true environment flag.
 * Multi-database tests are skipped due to view sync timing issues that make them flaky.
 */
import {
  AddPageSelectors,
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  FieldType,
  waitForReactUpdate,
} from '../../support/selectors';
import { AuthTestUtils } from '../../support/auth-utils';
import { generateRandomEmail } from '../../support/test-config';

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

  // Wait for dropdown to open
  cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 }).should('be.visible');

  PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
  waitForReactUpdate(600);
  PropertyMenuSelectors.propertyTypeOption(FieldType.Relation).scrollIntoView().click({ force: true });
  waitForReactUpdate(800);
  cy.get('body').type('{esc}{esc}');
  waitForReactUpdate(500);
};

/**
 * Helper: Get the relation field ID (assumes it's the last field)
 */
const getRelationFieldId = (): Cypress.Chainable<string> => {
  return GridFieldSelectors.allFieldHeaders()
    .last()
    .invoke('attr', 'data-testid')
    .then((testId) => {
      return testId?.replace('grid-field-header-', '') || '';
    });
};

/**
 * Helper: Create a filter on relation field
 */
const createRelationFilter = () => {
  cy.log('Creating filter on Relation field');

  // Click filter button
  DatabaseFilterSelectors.filterButton().click({ force: true });
  waitForReactUpdate(500);

  // Select the Relation field from the picker
  cy.get('.appflowy-scroller')
    .contains('Relation')
    .click({ force: true });
  waitForReactUpdate(800);
};

/**
 * Helper: Select a filter condition from the dropdown
 */
const selectFilterCondition = (conditionText: string) => {
  cy.log(`Selecting filter condition: ${conditionText}`);

  // Find the text filter container and click its condition dropdown
  cy.get('[data-testid="text-filter"]')
    .find('button')
    .first()
    .click({ force: true });
  waitForReactUpdate(300);

  // Select from dropdown - use case-insensitive matching
  cy.get('[role="menuitem"]')
    .contains(new RegExp(conditionText, 'i'))
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Helper: Close filter menu
 */
const closeFilterMenu = () => {
  cy.get('body').type('{esc}');
  waitForReactUpdate(300);
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

describeIfEnabled('Relation Field Filtering', () => {
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

  describe('Relation filter conditions (single-grid)', () => {
    /**
     * Test: Filter by RelationIsNotEmpty
     *
     * Creates a grid with a Relation field and tests filtering by "is not empty".
     * Since we can't easily link rows in a single-grid test, we test that:
     * 1. The filter can be created
     * 2. The "is not empty" condition is available
     * 3. With no linked relations, all rows should be filtered out
     */
    it('should filter by RelationIsNotEmpty condition', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation field
      addRelationField();

      // Create filter on relation field
      createRelationFilter();

      // Select "is not empty" condition
      selectFilterCondition('is not empty');
      closeFilterMenu();

      // Since no relations are linked, all rows should be filtered out
      assertFilterExists();

      // With "is not empty" filter and no relations, should show 0 rows
      // (3 default rows all have empty relation cells)
      assertRowCount(0);
    });

    /**
     * Test: Filter by RelationIsEmpty
     *
     * Creates a grid with a Relation field and tests filtering by "is empty".
     * Since no rows have linked relations, all rows should pass this filter.
     */
    it('should filter by RelationIsEmpty condition', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation field
      addRelationField();

      // Create filter on relation field
      createRelationFilter();

      // Select "is empty" condition
      selectFilterCondition('is empty');
      closeFilterMenu();

      // All rows should pass (no relations linked)
      assertFilterExists();

      // With "is empty" filter and no relations, should show all 3 rows
      assertRowCount(3);
    });

    /**
     * Test: Filter by RelationContains (text search)
     *
     * Note: Relation field filtering uses text-based filtering
     * (searching for relation content by text).
     * This tests that the contains filter works on the relation field.
     */
    it('should support RelationContains filter with text search', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation field
      addRelationField();

      // Create filter on relation field
      createRelationFilter();

      // Select "contains" condition
      selectFilterCondition('contains');

      // Set a filter value (won't match anything since no relations are linked)
      DatabaseFilterSelectors.filterInput()
        .should('be.visible')
        .clear()
        .type('NonExistentRow', { delay: 30 });

      closeFilterMenu();

      // No rows should match (no relations contain this text)
      assertFilterExists();
      assertRowCount(0);
    });

    /**
     * Test: Filter by RelationDoesNotContain
     *
     * Tests the "does not contain" filter on relation fields.
     * Since no rows have linked relations with the search text,
     * all rows should pass this filter.
     */
    it('should support RelationDoesNotContain filter', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Add relation field
      addRelationField();

      // Create filter on relation field
      createRelationFilter();

      // Select "does not contain" condition
      selectFilterCondition('does not contain');

      // Set a filter value
      DatabaseFilterSelectors.filterInput()
        .should('be.visible')
        .clear()
        .type('SomeText', { delay: 30 });

      closeFilterMenu();

      // All rows should match (no relations contain this text)
      assertFilterExists();
      assertRowCount(3);
    });
  });

  // Multi-database tests are skipped due to view sync timing issues
  describe.skip('Relation filter with linked data', () => {
    /**
     * Test: Filter linked rows by name
     *
     * This test would:
     * 1. Create two databases
     * 2. Link rows from source to target
     * 3. Filter by relation content
     *
     * SKIPPED: Multi-database tests are flaky due to view sync timing issues
     */
    it('should filter linked rows by name', () => {
      // Implementation would require stable multi-database setup
    });

    /**
     * Test: Handle deleted linked records
     *
     * SKIPPED: Multi-database tests are flaky due to view sync timing issues
     */
    it('should handle deleted linked records gracefully', () => {
      // Implementation would require stable multi-database setup
    });
  });
});
