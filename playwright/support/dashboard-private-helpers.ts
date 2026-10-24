/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
/**
 * Unsaved (private) dashboard changes (WP07): the orange dots, the filter
 * bar's Reset and "Save for everyone ˅", the widget popovers' footer, the
 * "Changes saved for everyone." toast, the device-local storage and the P0-5
 * footers and prefill.
 */
import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test';

import {
  apiGet,
  apiHeaders,
  pressEscapeUntilHidden,
  WIDGET_TIMEOUT,
  WIDGET_TIMEOUT_MS,
} from './dashboard-shared-helpers';
import {
  dashboardViewId,
  dashboardWorld,
  DashboardSelectors,
  databaseForLabel,
  fixtureDatabase,
  globalFilterChip,
  knownWidget,
  viewIdForLabel,
  waitForDatabaseContext,
} from './dashboard-test-helpers';
import { DatabaseFilterSelectors } from './selectors';
import { TestConfig } from './test-config';

/** `af.dashboard.private.v1:{workspaceId}:{uid}:{dashboardViewId}` (WP07 §3.1). */
export const PRIVATE_STORAGE_PREFIX = 'af.dashboard.private.v1';

export const PrivateSelectors = {
  saveMenuTrigger: (page: Page) => page.getByTestId('dashboard-global-filter-save-menu-trigger'),
  saveMenu: (page: Page) => page.getByTestId('dashboard-global-filter-save-menu'),
  saveMenuSave: (page: Page) => page.getByTestId('dashboard-save-menu-save'),
  saveMenuResetAll: (page: Page) => page.getByTestId('dashboard-save-menu-reset-all'),
  toast: (page: Page) => page.getByTestId('dashboard-saved-toast'),
  toastUndo: (page: Page) => page.getByTestId('dashboard-saved-toast-undo'),
  buttonDot: (page: Page) => page.getByTestId('dashboard-global-filter-button-dot'),
  chipDot: (chip: Locator) => chip.getByTestId('dashboard-global-filter-chip-dot'),
  widgetFilterDot: (widget: Locator) => widget.getByTestId('database-actions-filter-dot'),
  widgetSortDot: (widget: Locator) => widget.getByTestId('database-actions-sort-dot'),
  widgetFooter: (page: Page) => page.getByTestId('dashboard-widget-private-footer'),
  widgetFooterReset: (page: Page) => page.getByTestId('dashboard-widget-private-reset'),
  widgetFooterSave: (page: Page) => page.getByTestId('dashboard-widget-save-for-everyone'),
};

/** The filter bar's controls by their label. */
const BAR_CONTROLS: Record<string, (page: Page) => Locator> = {
  Reset: (page) => DashboardSelectors.globalFilterReset(page),
  'Save for everyone': (page) => DashboardSelectors.globalFilterSaveForEveryone(page),
};

export function filterBarControl(scope: Page, label: string): Locator {
  const control = BAR_CONTROLS[label];

  if (!control) throw new Error(`The filter bar has no "${label}" control`);
  return control(scope);
}

// ---------------------------------------------------------------------------
// Dots and controls
// ---------------------------------------------------------------------------

/** Some part of the dashboard differs from its saved state: a dot and the bar's controls show. */
export async function expectUnsavedChanges(scope: Page) {
  await expect(DashboardSelectors.unsavedDots(scope).first()).toBeVisible(WIDGET_TIMEOUT);
  await expect(DashboardSelectors.privateControls(scope)).toBeVisible();
  await expect(DashboardSelectors.globalFilterReset(scope)).toBeVisible();
}

export async function expectNoUnsavedDots(scope: Page) {
  await expect(DashboardSelectors.unsavedDots(scope)).toHaveCount(0, WIDGET_TIMEOUT);
}

export async function expectChipDot(scope: Page, name: string) {
  const chip = globalFilterChip(scope, name);

  await expect(chip).toBeVisible(WIDGET_TIMEOUT);
  await expect(chip).toHaveAttribute('data-unsaved', 'true');
  await expect(PrivateSelectors.chipDot(chip)).toBeVisible();
}

/** A reader sees Reset, but no "Save for everyone" (nor its menu). */
export async function expectResetWithoutSave(scope: Page) {
  await expect(DashboardSelectors.privateControls(scope)).toBeVisible(WIDGET_TIMEOUT);
  await expect(DashboardSelectors.globalFilterReset(scope)).toHaveText('Reset');
  await expect(DashboardSelectors.globalFilterSaveForEveryone(scope)).toHaveCount(0);
  await expect(PrivateSelectors.saveMenuTrigger(scope)).toHaveCount(0);
}

export function widgetOf(scope: Page, owner: Page, label: string): Locator {
  return DashboardSelectors.widget(scope, knownWidget(owner, label).id);
}

// ---------------------------------------------------------------------------
// Save and Reset
// ---------------------------------------------------------------------------

export async function clickFilterBarControl(scope: Page, label: string) {
  const control = filterBarControl(scope, label);

  await expect(control).toBeVisible(WIDGET_TIMEOUT);
  await control.click();
}

