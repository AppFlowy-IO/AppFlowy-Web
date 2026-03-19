/**
 * Rollup Cell Integration Tests
 *
 * Tests rollup field creation, configuration, and reactivity.
 * Migrated from: cypress/e2e/database/rollup-cell.cy.ts
 *
 * NOTE: The entire describe is always skipped in the original Cypress file
 * (Rollup is not yet enabled on web). Preserving skip behavior.
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  PropertyMenuSelectors,
  GridFieldSelectors,
  FieldType,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

// Rollup is always disabled on web (coming soon), so always skip these tests
test.describe('Rollup Cell Type', () => {
  test.skip(true, 'Rollup is not yet enabled on web');

  test.skip('should display count of related rows in rollup field', async () => {
    // Original test creates two grids, links rows, adds Rollup field, verifies count
  });

  test.skip('should update rollup when relations change', async () => {
    // Original test creates related database, adds relation + rollup, verifies reactivity
  });

  test.skip('should show rollup configuration options in property menu', async () => {
    // Original test creates grid with Relation + Rollup fields, verifies config UI
  });
});
