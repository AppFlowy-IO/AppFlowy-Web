import { YDatabase, YjsDatabaseKey } from '@/application/types';

import {
  createDashboardRow,
  createDashboardWidget,
  initializeDashboardLayoutSetting,
  readDashboardLayoutSetting,
  updateDashboardLayoutSetting,
} from './dashboard-layout';
import { DASHBOARD_DEFAULT_ROW_HEIGHT, DASHBOARD_GRID_COLUMNS, DashboardRow } from './dashboard.type';

/**
 * The rows a view converted to Dashboard starts with (WP05 §1.6): its owned
 * copy as one full-width widget in one default-height row. Same shape as Rust
 * `seed_converted_dashboard_rows`; ids are `r:` / `w:` plus 8 nanoid chars
 * (`dashboard-parity/layouts/converted-seed.json`).
 */
export function seedConvertedDashboardRows(viewId: string, databaseId: string): DashboardRow[] {
  return [createDashboardRow([createDashboardWidget(viewId, databaseId, DASHBOARD_GRID_COLUMNS)], DASHBOARD_DEFAULT_ROW_HEIGHT)];
}

/** Whether the view's stored dashboard rows hold at least one valid widget. */
export function hasDashboardWidgets(database: YDatabase | undefined, viewId: string): boolean {
  return readDashboardLayoutSetting(database, viewId).rows.length > 0;
}

/**
 * Seed `viewId`'s dashboard setting with the converted view's copy, but only
 * when its stored rows are absent or hold no valid widget: a view converted
 * before keeps its rows. `global_filters` is written only when absent, and
 * every other key of the setting is kept. Returns whether it seeded.
 *
 * Callers run this in a non-undo transaction before the undoable layout
 * change, like `initializeDashboardLayoutSetting` (WAVES §4.1 item 21).
 */
export function seedConvertedDashboardLayout(
  database: YDatabase | undefined,
  viewId: string,
  seedViewId: string,
  databaseId: string
): boolean {
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);

  if (!view || hasDashboardWidgets(database, viewId)) return false;
  initializeDashboardLayoutSetting(view);
  updateDashboardLayoutSetting(view, { rows: seedConvertedDashboardRows(seedViewId, databaseId) });
  return true;
}
