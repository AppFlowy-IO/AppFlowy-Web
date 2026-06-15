/**
 * Filter/Sort Sync Tests
 *
 * Reproduces the bug where filters/sorts synced from desktop appear
 * in the toolbar UI but rows are not actually filtered/sorted.
 *
 * These tests simulate external Yjs updates (as if arriving from
 * the desktop app) by directly manipulating the database Yjs doc.
 */
import { test, expect } from '@playwright/test';
import {
  loginAndCreateGrid,
  getPrimaryFieldId,
  assertRowCount,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import { addRows } from '../../support/field-type-helpers';
import {
  assertRowOrder,
} from '../../support/sort-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  SortSelectors,
} from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import {
  waitForDatabaseDocReady,
  injectFilterViaYjs,
  injectSortViaYjs,
} from '../../support/yjs-inject-helpers';

/**
 * Populate test rows with names: C, A, E, B, D (deliberately unordered)
 */
async function setupTestRows(page: import('@playwright/test').Page, primaryFieldId: string) {
  // Default grid has 3 rows, add 2 more for 5 total
  await addRows(page, 2);
  await page.waitForTimeout(500);

  const names = ['C', 'A', 'E', 'B', 'D'];

  for (let i = 0; i < names.length; i++) {
    await typeTextIntoCell(page, primaryFieldId, i, names[i]);
  }

  await page.waitForTimeout(500);
}

test.describe('Filter/Sort Sync from External Source (Desktop Parity)', () => {
  test('filter injected via Yjs should filter rows', async ({ page, request }) => {
    // Given: a grid with 5 rows (C, A, E, B, D) and no filters
    setupPageErrorHandling(page);
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);
    const primaryFieldId = await getPrimaryFieldId(page);

    await setupTestRows(page, primaryFieldId);
    await assertRowCount(page, 5);

    // Wait for database doc to be available for Yjs injection
    await waitForDatabaseDocReady(page);

    // When: a text filter (TextIs "A") is injected via Yjs (simulating desktop sync)
    await injectFilterViaYjs(page, {
      fieldId: primaryFieldId,
      condition: 0, // TextFilterCondition.TextIs
      content: 'A',
      fieldType: 0, // FieldType.RichText
    });

    // Then: the filter indicator should appear in the toolbar
    await expect(DatabaseFilterSelectors.filterCondition(page)).toBeVisible({ timeout: 10000 });

    // And: only the row matching "A" should be visible
    await assertRowCount(page, 1);

    // And: the visible row should contain "A"
    const firstCell = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first();

    await expect(firstCell).toContainText('A', { timeout: 5000 });
  });

  test('sort injected via Yjs should reorder rows', async ({ page, request }) => {
    // Given: a grid with 5 rows in order C, A, E, B, D and no sorts
    setupPageErrorHandling(page);
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);
    const primaryFieldId = await getPrimaryFieldId(page);

    await setupTestRows(page, primaryFieldId);
    await assertRowCount(page, 5);
    // Verify initial order
    await assertRowOrder(page, primaryFieldId, ['C', 'A', 'E', 'B', 'D']);

    // Wait for database doc to be available
    await waitForDatabaseDocReady(page);

    // When: an ascending sort is injected via Yjs (simulating desktop sync)
    await injectSortViaYjs(page, {
      fieldId: primaryFieldId,
      condition: 0, // SortCondition.Ascending
    });

    // Then: the sort indicator should appear in the toolbar (auto-expanded)
    await expect(SortSelectors.sortCondition(page)).toBeVisible({ timeout: 10000 });

    // And: rows should be reordered alphabetically: A, B, C, D, E
    await assertRowOrder(page, primaryFieldId, ['A', 'B', 'C', 'D', 'E']);
  });

  test('filter + sort injected via Yjs should both apply', async ({ page, request }) => {
    // Given: a grid with 5 rows (C, A, E, B, D) and no conditions
    setupPageErrorHandling(page);
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);
    const primaryFieldId = await getPrimaryFieldId(page);

    await setupTestRows(page, primaryFieldId);
    await assertRowCount(page, 5);

    await waitForDatabaseDocReady(page);

    // When: a filter (TextContains - empty content to match all) and descending sort
    // are injected via Yjs (simulating desktop sync of both conditions)
    await injectFilterViaYjs(page, {
      fieldId: primaryFieldId,
      condition: 7, // TextFilterCondition.TextIsNotEmpty
      content: '',
      fieldType: 0,
    });

    await injectSortViaYjs(page, {
      fieldId: primaryFieldId,
      condition: 1, // SortCondition.Descending
    });

    // Then: both indicators should appear in the toolbar
    await expect(DatabaseFilterSelectors.filterCondition(page)).toBeVisible({ timeout: 10000 });
    await expect(SortSelectors.sortCondition(page)).toBeVisible({ timeout: 10000 });

    // And: all 5 rows should be visible (TextIsNotEmpty, all have names)
    await assertRowCount(page, 5);

    // And: rows should be in descending order: E, D, C, B, A
    await assertRowOrder(page, primaryFieldId, ['E', 'D', 'C', 'B', 'A']);
  });

  test('filter injected via Yjs with TextContains should filter correctly', async ({ page, request }) => {
    // Given: a grid with rows containing varied text
    setupPageErrorHandling(page);
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);
    const primaryFieldId = await getPrimaryFieldId(page);

    // Add 4 more rows (7 total with default 3)
    await addRows(page, 4);
    await page.waitForTimeout(500);

    const names = ['Apple', 'Banana', 'Avocado', 'Cherry', 'Apricot', 'Blueberry', 'Acai'];

    for (let i = 0; i < names.length; i++) {
      await typeTextIntoCell(page, primaryFieldId, i, names[i]);
    }

    await page.waitForTimeout(500);
    await assertRowCount(page, 7);

    await waitForDatabaseDocReady(page);

    // When: a TextContains "an" filter is injected via Yjs
    await injectFilterViaYjs(page, {
      fieldId: primaryFieldId,
      condition: 2, // TextFilterCondition.TextContains
      content: 'an',
      fieldType: 0,
    });

    // Then: only rows containing "an" should be visible (Banana)
    await expect(DatabaseFilterSelectors.filterCondition(page)).toBeVisible({ timeout: 10000 });
    await assertRowCount(page, 1);

    const firstCell = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first();

    await expect(firstCell).toContainText('Banana', { timeout: 5000 });
  });
});
