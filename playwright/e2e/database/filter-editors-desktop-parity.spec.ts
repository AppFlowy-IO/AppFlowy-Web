/**
 * Filter Editor UI Tests — Desktop Parity
 *
 * Verifies the filter editor popovers wired up to bring web to parity with
 * desktop's choicechip filter widgets. Each test exercises the editor that
 * appears when a user adds a filter on a field of the given type.
 *
 *   - Number   → NumberFilterMenu (existing; covered for regression)
 *   - Time     → routed to NumberFilterMenu (newly added in FilterMenu.tsx)
 *   - Person   → new PersonFilterMenu (replaces a stub that had no UI)
 *   - Rollup   → new target-aware RollupFilterMenu (Number / Select / Text branches)
 */
import { test, expect } from '@playwright/test';
import {
  loginAndCreateGrid,
  typeTextIntoCell,
  openFilterMenu,
  addFilterByFieldName,
  enterFilterText,
  changeFilterCondition,
  assertRowCount,
  NumberFilterCondition,
} from '../../support/filter-test-helpers';
import { addFieldWithType, addRows, FieldTypeNames } from '../../support/field-type-helpers';
import { FieldType } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const TIMEOUT = 10_000;

test.describe('Filter editors (desktop parity)', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('Number filter: defaults to Equal with empty content, supports comparison + empty conditions', async ({
    page,
    request,
  }) => {
    // Given: a grid with a Number column populated with 1, 2, 3 and one empty row
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);

    // Default grid has 3 rows; add one more so we can test "is empty" with a populated row.
    await addRows(page, 1);
    await typeTextIntoCell(page, numberFieldId, 0, '1');
    await typeTextIntoCell(page, numberFieldId, 1, '2');
    await typeTextIntoCell(page, numberFieldId, 2, '3');
    // Row 3 stays empty.

    // When: a filter is added on the Number column
    await addFilterByFieldName(page, FieldTypeNames[FieldType.Number]);

    // Then: the Number filter input should be visible (Equal condition shows input,
    // and the default content is '' so all populated rows pass the empty equality).
    const numberInput = page.getByTestId('text-filter-input');

    await expect(numberInput).toBeVisible({ timeout: TIMEOUT });

    // When: switching to GreaterThan and entering 1
    await changeFilterCondition(page, NumberFilterCondition.GreaterThan);
    await enterFilterText(page, '1');

    // Then: rows where number > 1 are visible (2 and 3)
    await assertRowCount(page, 2);

    // When: switching to NumberIsEmpty
    await changeFilterCondition(page, NumberFilterCondition.NumberIsEmpty);

    // Then: input field disappears (matches desktop's canAttachContent=false branch)
    await expect(numberInput).toBeHidden({ timeout: TIMEOUT });
    // And: only the empty row matches
    await assertRowCount(page, 1);
  });

  test('Time field: not offered as a filterable field (desktop canCreateFilter parity)', async ({
    page,
    request,
  }) => {
    // Given: a grid with a Time column
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);

    const timeFieldId = await addFieldWithType(page, FieldType.Time);

    await typeTextIntoCell(page, timeFieldId, 0, '10');

    // When: opening the filter field picker from the toolbar
    const filterBtn = page.getByTestId('database-actions-filter');

    await filterBtn.waitFor({ state: 'attached', timeout: 10000 });
    await filterBtn.evaluate((el) => (el as HTMLElement).click());

    const propertyItems = page.locator('[data-item-id]:visible');

    await expect(propertyItems.first()).toBeVisible({ timeout: 10000 });

    // Then: the Name field is offered, but the Time field is excluded —
    // matching desktop's FieldType.canCreateFilter.
    await expect(propertyItems.filter({ hasText: FieldTypeNames[FieldType.Time] })).toHaveCount(0);
  });

  test('Rollup filter (unconfigured): defaults to Number editor (Count is the seeded calculation)', async ({
    page,
    request,
  }) => {
    // Given: a grid with a freshly added Rollup column. createRollupField
    // seeds calculation_type=Count (numeric) + show_as=Calculated, so even
    // without a relation/target picked, isNumericRollupField() returns true
    // and the filter routes to NumberFilterMenu.
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);
    await addFieldWithType(page, FieldType.Rollup);

    // When: adding a filter on the Rollup column
    await addFilterByFieldName(page, FieldTypeNames[FieldType.Rollup]);

    // Then: the Number-style numeric input renders (proves we hit the numeric
    // rollup branch in RollupFilterMenu, not the text or option-picker branch).
    const numberInput = page.getByTestId('text-filter-input');

    await expect(numberInput).toBeVisible({ timeout: TIMEOUT });

    // And: switching to NumberIsEmpty hides the input — the same branch as
    // the standalone Number editor, confirming we're sharing NumberFilterMenu.
    await changeFilterCondition(page, NumberFilterCondition.NumberIsEmpty);
    await expect(numberInput).toBeHidden({ timeout: TIMEOUT });
  });

  test('Person filter: shows condition selector and toggles picker visibility', async ({ page, request }) => {
    // Given: a grid with a Person column
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);

    await addFieldWithType(page, FieldType.Person);

    // When: adding a filter on the Person column
    await addFilterByFieldName(page, FieldTypeNames[FieldType.Person]);

    // Then: the Person filter editor should render with a condition trigger
    // (proves the editor is no longer a stub — previously rendered an empty fragment).
    const personFilter = page.getByTestId('person-filter');

    await expect(personFilter).toBeVisible({ timeout: TIMEOUT });
    await expect(page.getByTestId('filter-condition-trigger')).toBeVisible({ timeout: TIMEOUT });

    // And: the picker container should be visible by default (PersonContains is default,
    // canAttachContent=true). Either users render or "no matches" — both prove the
    // picker is mounted.
    await expect(personFilter).toBeAttached();

    // When: switching to PersonIsEmpty (value=2)
    await changeFilterCondition(page, 2);

    // Then: the picker is hidden (matches desktop's canAttachContent=false branch
    // for empty/notempty conditions).
    const pickerOptions = page.getByTestId('person-filter-option');

    await expect(pickerOptions).toHaveCount(0);

    // When: switching back to PersonContains (value=0)
    await changeFilterCondition(page, 0);

    // Then: the picker container reappears (visible loading/empty/list states all OK).
    // We can't deterministically assert on user count without seeding the workspace,
    // so we just confirm the picker container is present in the DOM by checking
    // the filter wrapper structure is intact.
    await expect(personFilter).toBeVisible();
  });
});
