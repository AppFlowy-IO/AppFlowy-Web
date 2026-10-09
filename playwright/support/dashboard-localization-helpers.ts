/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values written inside page.evaluate are untyped. */
/**
 * WP14c localization BDD (`dashboard-localization.feature`, shared wording with
 * the desktop `dashboard_localization.feature`).
 *
 * - The app language is chosen the way a user does: Account settings, the
 *   language picker (`AccountAppPanel.handleSelectLanguage`). The choice is
 *   saved to the profile, so a reload keeps it. Scenario language ids are the
 *   shared table's (`zh-CN`, `ja-JP`, `en-US`); `en-US` is web `en`.
 * - Expected texts are never written in a step: "the "zh-CN" text for "Edit""
 *   is the translation `i18n/locales/zh-CN.json` gives the manifest concept
 *   whose English is "Edit", in web syntax.
 * - The Budget charts dashboard is built from `BUDGET_FIXTURE` and
 *   `BUDGET_CHART_VIEWS` without any translated UI text, so it works in any
 *   language.
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

import { APIRequestContext, expect, Page } from '@playwright/test';

import { ChartAggregationType, ChartType } from '../../src/application/database-yjs/chart-enums';
import { DateGroupCondition } from '../../src/application/database-yjs/database.type';
import { DatabaseViewLayout, ViewLayout } from '../../src/application/types';

import { ensureFixtureDatabase, ensureLayoutView } from './dashboard-platform-helpers';
import { pressEscapeUntilHidden, WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from './dashboard-shared-helpers';
import {
  addDashboardView,
  addFixtureDatabases,
  apiGet,
  BUDGET_FIXTURE,
  createDatabaseViewThroughApi,
  DashboardSelectors,
  type DatabaseSpec,
  dashboardWorld,
  expectDashboardMode,
  fixtureDatabase,
  leaveEditMode,
  openDatabasePage,
  peekDashboardWorld,
  prepareDashboardFixture,
  seedDashboardWidgets,
  widgetLocator,
} from './dashboard-test-helpers';
import { waitForViewSync } from './dashboard-usecase-helpers';
import { WorkspaceSelectors } from './selectors';

// ---------------------------------------------------------------------------
// The shared translation table
// ---------------------------------------------------------------------------

type CanonicalText = string | Record<string, string>;

interface Concept {
  id: string;
  web: string | null;
  desktop: string | null;
  en: CanonicalText;
}

interface Manifest {
  concepts: Concept[];
  locales: { id: string; web: string | null; desktop: string | null }[];
  english: { id: string; web: string | null; desktop: string | null }[];
}

const I18N_DIR = new URL('../../src/application/database-yjs/__fixtures__/dashboard-parity/i18n/', import.meta.url);
// The writer's placeholder conversion (canonical `{name}` / `{0}` → web `{{name}}` / `{}`), so the
// expected text is exactly what `pnpm i18n:dashboard` writes into the locale file.
const { toWebText } = createRequire(import.meta.url)('../../scripts/i18n/apply-dashboard-translations.cjs') as {
  toWebText(text: string): string;
};

let manifestCache: Manifest | undefined;

function readFixture<T>(path: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, I18N_DIR)), 'utf8')) as T;
}

function manifest(): Manifest {
  manifestCache ??= readFixture<Manifest>('manifest.json');
  return manifestCache;
}

function isEnglish(language: string): boolean {
  return manifest().english.some((entry) => [entry.id, entry.web, entry.desktop].includes(language));
}

/** The web language code of a scenario language id (`zh-CN` → `zh-CN`, `en-US` → `en`). */
export function webLanguage(language: string): string {
  const entry = isEnglish(language)
    ? manifest().english.find((candidate) => candidate.id === 'en')
    : manifest().locales.find((candidate) => candidate.id === language);

  if (!entry?.web) throw new Error(`"${language}" is not a web language of dashboard-parity/i18n/manifest.json`);
  return entry.web;
}

function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('.')));
}

