/**
 * Rollup Cell Integration Tests
 *
 * Verifies the end-user-visible Rollup surface now that web supports it (the
 * `unsupportedFieldTypes` gate in PropertySelectTrigger.tsx was removed).
 *
 * Coverage focus: Rollup is selectable from the property type picker — i.e.
 * the gate is open and `addPropertyColumn(page, FieldType.Rollup)` actually
 * adds a Rollup column instead of being a no-op against a disabled menu item.
 *
 * Calculation correctness, cache reactivity, and per-calc-type behavior are
 * exhaustively covered by `src/application/database-yjs/__tests__/rollup-desktop-parity.test.ts`
 * (1200+ lines, 18+ calculation types). The Rollup filter editor branching is
 * covered by `filter-editors-desktop-parity.spec.ts`. Duplicating either at
 * the E2E layer would be slow and brittle without adding signal.
 */
import { test, expect } from '@playwright/test';
import { signInAndCreateDatabaseView, waitForGridReady, addPropertyColumn } from '../../support/database-ui-helpers';
import { GridFieldSelectors, FieldType } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const TIMEOUT = 10_000;

test.describe('Rollup Cell Type', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('Rollup column can be added via the property type picker', async ({ page, request }) => {
    // Given: a signed-in user with a fresh grid
    const email = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, email, 'Grid', { createWaitMs: 8000 });
    await waitForGridReady(page);

    const initialHeaderCount = await GridFieldSelectors.allFieldHeaders(page).count();

    // When: adding a Rollup column via the property menu
    await addPropertyColumn(page, FieldType.Rollup);

    // Then: a new field header should be added (proves the property-type
    // option was enabled and clickable — pre-fix it was rendered as disabled
    // with a "common.desktopOnly" tooltip and the click was a no-op).
    await expect
      .poll(() => GridFieldSelectors.allFieldHeaders(page).count(), { timeout: TIMEOUT })
      .toBeGreaterThan(initialHeaderCount);
  });
});
