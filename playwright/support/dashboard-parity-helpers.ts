/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
/**
 * Compatibility (WP01) helpers: write and read a view's raw layout-settings
 * map the way a newer app version would, so scenarios can check that this
 * client keeps the settings it does not understand. The probe values match
 * `dashboard-parity/layouts/unknown-keys.json` and the desktop
 * `dashboard_parity_test_op.dart`.
 */
import { expect, Page } from '@playwright/test';

import { canonicalJson } from './dashboard-shared-helpers';
import { dashboardViewId, DASHBOARD_LAYOUT_KEY } from './dashboard-test-helpers';

/** A setting only a newer app version understands. */
export const PARITY_PROBE = { from: 'newer-app', version: 99, list: ['a', 'b'], nested: { flag: true } };
/** An enum value only a newer app version understands. */
export const PARITY_ENUM = 'neon';
/** The unknown key every probe is stored under. */
export const PARITY_PROBE_KEY = 'zz_parity_probe';

type LayoutKey = '3' | '9';

/**
 * Merge `entries` into `layout_settings[layoutKey]` of a view, key by key and in
 * one transaction of the database doc that holds the view (created when
 * missing). Values are plain JSON, as a native client stores them.
 */
export async function mergeRawLayout(
  page: Page,
  viewId: string,
  layoutKey: LayoutKey,
  entries: Record<string, unknown>
) {
  await page.evaluate(
    ({ viewId, layoutKey, entries }) => {
      const win = window as any;
      const ctx = win.__DASHBOARD_TEST__?.byView(viewId);

      if (!ctx) throw new Error(`No mounted database doc holds view ${viewId}`);
      const Yjs = win.Y;
      const doc = ctx.databaseDoc;
      const view = doc.getMap('data').get('database').get('views').get(viewId);

      doc.transact(() => {
        let layouts = view.get('layout_settings');

        if (!layouts) {
          layouts = new Yjs.Map();
          view.set('layout_settings', layouts);
        }

        let setting = layouts.get(layoutKey);

        if (!setting) {
          setting = new Yjs.Map();
          layouts.set(layoutKey, setting);
        }

        Object.entries(entries).forEach(([key, value]) => setting.set(key, value));
      });
    },
    { viewId, layoutKey, entries }
  );
}

/** `layout_settings[layoutKey]` of a view as plain JSON (native integers read as numbers). */
export async function readRawLayout(page: Page, viewId: string, layoutKey: LayoutKey): Promise<Record<string, any>> {
  const layout = await page.evaluate(
    ({ viewId, layoutKey }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const ctx = bridge?.byView(viewId);

      if (!ctx) return null;
      const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(viewId);
      const plain = bridge.plain(view?.get('layout_settings')?.get(layoutKey)) ?? {};

      return JSON.parse(JSON.stringify(plain, (_key, value) => (typeof value === 'bigint' ? Number(value) : value)));
    },
    { viewId, layoutKey }
  );

  if (!layout) throw new Error(`No mounted database doc holds view ${viewId}`);
  return layout as Record<string, any>;
}

/**
 * Store settings from a newer app version on the scenario's dashboard: a
 * top-level probe, `{ row: <id> }` on every row and `{ widget: <id> }` on every
 * widget.
 */
export async function seedDashboardProbes(page: Page) {
  const viewId = dashboardViewId(page);
  const layout = await readRawLayout(page, viewId, DASHBOARD_LAYOUT_KEY);
  const rows = ((layout.rows ?? []) as Record<string, any>[]).map((row) => ({
    ...row,
    [PARITY_PROBE_KEY]: { row: row.id },
    widgets: ((row.widgets ?? []) as Record<string, any>[]).map((widget) => ({
      ...widget,
      [PARITY_PROBE_KEY]: { widget: widget.id },
    })),
  }));

  expect(rows.length, 'the dashboard has no rows to probe').toBeGreaterThan(0);
  await mergeRawLayout(page, viewId, DASHBOARD_LAYOUT_KEY, { rows, [PARITY_PROBE_KEY]: PARITY_PROBE });
  await expectDashboardProbes(page);
}

/** Every probe `seedDashboardProbes` stored is still there, on the row or widget with the same id. */
export async function expectDashboardProbes(page: Page) {
  const viewId = dashboardViewId(page);

  await expect
    .poll(
      async () => {
        const layout = await readRawLayout(page, viewId, DASHBOARD_LAYOUT_KEY);
        const missing: string[] = [];
        const check = (where: string, actual: unknown, expected: unknown) => {
          if (canonicalJson(actual) !== canonicalJson(expected)) missing.push(`${where}: ${canonicalJson(actual)}`);
        };

        check('dashboard', layout[PARITY_PROBE_KEY], PARITY_PROBE);
        ((layout.rows ?? []) as Record<string, any>[]).forEach((row) => {
          check(`row ${row.id}`, row[PARITY_PROBE_KEY], { row: row.id });
          ((row.widgets ?? []) as Record<string, any>[]).forEach((widget) =>
            check(`widget ${widget.id}`, widget[PARITY_PROBE_KEY], { widget: widget.id })
          );
        });
        return missing;
      },
      { message: 'settings from the newer app version that were lost' }
    )
    .toEqual([]);
}