/**
 * The web concept whose English is `english`. Several concepts can share an
 * English text ("Done" is the toolbar button and the global filter button);
 * then the one whose key sits directly under `namespace` (the surface the step
 * reads: `dashboard` for the toolbar, `dashboard.widget` for the widget menu)
 * is meant.
 */
export function conceptForEnglish(english: string, namespace: string): Concept {
  const candidates = manifest().concepts.filter((concept) => concept.web && concept.en === english);
  const scoped = candidates.filter((concept) => parentPath(concept.web as string) === namespace);
  const [concept] = scoped.length === 1 ? scoped : candidates.length === 1 ? candidates : [];

  if (!concept) {
    throw new Error(
      `No single web concept of the manifest reads "${english}" under "${namespace}": ` +
        `[${candidates.map((candidate) => candidate.id).join(', ')}]`
    );
  }

  return concept;
}

/** What the web app shows in `language` for the concept whose English is `english`. */
export function translatedText(language: string, english: string, namespace: string): string {
  const concept = conceptForEnglish(english, namespace);

  if (typeof concept.en !== 'string') throw new Error(`"${concept.id}" is a plural concept`);
  if (isEnglish(language)) return toWebText(concept.en);
  const translations = readFixture<Record<string, CanonicalText>>(`locales/${language}.json`);
  const text = translations[concept.id];

  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`i18n/locales/${language}.json has no translation for "${concept.id}"`);
  }

  return toWebText(text);
}

// ---------------------------------------------------------------------------
// The app language
// ---------------------------------------------------------------------------

/** One try at a step of the language choice (the whole choice is retried). */
const ATTEMPT_TIMEOUT_MS = 5_000;

/** A Given that builds its fixture through English menu entries ("Board" in the add-view menu). */
const SIDE_BY_SIDE_GIVEN = /^\S+ a dashboard of "([^"]+)" shows its "([^"]+)" and "([^"]+)" views side by side$/;

async function ensureSignedIn(page: Page, request: APIRequestContext) {
  if (!peekDashboardWorld(page)) await prepareDashboardFixture(page, request, []);
}

async function savedLanguage(request: APIRequestContext, token: string): Promise<unknown> {
  const profile = await apiGet<{ metadata?: Record<string, unknown> }>(request, token, '/api/user/profile');

  return profile.metadata?.language;
}

/**
 * Choose `language` in Account settings → Language, wait until the profile
 * holds it, and close Settings. Works over any page of the app, the open
 * dashboard included (it re-renders in the new language).
 */
export async function chooseAppLanguage(page: Page, request: APIRequestContext, language: string) {
  const code = webLanguage(language);
  const world = dashboardWorld(page);
  const dialog = page.getByTestId('settings-dialog');
  const option = page.getByTestId(`language-${code}`);
  const attempt = { timeout: ATTEMPT_TIMEOUT_MS };

  // Right after sign-in the app may still be settling (the new space, the first page), and a
  // re-render can close the menu or the dialog: the whole choice is retried until the profile holds it.
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      // A workspace menu left open by a failed try would close on the trigger click.
      await page.keyboard.press('Escape');
      await WorkspaceSelectors.dropdownTrigger(page).click(attempt);
      await page.getByTestId('settings-button').click(attempt);
      await expect(dialog).toBeVisible(attempt);
    }

    await dialog.getByTestId('settings-menu-account').click(attempt);
    if (!(await option.isVisible())) await dialog.getByTestId('language-dropdown').click(attempt);
    await option.click(attempt);
    await expect.poll(() => savedLanguage(request, world.owner.accessToken).catch(() => undefined), attempt).toBe(code);
  }).toPass({ timeout: WIDGET_TIMEOUT_MS * 2, intervals: [500, 1_000, 2_000] });
  await pressEscapeUntilHidden(page, dialog);
}