export async function chooseFromSaveMenu(scope: Page, item: string) {
  const items: Record<string, (page: Page) => Locator> = {
    'Save for everyone': PrivateSelectors.saveMenuSave,
    'Reset all changes': PrivateSelectors.saveMenuResetAll,
  };
  const entry = items[item];

  if (!entry) throw new Error(`The Save menu has no "${item}" item`);
  await PrivateSelectors.saveMenuTrigger(scope).click();
  await expect(PrivateSelectors.saveMenu(scope)).toBeVisible();
  await entry(scope).click();
  await expect(PrivateSelectors.saveMenu(scope)).toBeHidden();
}

/** Open a widget's Filters (or Sorts) popover from its tool; the tool shows while it is dirty. */
export async function openWidgetConditionsPopover(
  scope: Page,
  owner: Page,
  label: string,
  kind: 'filters' | 'sorts'
): Promise<Locator> {
  const widget = widgetOf(scope, owner, label);
  const popover = scope.getByTestId(`dashboard-widget-${kind}-popover`);

  if (await popover.isVisible()) return popover;
  await expect(widget).toBeVisible(WIDGET_TIMEOUT);
  await widget.hover();
  await widget.getByTestId(kind === 'filters' ? 'database-actions-filter' : 'database-actions-sort').click();
  await expect(popover).toBeVisible();
  return popover;
}

/** "Reset" or "Save for everyone" in the footer of a widget's Filters popover; the popover is closed after (×). */
export async function clickWidgetPopoverControl(scope: Page, owner: Page, label: string, control: string) {
  const popover = await openWidgetConditionsPopover(scope, owner, label, 'filters');
  const footer = popover.getByTestId('dashboard-widget-private-footer');
  const button =
    control === 'Reset'
      ? footer.getByTestId('dashboard-widget-private-reset')
      : control === 'Save for everyone'
      ? footer.getByTestId('dashboard-widget-save-for-everyone')
      : null;

  if (!button) throw new Error(`The widget popover footer has no "${control}" button`);
  await expect(button).toHaveText(control);
  await button.click();
  await expect(footer).toBeHidden();
  // The popover's own close button: Escape would also dismiss the "saved" toast.
  await popover.getByTestId('dashboard-widget-filters-popover-close').click();
  await expect(popover).toBeHidden();
}

export async function expectSavedToast(scope: Page, message: string, undo: string) {
  const toast = PrivateSelectors.toast(scope);

  await expect(toast).toBeVisible(WIDGET_TIMEOUT);
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast).toContainText(message);
  await expect(PrivateSelectors.toastUndo(scope)).toHaveText(undo);
}

export async function clickToastUndo(scope: Page) {
  await PrivateSelectors.toastUndo(scope).click();
  await expect(PrivateSelectors.toast(scope)).toBeHidden();
}

// ---------------------------------------------------------------------------
// Device-local storage
// ---------------------------------------------------------------------------

/**
 * The signed-in owner's uid as the app keeps it (`resolveCurrentUserUid`):
 * the exact `uid_string`, else `uid` (exact while it is a safe integer, else
 * the rounded number the app read).
 */
export async function ownerUid(page: Page, request: APIRequestContext): Promise<string> {
  const world = dashboardWorld(page);
  const response = await request.get(`${TestConfig.apiUrl}/api/user/profile`, {
    headers: apiHeaders(world.owner.accessToken),
    failOnStatusCode: false,
  });
  // Uids exceed Number.MAX_SAFE_INTEGER: read the digits from the text, never through JSON.parse.
  const text = await response.text();
  const exact = /"uid_string"\s*:\s*"(\d+)"/.exec(text)?.[1];
  const digits = /"uid"\s*:\s*"?(\d+)"?/.exec(text)?.[1];

  if (!response.ok() || (!exact && !digits)) {
    throw new Error(`Reading the owner's profile failed: HTTP ${response.status()} ${text}`);
  }

  if (exact) return exact;
  const number = Number(digits);

  return Number.isSafeInteger(number) ? String(digits) : String(number);
}

export async function privateStorageKey(page: Page, request: APIRequestContext): Promise<string> {
  const world = dashboardWorld(page);

  return `${PRIVATE_STORAGE_PREFIX}:${world.workspaceId}:${await ownerUid(page, request)}:${dashboardViewId(page)}`;
}

/** Leave a payload this device cannot read under the dashboard's key; the next load ignores and removes it. */
export async function writeUnreadablePrivateState(page: Page, request: APIRequestContext) {
  const key = await privateStorageKey(page, request);

  await page.evaluate((storageKey) => window.localStorage.setItem(storageKey, '{not json'), key);
  return key;
}

export async function readPrivateStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
}

// ---------------------------------------------------------------------------
// Footer calculations (P0-5)
// ---------------------------------------------------------------------------

/** `CalculationType` by menu name. */
export const CALCULATION_TYPE: Record<string, number> = { sum: 4 };

