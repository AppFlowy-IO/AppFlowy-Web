/**
 * The property-first global filter menu, the pills and their editor (WP08).
 *
 * The toolbar's Filter button (and the bar's `+ Filter`) open "Filter by…": a
 * search box and the dashboard's properties, flat for one source or grouped by
 * source. A pick creates a filter for that one source and opens its pill's
 * editor; "Filter multiple sources" builds one filter across same-type
 * properties. Readers get the list of the dashboard's filters instead.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { escapeRegExp, WIDGET_TIMEOUT_MS } from './dashboard-shared-helpers';
import {
  DASHBOARD_FIXTURE_DATABASES,
  DashboardSelectors,
  fixtureDatabase,
  FieldType,
  globalFilterChip,
  openGlobalFilterChip,
  readDashboardSetting,
  type PersistedGlobalFilter,
} from './dashboard-test-helpers';

/** A persisted global filter with the WP08 key (`option_names`, read only as an array of strings). */
export type PersistedGlobalFilterWithNames = PersistedGlobalFilter & { option_names?: unknown };

/** The default condition of a new filter of each fixture property type (WP08 §1.3). */
const DEFAULT_CONDITION: Partial<Record<FieldType, number>> = {
  [FieldType.RichText]: 2, // TextContains
  [FieldType.Number]: 0, // Equal
  [FieldType.SingleSelect]: 0, // OptionIs
  [FieldType.MultiSelect]: 2, // OptionContains
  [FieldType.Checkbox]: 0, // IsChecked
  [FieldType.DateTime]: 0, // DateStartsOn
};

function exactText(text: string) {
  return new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
}

/** The type of a fixture property ("Region" in "Projects"). */
export function fixturePropertyType(database: string, property: string): FieldType {
  if (property === 'Name') return FieldType.RichText;
  const field = DASHBOARD_FIXTURE_DATABASES[database]?.fields.find((candidate) => candidate.name === property);

  if (!field) throw new Error(`The fixture "${database}" has no "${property}" property`);
  return field.type;
}

export function defaultGlobalFilterCondition(type: FieldType): number {
  const condition = DEFAULT_CONDITION[type];

  if (condition === undefined) throw new Error(`No default global filter condition for type ${type}`);
  return condition;
}

// ---------------------------------------------------------------------------
// The menu ("Filter by…")
// ---------------------------------------------------------------------------

/** The scope whose global filter menu is open: the member's browser when it shows one, else the owner's. */
export async function openMenuScope(page: Page, member?: Page): Promise<Page> {
  if (member && (await DashboardSelectors.globalFilterMenu(member).isVisible())) return member;
  return page;
}

/** The menu row of `property` in `database`; the primary property has no fixture id and is matched by name. */
export function globalFilterFieldRow(scope: Page, owner: Page, database: string, property: string): Locator {
  const fixture = fixtureDatabase(owner, database);
  const fieldId = fixture.fieldIds[property];

  return fieldId
    ? DashboardSelectors.globalFilterFieldOption(scope, fixture.databaseId, fieldId)
    : scope
        .locator(`[data-testid="dashboard-global-filter-field-option"][data-database-id="${fixture.databaseId}"]`)
        .filter({ hasText: exactText(property) })
        .first();
}

export async function pickGlobalFilterProperty(scope: Page, owner: Page, database: string, property: string) {
  const row = globalFilterFieldRow(scope, owner, database, property);

  await expect(row, `the filter menu offers no "${property}" in "${database}"`).toBeVisible({
    timeout: WIDGET_TIMEOUT_MS,
  });
  await row.click();
}

/** Database ids of the property rows the menu shows, in order. */
export async function listedFieldOptions(scope: Page): Promise<{ databaseId: string; fieldId: string; name: string }[]> {
  return DashboardSelectors.globalFilterFieldOptions(scope).evaluateAll((rows) =>
    rows.map((row) => ({
      databaseId: row.getAttribute('data-database-id') ?? '',
      fieldId: row.getAttribute('data-field-id') ?? '',
      name: (row.textContent ?? '').trim(),
    }))
  );
}

/** The menu's source groups, in order: database id and the "N view(s)" text. */
export async function listedSourceGroups(scope: Page): Promise<{ databaseId: string; text: string }[]> {
  return DashboardSelectors.globalFilterSourceGroups(scope).evaluateAll((groups) =>
    groups.map((group) => ({
      databaseId: group.getAttribute('data-database-id') ?? '',
      // The source name and "N view(s)" are separate spans.
      text: Array.from(group.children)
        .map((part) => (part.textContent ?? '').trim())
        .filter(Boolean)
        .join(' '),
    }))
  );
}

/** The menu's property rows of one source. */
export function fieldRowsOf(scope: Page, databaseId: string): Locator {
  return scope.locator(`[data-testid="dashboard-global-filter-field-option"][data-database-id="${databaseId}"]`);
}

// ---------------------------------------------------------------------------
// The pill and its editor
// ---------------------------------------------------------------------------

/** The pill of the filter whose editor is open. */
export async function openPill(scope: Page): Promise<Locator> {
  const editor = DashboardSelectors.globalFilterPillEditor(scope);

  await expect(editor).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  const filterId = await editor.getAttribute('data-filter-id');

  return scope.locator(`[data-testid="dashboard-global-filter-chip"][data-filter-id="${filterId}"]`);
}