/**
 * "Given the app language is X": sign in, then choose X before the dashboard
 * opens. The shared side-by-side Given adds missing views through the add-view
 * menu by their English names, so the views a following side-by-side Given
 * names are added first; that Given then only opens the dashboard, in X.
 */
export async function setAppLanguageBeforeDashboard(
  page: Page,
  request: APIRequestContext,
  language: string,
  followingGivens: string[]
) {
  await ensureSignedIn(page, request);
  for (const text of followingGivens) {
    const match = SIDE_BY_SIDE_GIVEN.exec(text.trim());

    if (!match) continue;
    const [, database, ...layouts] = match;

    await ensureFixtureDatabase(page, request, database);
    for (const layout of layouts) await ensureLayoutView(page, database, layout);
  }

  await chooseAppLanguage(page, request, language);
}

// ---------------------------------------------------------------------------
// The Budget charts dashboard
// ---------------------------------------------------------------------------

interface ChartViewSpec {
  chartType: ChartType;
  aggregationType: ChartAggregationType;
  /** X property (bar charts). */
  x?: string;
  dateCondition?: DateGroupCondition;
  /** Aggregated property (Sum). */
  y?: string;
  /** Number chart value format. */
  numberFormat?: 'compact';
}

/** The chart views of `BUDGET_FIXTURE`, by view name. */
export const BUDGET_CHART_VIEWS: Record<string, ChartViewSpec> = {
  Monthly: {
    chartType: ChartType.Bar,
    aggregationType: ChartAggregationType.Count,
    x: 'Paid on',
    dateCondition: DateGroupCondition.Month,
  },
  Total: {
    chartType: ChartType.Number,
    aggregationType: ChartAggregationType.Sum,
    y: 'Amount',
    numberFormat: 'compact',
  },
};

const CHART_DATABASES: Record<string, { spec: DatabaseSpec; views: Record<string, ChartViewSpec> }> = {
  Budget: { spec: BUDGET_FIXTURE, views: BUDGET_CHART_VIEWS },
};

interface ChartLayout {
  viewId: string;
  map: Record<string, string | number | boolean>;
}

/** The chart layout map of a view (`layout_settings['3']`, the collab keys every client reads). */
function chartLayoutMap(view: ChartViewSpec, fieldIds: Record<string, string>): ChartLayout['map'] {
  const fieldId = (name?: string) => {
    if (!name) return '';
    const id = fieldIds[name];

    if (!id) throw new Error(`The chart property "${name}" is not a Budget field`);
    return id;
  };

  return {
    chart_type: view.chartType,
    x_field_id: fieldId(view.x),
    aggregation_type: view.aggregationType,
    ...(view.y ? { y_field_id: fieldId(view.y) } : {}),
    show_empty_values: false,
    cumulative: false,
    date_condition: view.dateCondition ?? DateGroupCondition.Month,
    ...(view.numberFormat ? { numberFormat: view.numberFormat } : {}),
  };
}

async function writeChartLayouts(page: Page, databaseId: string, layouts: ChartLayout[]) {
  await page.evaluate(
    ({ databaseId, layouts, layoutKey }) => {
      const win = window as any;
      const doc = win.__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const views = doc.getMap('data').get('database').get('views');

      doc.transact(() => {
        layouts.forEach(({ viewId, map }) => {
          const view = views.get(viewId);
          let settings = view.get('layout_settings');

          if (!settings) {
            settings = new win.Y.Map();
            view.set('layout_settings', settings);
          }

          const chart = new win.Y.Map();

          Object.entries(map).forEach(([key, value]) => chart.set(key, value));
          settings.set(layoutKey, chart);
        });
      });
    },
    { databaseId, layouts, layoutKey: String(DatabaseViewLayout.Chart) }
  );
}