export function fieldIdFor(page: Page, label: string, property: string): string {
  const fieldId = fixtureDatabase(page, databaseForLabel(page, label)).fieldIds[property];

  if (!fieldId) throw new Error(`The ${label} fixture has no "${property}" property`);
  return fieldId;
}

/** The value of a footer calculation cell. */
export function footerValue(scope: Page | Locator, fieldId: string): Locator {
  return scope.getByTestId(`grid-calculate-cell-${fieldId}`).last().locator('span').last();
}

/** The calculation the source view stores for `property` (shared by everyone). */
export async function readSharedCalculation(
  page: Page,
  label: string,
  property: string
): Promise<{ type: number; value: string } | null> {
  const database = fixtureDatabase(page, databaseForLabel(page, label));

  return page.evaluate(
    ({ databaseId, viewId, fieldId }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const view = bridge?.byDatabase(databaseId)?.databaseDoc.getMap('data').get('database')?.get('views')?.get(viewId);
      const calculations = view?.get('calculations');
      const item = calculations?.toArray().find((entry: any) => entry.get('field_id') === fieldId);

      return item ? { type: Number(item.get('ty')), value: String(item.get('calculation_value') ?? '') } : null;
    },
    { databaseId: database.databaseId, viewId: viewIdForLabel(page, label), fieldId: fieldIdFor(page, label, property) }
  );
}

/**
 * Give a view a footer calculation through its full grid page, where a writer's
 * grid computes and stores the shared value, then come back to the dashboard.
 */
export async function calculateOnViewPage(
  page: Page,
  label: string,
  property: string,
  calculation: string,
  reopenDashboard: () => Promise<void>
) {
  const type = CALCULATION_TYPE[calculation.toLowerCase()];

  if (type === undefined) throw new Error(`Unknown calculation "${calculation}"`);
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseForLabel(page, label));
  const fieldId = fieldIdFor(page, label, property);

  await page.goto(`/app/${world.workspaceId}/${database.pageId}?v=${viewIdForLabel(page, label)}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForDatabaseContext(page, database.databaseId);
  const footer = page.getByTestId(`grid-calculate-cell-${fieldId}`).last();

  await expect(footer).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await footer.scrollIntoViewIfNeeded();
  await footer.click();
  await page.getByTestId(`calculation-option-${type}`).last().click();
  await expect.poll(async () => (await readSharedCalculation(page, label, property))?.type, WIDGET_TIMEOUT).toBe(type);
  await expect
    .poll(async () => (await readSharedCalculation(page, label, property))?.value ?? '', WIDGET_TIMEOUT)
    .not.toBe('');
  await reopenDashboard();
}

// ---------------------------------------------------------------------------
// Widget filters
// ---------------------------------------------------------------------------

/** Add a checkbox filter (Is checked) from a widget's Filter tool, then close the popover. */
export async function addWidgetCheckboxFilter(scope: Page, owner: Page, label: string, property: string) {
  const widget = widgetOf(scope, owner, label);
  const popover = scope.getByTestId('dashboard-widget-filters-popover');

  await expect(widget).toBeVisible(WIDGET_TIMEOUT);
  await widget.hover();
  await widget.getByTestId('database-actions-filter').click();
  await DatabaseFilterSelectors.propertyItemByName(scope, property).filter({ visible: true }).first().click();
  const checked = scope.getByTestId('checkbox-filter').getByTestId('filter-condition-0');

  await expect(checked).toBeVisible();
  // "Checked" (CheckboxFilterCondition.IsChecked) closes the rule editor.
  await checked.click();
  await expect(widget.getByTestId('database-actions-filter')).toHaveAttribute('data-active', 'true');
  await pressEscapeUntilHidden(scope, popover);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** A row's cells as the Cloud API returns them (by property name). */
export async function readRowCells(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  title: string
): Promise<Record<string, unknown>> {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);
  const rowId = database.rowIds[title];

  if (!rowId) throw new Error(`No row named "${title}" in ${databaseName}`);
  const details = await apiGet<{ id: string; cells: Record<string, unknown> }[]>(
    request,
    world.owner.accessToken,
    `/api/workspace/${world.workspaceId}/database/${database.databaseId}/row/detail?ids=${rowId}`
  );

  return details[0]?.cells ?? {};
}

/** A checkbox cell as the API returns it (`true`, `"Yes"`, `"true"`…). */
export function isCheckedCell(value: unknown): boolean {
  if (value === true) return true;
  return ['yes', 'true', '1'].includes(String(value ?? '').trim().toLowerCase());
}

/** A select cell's option names (the API returns names, or an object with them). */
export function selectCellNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String((item as { name?: string })?.name ?? item));
  if (value && typeof value === 'object') {
    const options = (value as { select_options?: { name: string }[]; options?: { name: string }[] }).select_options;

    return (options ?? (value as { options?: { name: string }[] }).options ?? []).map((option) => option.name);
  }

  return String(value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}