export function pillLabel(chip: Locator): Locator {
  return chip.getByTestId('dashboard-global-filter-chip-label');
}

/** Toggle a merged option of the open select filter by its name and wait for its new state. */
export async function toggleGlobalFilterOptionByName(scope: Page, name: string, checked?: boolean) {
  const option = DashboardSelectors.globalFilterContent(scope)
    .getByTestId('dashboard-global-filter-option')
    .filter({ hasText: exactText(name) });

  await expect(option).toHaveCount(1, { timeout: WIDGET_TIMEOUT_MS });
  const before = (await option.getAttribute('data-checked')) === 'true';

  if (checked !== undefined && before === checked) return;
  await option.click();
  await expect(option).toHaveAttribute('data-checked', before ? 'false' : 'true');
}

/** The names of the merged options the open select filter offers, in order. */
export async function offeredOptionNames(scope: Page): Promise<string[]> {
  return DashboardSelectors.globalFilterContent(scope)
    .getByTestId('dashboard-global-filter-option')
    .evaluateAll((options) => options.map((option) => (option.textContent ?? '').trim()));
}

/** `···` of the open pill editor (writers). */
export async function openGlobalFilterActions(scope: Page) {
  await DashboardSelectors.globalFilterMoreActions(scope).click();
  await expect(DashboardSelectors.globalFilterDelete(scope)).toBeVisible();
}

/** Delete the open filter through `···` → Delete filter; the popover closes. */
export async function deleteOpenGlobalFilter(scope: Page) {
  await openGlobalFilterActions(scope);
  await DashboardSelectors.globalFilterDelete(scope).click();
  await expect(DashboardSelectors.globalFilterMenu(scope)).toBeHidden();
}

export async function deleteGlobalFilter(scope: Page, name: string) {
  await openGlobalFilterChip(scope, name);
  await deleteOpenGlobalFilter(scope);
  await expect(globalFilterChip(scope, name)).toHaveCount(0, { timeout: WIDGET_TIMEOUT_MS });
}

const DIRECTIONS: Record<string, 'past' | 'this' | 'next'> = { past: 'past', this: 'this', next: 'next' };
const UNITS: Record<string, 'day' | 'week' | 'month' | 'year'> = {
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  month: 'month',
  months: 'month',
  year: 'year',
  years: 'year',
};

export interface RelativeDateInput {
  direction: 'past' | 'this' | 'next';
  amount: number;
  unit: 'day' | 'week' | 'month' | 'year';
}

/** "Past", 7, "days" → the relative spec. */
export function parseRelativeDateInput(direction: string, amount: number, unit: string): RelativeDateInput {
  const parsedDirection = DIRECTIONS[direction.trim().toLowerCase()];
  const parsedUnit = UNITS[unit.trim().toLowerCase()];

  if (!parsedDirection) throw new Error(`Unknown relative direction "${direction}"`);
  if (!parsedUnit) throw new Error(`Unknown relative unit "${unit}"`);
  return { direction: parsedDirection, amount, unit: parsedUnit };
}

/** The pill and chip summary of a relative spec (WP08 §1.10): "This month", "Past week", "Next 3 days". */
export function relativeDateSummary({ direction, amount, unit }: RelativeDateInput): string {
  if (direction === 'this') return `This ${unit}`;
  const word = direction === 'past' ? 'Past' : 'Next';

  return amount === 1 ? `${word} ${unit}` : `${word} ${amount} ${unit}s`;
}

/**
 * Drive a `RelativeDateFilterBuilder` (`testIdPrefix` is
 * `dashboard-global-filter` in the pill editor and `date-filter` in the view
 * filter menus): the direction, the unit, then the amount (debounced).
 */
export async function setRelativeDate(scope: Page, testIdPrefix: string, spec: RelativeDateInput) {
  const direction = scope.getByTestId(`${testIdPrefix}-relative-direction`).filter({ visible: true }).last();
  const unit = scope.getByTestId(`${testIdPrefix}-relative-unit`).filter({ visible: true }).last();

  await expect(direction).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  if ((await direction.getAttribute('data-value')) !== spec.direction) {
    await direction.click();
    await scope
      .locator(`[data-testid="${testIdPrefix}-relative-direction-option"][data-value="${spec.direction}"]`)
      .click();
    await expect(direction).toHaveAttribute('data-value', spec.direction);
  }

  if ((await unit.getAttribute('data-value')) !== spec.unit) {
    await unit.click();
    await scope.locator(`[data-testid="${testIdPrefix}-relative-unit-option"][data-value="${spec.unit}"]`).click();
    await expect(unit).toHaveAttribute('data-value', spec.unit);
  }

  if (spec.direction === 'this') return;
  const amount = scope.getByTestId(`${testIdPrefix}-relative-amount`).filter({ visible: true }).last();

  await amount.fill(String(spec.amount));
  await expect(amount).toHaveValue(String(spec.amount));
}

// ---------------------------------------------------------------------------
// Saved filters
// ---------------------------------------------------------------------------

export async function savedGlobalFilter(page: Page, name: string): Promise<PersistedGlobalFilterWithNames | undefined> {
  return (await readDashboardSetting(page)).global_filters.find((filter) => filter.name === name);
}