/** Create the named chart views of a chart database and wait until the server holds their settings. */
async function addChartViews(page: Page, request: APIRequestContext, database: string, names: string[]) {
  const { views } = CHART_DATABASES[database];
  const { databaseId, fieldIds } = fixtureDatabase(page, database);
  const world = dashboardWorld(page);
  const layouts: ChartLayout[] = [];
  let prevViewId: string | undefined;

  await openDatabasePage(page, database);
  for (const name of names) {
    const viewId = await createDatabaseViewThroughApi(page, request, {
      database,
      name,
      folderLayout: ViewLayout.Chart,
      prevViewId,
    });

    prevViewId = viewId;
    layouts.push({ viewId, map: chartLayoutMap(views[name], fieldIds) });
    world.viewsByName = { ...world.viewsByName, [name]: { viewId, database } };
  }

  const write = () => writeChartLayouts(page, databaseId, layouts);

  await write();
  await waitForViewSync(
    page,
    request,
    database,
    layouts.map(({ viewId }) => viewId),
    write
  );
}

/**
 * "a dashboard of "Budget" shows its "Monthly" bar chart and its "Total"
 * number chart": the database and its two chart views, then a new dashboard
 * whose first row shows them side by side, open in View mode. The widgets are
 * labelled by their view names.
 */
export async function openChartsDashboard(
  page: Page,
  request: APIRequestContext,
  database: string,
  barView: string,
  numberView: string
) {
  const charts = CHART_DATABASES[database];

  if (!charts) throw new Error(`"${database}" is not a chart fixture database`);
  if (charts.views[barView]?.chartType !== ChartType.Bar) throw new Error(`"${database}" has no "${barView}" bar chart`);
  if (charts.views[numberView]?.chartType !== ChartType.Number) {
    throw new Error(`"${database}" has no "${numberView}" number chart`);
  }

  await ensureSignedIn(page, request);
  if (!dashboardWorld(page).databases[database]) {
    await addFixtureDatabases(page, request, [database], { [database]: charts.spec });
  }

  await addChartViews(page, request, database, [barView, numberView]);
  await addDashboardView(page, database);
  await seedDashboardWidgets(page, [
    { row: 1, label: barView },
    { row: 1, label: numberView },
  ]);
  await leaveEditMode(page);
  for (const label of [barView, numberView]) await expect(widgetLocator(page, label)).toBeVisible(WIDGET_TIMEOUT);
  await expectDashboardMode(page, 'View');
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export async function expectToolbarButtonText(page: Page, button: 'Edit' | 'Done', language: string, english: string) {
  const locator = button === 'Edit' ? DashboardSelectors.editButton(page) : DashboardSelectors.doneButton(page);

  await expect(locator).toHaveText(translatedText(language, english, 'dashboard'), WIDGET_TIMEOUT);
}

/** The open widget menu lists exactly these entries, in this order, in `language`. */
export async function expectWidgetMenuTexts(page: Page, language: string, english: string[]) {
  const menu = DashboardSelectors.widgetMenu(page);

  await expect(menu).toBeVisible(WIDGET_TIMEOUT);
  await expect(menu.getByRole('menuitem')).toHaveText(
    english.map((entry) => translatedText(language, entry, 'dashboard.widget')),
    WIDGET_TIMEOUT
  );
}

/** The category labels of a widget's chart as drawn (left to right), without their full-label tooltips. */
export async function expectAxisLabels(page: Page, label: string, expected: string[]) {
  const chart = widgetLocator(page, label).getByTestId('database-chart').first();

  await expect
    .poll(
      () =>
        chart
          .evaluate((element) =>
            Array.from(element.querySelectorAll('[data-testid="chart-category-label"]'))
              .map((tick) => ({
                x: tick.getBoundingClientRect().x,
                text: Array.from(tick.childNodes)
                  .filter((node) => node.nodeType === Node.TEXT_NODE)
                  .map((node) => node.textContent ?? '')
                  .join('')
                  .trim(),
              }))
              .sort((a, b) => a.x - b.x)
              .map((tick) => tick.text)
          )
          .catch(() => [] as string[]),
      { timeout: WIDGET_TIMEOUT_MS, message: `waiting for the "${label}" chart's axis labels` }
    )
    .toEqual(expected);
}
