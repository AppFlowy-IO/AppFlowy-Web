import { readFileSync } from 'fs';
import { dirname, join } from 'path';

import {
  CHART_CHECKBOX_COLORS,
  CHART_COLORLESS_BASE,
  CHART_GRID_DASH,
  CHART_NUMBER_COLOR_VARS,
  CHART_OPACITY_STEPS,
  CHART_OPTION_COLORS,
  CHART_SERIES_PALETTE,
  CHART_SINGLE_HUE,
} from '@/application/database-yjs/chart.type';
import {
  DASHBOARD_ADD_ROW_BUTTON_SIZE,
  DASHBOARD_BOARD_COLUMN_TINT_BLOCK_INDEX,
  DASHBOARD_CHART_GEOMETRY,
  DASHBOARD_COLUMN_GAP_PX,
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_DROP_INDICATOR_WIDTH,
  DASHBOARD_GEOMETRY,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DASHBOARD_MIN_ROW_HEIGHT,
  DASHBOARD_MIN_WIDGET_WIDTH,
  DASHBOARD_MOTION,
  DASHBOARD_ROW_CONTROL_OFFSET,
  DASHBOARD_ROW_CONTROL_SIZE,
  DASHBOARD_ROW_HEIGHT_SNAP,
  DASHBOARD_TYPOGRAPHY,
  DASHBOARD_WIDGET_BOX_BLEED,
  DASHBOARD_WIDGET_HEADER_HEIGHT,
} from '@/application/database-yjs/dashboard-geometry';
import { DASHBOARD_LOADING } from '@/application/database-yjs/dashboard-loading';
import * as dashboardType from '@/application/database-yjs/dashboard.type';
import { SelectOptionColor } from '@/application/database-yjs/fields/select-option/select_option.type';
import { DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP } from '@/components/database/dashboard/constants';

import {
  loadParityFixture,
  parseCssRules,
  parseCssShadows,
  parseCssVariables,
  resolveCssColor,
  type ParsedShadow,
} from './dashboard-parity-helpers';

type Theme = 'light' | 'dark';

interface ColorToken {
  kind: 'ref' | 'alpha' | 'literal' | 'page';
  ref?: string;
  alpha?: Record<Theme, number>;
  light?: string;
  dark?: string;
  web?: string;
  resolved: Record<Theme, string>;
}

interface Tokens {
  color: Record<string, ColorToken>;
  shadow: Record<string, Record<Theme, ParsedShadow[]>>;
  chart: Record<string, unknown> & {
    series: { name: string; hex: string }[];
    checkbox: { checked: string; unchecked: string };
    optionColors: { index: number; name: string; hex: string; inferred: boolean }[];
    singleHue: Record<string, string>;
    colorlessBase: string;
    opacitySteps: number[];
    numberColors: Record<string, Record<Theme, string>>;
    gridDash: number[];
  };
  layout: {
    maxWidgets: number;
    maxWidgetsPerRow: number;
    gridColumns: number;
    rowHeight: { min: number; default: number; max: number; snap: number };
    minWidgetWidth: number;
  };
  geometry: Record<string, unknown>;
  typography: Record<string, unknown>;
  motion: { fastMs: number; reflowMs: number; easing: string };
  loading: Record<string, number>;
  boardColumnTintBlockIndex: number[];
}

const tokens = loadParityFixture<Tokens>('tokens.json');
const ROOT = join(__dirname, '..', '..', '..', '..');
const readRepoFile = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const DASHBOARD_CSS = readRepoFile('src/styles/dashboard-tokens.css');
const LIGHT = ':root';
const DARK = ':root[data-dark-mode=true]';
const SUPPORTS_FALLBACK = '@supports not';

/** CSS variable of each `tokens.json` color. A new color token must be added here (and to the CSS). */
const COLOR_VARS: Record<string, string> = {
  accent: '--dash-accent',
  editTitle: '--dash-edit-title',
  editIcon: '--dash-edit-icon',
  editTint: '--dash-edit-tint',
  editRing: '--dash-edit-ring',
  rowControlBg: '--dash-row-control-bg',
  cardBg: '--dash-card-bg',
  cardRing: '--dash-card-ring',
  title: '--dash-title',
  toolIcon: '--dash-tool-icon',
  hoverFill: '--dash-hover-fill',
  unsavedDot: '--dash-unsaved-dot',
  saveBg: '--dash-save-bg',
  saveFg: '--dash-save-fg',
  pillBgActive: '--dash-pill-bg-active',
  pillFgActive: '--dash-pill-fg-active',
  pillBg: '--dash-pill-bg',
  pillFg: '--dash-pill-fg',
  toastBg: '--dash-toast-bg',
  chartGrid: '--chart-grid',
  chartTick: '--chart-tick',
  chartDataLabel: '--chart-data-label',
  chartOutsideLabel: '--chart-outside-label',
  chartHoverBand: '--chart-hover-band',
  chartEmpty: '--chart-empty',
  tooltipBg: '--chart-tooltip-bg',
  tooltipBorder: '--chart-tooltip-border',
  numberDefault: '--chart-number-default',
};

/** CSS variable of each `tokens.json` shadow. */
const SHADOW_VARS: Record<string, string> = {
  card: '--dash-card-shadow',
  tooltip: '--chart-tooltip-shadow',
  drilldown: '--dash-drilldown-shadow',
  sidePeek: '--dash-side-peek-shadow',
};

/** The geometry and motion variables, with the `tokens.json` value each must carry. */
const SCALAR_VARS: Record<string, string> = {
  '--chart-grid-dash': tokens.chart.gridDash.join(' '),
  '--dash-motion-fast': `${tokens.motion.fastMs}ms`,
  '--dash-motion-reflow': `${tokens.motion.reflowMs}ms`,
  '--dash-motion-ease': tokens.motion.easing,
  '--dash-column-gap': `${DASHBOARD_GEOMETRY.grid.columnGap}px`,
  '--dash-row-gap': `${DASHBOARD_GEOMETRY.grid.rowGap}px`,
  '--dash-header-height': `${DASHBOARD_GEOMETRY.widget.headerHeight}px`,
  '--dash-box-radius': `${DASHBOARD_GEOMETRY.widget.boxRadius}px`,
  '--dash-card-radius': `${DASHBOARD_GEOMETRY.widget.cardRadius}px`,
  '--dash-card-inset': `${DASHBOARD_GEOMETRY.widget.cardInset}px`,
};

const NUMBER_COLOR_VARS = Object.fromEntries(
  Object.keys(tokens.chart.numberColors).map((name) => [name, `--chart-number-${name}`])
);

function compact(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function dashboardVariables(theme: Theme) {
  const light = parseCssVariables(DASHBOARD_CSS, LIGHT);

  return theme === 'light' ? light : { ...light, ...parseCssVariables(DASHBOARD_CSS, DARK) };
}

function semanticVariables(theme: Theme) {
  const light = parseCssVariables(readRepoFile('src/styles/variables/semantic.light.css'), LIGHT);

  if (theme === 'light') return light;
  return { ...light, ...parseCssVariables(readRepoFile('src/styles/variables/semantic.dark.css'), DARK) };
}

/** A stylesheet with its relative `@import`s inlined, in cascade order (as the app loads `global.css`). */
function inlinedCss(path: string): string {
  return readRepoFile(path).replace(/@import\s+["'](\.\/[^"']+\.css)["'];/g, (_match, relativePath: string) =>
    inlinedCss(join(dirname(path), relativePath))
  );
}

/**
 * Every custom property as the running web app computes it on `<html>`: all
 * `:root` rules in cascade order, then (dark) the more specific
 * `:root[data-dark-mode=true]` rules in cascade order.
 */
function appVariables(theme: Theme) {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};

  parseCssRules(inlinedCss('src/styles/global.css'))
    .filter((rule) => rule.within.length === 0)
    .forEach((rule) => {
      const selector = rule.selector.replace(/['"]/g, '');

      if (selector === LIGHT) Object.assign(light, rule.variables);
      if (selector === DARK) Object.assign(dark, rule.variables);
    });
  return theme === 'light' ? light : { ...light, ...dark };
}

/**
 * Known web/desktop divergences in the whole app cascade, by token. Keep it
 * empty: the tool icon used to resolve to the legacy `--icon-secondary`
 * (#59647A) and is a literal since addendum A7. Never add an entry.
 */
const WEB_CASCADE_DIVERGENCES: Record<string, Record<Theme, string>> = {};

/** The value a token's variable must be declared with in `theme`. */
function expectedExpression(token: ColorToken, theme: Theme): string {
  switch (token.kind) {
    case 'ref':
      return `var(--${token.ref})`;
    case 'alpha':
      return `color-mix(in srgb, var(--${token.ref}) ${Math.round((token.alpha?.[theme] ?? 0) * 100)}%, transparent)`;
    case 'literal':
      return (theme === 'light' ? token.light : token.dark) ?? '';
    case 'page':
      return token.web ?? '';
  }
}

describe('dashboard tokens (tokens.json ↔ dashboard-tokens.css)', () => {
  it('lists every color token in the variable table', () => {
    expect(Object.keys(COLOR_VARS).sort()).toEqual(Object.keys(tokens.color).sort());
    expect(Object.keys(SHADOW_VARS).sort()).toEqual(Object.keys(tokens.shadow).sort());
  });

  it.each(Object.keys(COLOR_VARS))('declares %s with its expression in both themes', (name) => {
    const token = tokens.color[name];

    (['light', 'dark'] as Theme[]).forEach((theme) => {
      const declared = dashboardVariables(theme)[COLOR_VARS[name]];

      expect(declared).toBeDefined();
      expect(compact(declared)).toBe(compact(expectedExpression(token, theme)));
    });
  });

  it.each(Object.keys(COLOR_VARS))('resolves %s to its tokens.json value with the default theme', (name) => {
    const token = tokens.color[name];

    (['light', 'dark'] as Theme[]).forEach((theme) => {
      const variables = { ...semanticVariables(theme), ...dashboardVariables(theme) };

      expect(resolveCssColor(`var(${COLOR_VARS[name]})`, variables)).toBe(token.resolved[theme].toUpperCase());
    });
  });

  it.each(Object.keys(COLOR_VARS))('resolves %s through the whole app stylesheet cascade', (name) => {
    const token = tokens.color[name];

    (['light', 'dark'] as Theme[]).forEach((theme) => {
      const expected = WEB_CASCADE_DIVERGENCES[name]?.[theme] ?? token.resolved[theme].toUpperCase();

      expect(resolveCssColor(`var(${COLOR_VARS[name]})`, appVariables(theme))).toBe(expected);
    });
  });

  it('resolves the card to the page color of each theme', () => {
    expect(
      resolveCssColor('var(--dash-card-bg)', { ...semanticVariables('light'), ...dashboardVariables('light') })
    ).toBe('#FFFFFF');
    expect(resolveCssColor('var(--dash-card-bg)', { ...semanticVariables('dark'), ...dashboardVariables('dark') })).toBe(
      '#21232A'
    );
  });

  it('falls back to the resolved accent tints without color-mix', () => {
    const light = parseCssVariables(DASHBOARD_CSS, LIGHT, SUPPORTS_FALLBACK);
    const dark = parseCssVariables(DASHBOARD_CSS, DARK, SUPPORTS_FALLBACK);

    Object.entries(tokens.color)
      .filter(([, token]) => token.kind === 'alpha')
      .forEach(([name, token]) => {
        expect(resolveCssColor(light[COLOR_VARS[name]])).toBe(token.resolved.light);
        expect(resolveCssColor(dark[COLOR_VARS[name]])).toBe(token.resolved.dark);
      });
  });

  it.each(Object.keys(SHADOW_VARS))('declares the %s shadow in both themes', (name) => {
    (['light', 'dark'] as Theme[]).forEach((theme) => {
      const declared = dashboardVariables(theme)[SHADOW_VARS[name]];

      expect(declared).toBeDefined();
      expect(parseCssShadows(declared)).toEqual(
        tokens.shadow[name][theme].map((shadow) => ({ ...shadow, color: resolveCssColor(shadow.color) }))
      );
    });
  });

  it('declares the Number card colors of both themes', () => {
    expect(Object.keys(CHART_NUMBER_COLOR_VARS).sort()).toEqual(
      ['default', ...Object.keys(tokens.chart.numberColors)].sort()
    );
    expect(CHART_NUMBER_COLOR_VARS.default).toBe(`var(${COLOR_VARS.numberDefault})`);
    Object.entries(tokens.chart.numberColors).forEach(([name, colors]) => {
      expect(CHART_NUMBER_COLOR_VARS[name as keyof typeof CHART_NUMBER_COLOR_VARS]).toBe(
        `var(${NUMBER_COLOR_VARS[name]})`
      );
      (['light', 'dark'] as Theme[]).forEach((theme) => {
        expect(resolveCssColor(dashboardVariables(theme)[NUMBER_COLOR_VARS[name]])).toBe(colors[theme]);
      });
    });
  });

  it('declares the geometry and motion variables with the tokens.json values', () => {
    const light = dashboardVariables('light');
    const dark = parseCssVariables(DASHBOARD_CSS, DARK);

    Object.entries(SCALAR_VARS).forEach(([variable, value]) => {
      expect(light[variable]).toBe(value);
      // Theme independent: the dark block does not redeclare them.
      expect(dark[variable]).toBeUndefined();
    });
  });

  it('declares no --dash-* or --chart-* variable that tokens.json does not know', () => {
    const known = new Set([
      ...Object.values(COLOR_VARS),
      ...Object.values(SHADOW_VARS),
      ...Object.values(NUMBER_COLOR_VARS),
      ...Object.keys(SCALAR_VARS),
    ]);
    const declared = parseCssRules(DASHBOARD_CSS).flatMap((rule) => Object.keys(rule.variables));

    expect(declared.filter((name) => /^--(dash|chart)-/.test(name) && !known.has(name))).toEqual([]);
    expect(declared.filter((name) => !/^--(dash|chart)-/.test(name))).toEqual([]);
  });

  it('builds the card class from the tokens only', () => {
    const card = parseCssRules(DASHBOARD_CSS).some((rule) => rule.selector === '.dash-card');

    expect(card).toBe(true);
    expect(DASHBOARD_CSS).toMatch(
      /\.dash-card\s*\{[^}]*box-shadow:\s*var\(--dash-card-shadow\),\s*0 0 0 1px var\(--dash-card-ring\)/
    );
    expect(DASHBOARD_CSS).toMatch(/\.dash-card\[data-editing='true'\]\s*\{[^}]*var\(--dash-edit-ring\)/);
  });

  it('is imported by the global stylesheet after the semantic themes', () => {
    const global = readRepoFile('src/styles/global.css');
    const dashboard = global.indexOf('@import "./dashboard-tokens.css";');

    expect(dashboard).toBeGreaterThan(global.indexOf('@import "./variables/semantic.dark.css";'));
    expect(global.indexOf('@import "./variables/semantic.light.css";')).toBeGreaterThanOrEqual(0);
  });
});

describe('dashboard tokens (tokens.json ↔ dashboard-geometry.ts)', () => {
  it('binds every top-level, chart and shadow group of tokens.json', () => {
    // A group added to tokens.json must get a binding here first.
    expect(Object.keys(tokens).sort()).toEqual(
      [
        'schema',
        'version',
        'principle',
        'refRule',
        'color',
        'shadow',
        'chart',
        'layout',
        'geometry',
        'typography',
        'motion',
        'loading',
        'boardColumnTintBlockIndex',
      ].sort()
    );
    expect(Object.keys(tokens.chart).sort()).toEqual(
      [
        'series',
        'checkbox',
        'optionColors',
        'singleHue',
        'colorlessBase',
        'opacitySteps',
        'numberColors',
        'gridDash',
        ...Object.keys(DASHBOARD_CHART_GEOMETRY),
      ].sort()
    );
  });

  it('matches the layout limits', () => {
    expect(DASHBOARD_MAX_WIDGETS).toBe(tokens.layout.maxWidgets);
    expect(DASHBOARD_MAX_WIDGETS_PER_ROW).toBe(tokens.layout.maxWidgetsPerRow);
    expect(DASHBOARD_GRID_COLUMNS).toBe(tokens.layout.gridColumns);
    expect(DASHBOARD_MIN_ROW_HEIGHT).toBe(tokens.layout.rowHeight.min);
    expect(DASHBOARD_DEFAULT_ROW_HEIGHT).toBe(tokens.layout.rowHeight.default);
    expect(DASHBOARD_MAX_ROW_HEIGHT).toBe(tokens.layout.rowHeight.max);
    expect(DASHBOARD_ROW_HEIGHT_SNAP).toBe(tokens.layout.rowHeight.snap);
    expect(DASHBOARD_MIN_WIDGET_WIDTH).toBe(tokens.layout.minWidgetWidth);
    expect(Object.keys(tokens.layout).sort()).toEqual(
      ['maxWidgets', 'maxWidgetsPerRow', 'gridColumns', 'rowHeight', 'minWidgetWidth'].sort()
    );
    expect(Object.keys(tokens.layout.rowHeight).sort()).toEqual(['default', 'max', 'min', 'snap']);
  });

  it('re-exports the token limits from dashboard.type.ts, where the layout code reads them', () => {
    // Against the token file itself: a literal redefined in dashboard.type.ts would drift unnoticed otherwise.
    expect({
      maxWidgets: dashboardType.DASHBOARD_MAX_WIDGETS,
      maxWidgetsPerRow: dashboardType.DASHBOARD_MAX_WIDGETS_PER_ROW,
      gridColumns: dashboardType.DASHBOARD_GRID_COLUMNS,
      rowHeight: {
        min: dashboardType.DASHBOARD_MIN_ROW_HEIGHT,
        default: dashboardType.DASHBOARD_DEFAULT_ROW_HEIGHT,
        max: dashboardType.DASHBOARD_MAX_ROW_HEIGHT,
      },
    }).toEqual({
      maxWidgets: tokens.layout.maxWidgets,
      maxWidgetsPerRow: tokens.layout.maxWidgetsPerRow,
      gridColumns: tokens.layout.gridColumns,
      rowHeight: {
        min: tokens.layout.rowHeight.min,
        default: tokens.layout.rowHeight.default,
        max: tokens.layout.rowHeight.max,
      },
    });
    // The keyboard step of the height handle is the shared snap.
    expect(DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP).toBe(tokens.layout.rowHeight.snap);
  });

  it('matches the geometry, typography and motion exactly', () => {
    expect(DASHBOARD_GEOMETRY).toEqual(tokens.geometry);
    expect(DASHBOARD_TYPOGRAPHY).toEqual(tokens.typography);
    expect(DASHBOARD_MOTION).toEqual(tokens.motion);
  });

  it('matches the chart geometry and the board column tint table', () => {
    const chartGeometry = Object.fromEntries(
      Object.keys(DASHBOARD_CHART_GEOMETRY).map((key) => [key, tokens.chart[key]])
    );

    expect(DASHBOARD_CHART_GEOMETRY).toEqual(chartGeometry);
    expect(DASHBOARD_BOARD_COLUMN_TINT_BLOCK_INDEX).toEqual(tokens.boardColumnTintBlockIndex);
  });

  it('points the flat aliases at their geometry', () => {
    expect(DASHBOARD_COLUMN_GAP_PX).toBe((tokens.geometry.grid as { columnGap: number }).columnGap);
    expect(DASHBOARD_WIDGET_HEADER_HEIGHT).toBe(DASHBOARD_GEOMETRY.widget.headerHeight);
    expect(DASHBOARD_WIDGET_BOX_BLEED).toBe(DASHBOARD_GEOMETRY.widget.boxBleed);
    expect(DASHBOARD_ROW_CONTROL_OFFSET).toBe(DASHBOARD_GEOMETRY.row.controlOffset);
    expect(DASHBOARD_ROW_CONTROL_SIZE).toBe(DASHBOARD_GEOMETRY.row.controlSize);
    expect(DASHBOARD_ADD_ROW_BUTTON_SIZE).toBe(DASHBOARD_GEOMETRY.row.addNewRowSize);
    expect(DASHBOARD_DROP_INDICATOR_WIDTH).toBe(DASHBOARD_GEOMETRY.dnd.indicatorWidth);
    expect(DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP).toBe(DASHBOARD_ROW_HEIGHT_SNAP);
  });

  it('keeps the geometry invariants', () => {
    const { grid, widget, row } = DASHBOARD_GEOMETRY;

    expect(widget.boxBleed).toBe(widget.boxPaddingInline);
    expect(widget.cardInset).toBe(widget.headerHeight + widget.boxPaddingBottom);
    expect(row.controlGutterMin).toBe(row.controlOffset + grid.columnGap + 2);
  });
});

describe('dashboard tokens (tokens.json ↔ dashboard-loading.ts)', () => {
  it('matches the loading constants exactly', () => {
    expect(DASHBOARD_LOADING).toEqual(tokens.loading);
  });

  it('caps the distinct sources that load at the same time at 2 (addendum A9)', () => {
    expect(tokens.loading.maxConcurrentSources).toBe(2);
    expect(DASHBOARD_LOADING.maxConcurrentSources).toBe(2);
  });

  it('has no other loading constant (the source cap is hard: no slow-source escape)', () => {
    expect(Object.keys(tokens.loading).sort()).toEqual(
      ['maxConcurrentSources', 'deferredStartTimeoutMs', 'rowBudget', 'sourceIdleReleaseMs', 'sourceLoadTimeoutMs'].sort()
    );
    expect(tokens.loading).not.toHaveProperty('slowSourceSlotMs');
  });

  it('frees the slot of a source that never opens after 30 s (fix B4), a stall timeout and not a slow-source escape', () => {
    expect(tokens.loading.sourceLoadTimeoutMs).toBe(30000);
    expect(DASHBOARD_LOADING.sourceLoadTimeoutMs).toBeGreaterThan(DASHBOARD_LOADING.deferredStartTimeoutMs);
  });
});

describe('dashboard tokens (tokens.json ↔ chart palette)', () => {
  it('matches the series palette, checkbox colors and single hues', () => {
    expect(CHART_SERIES_PALETTE).toEqual(tokens.chart.series.map((entry) => entry.hex));
    expect(CHART_CHECKBOX_COLORS).toEqual(tokens.chart.checkbox);
    expect(CHART_SINGLE_HUE).toEqual(tokens.chart.singleHue);
    expect(CHART_COLORLESS_BASE).toBe(tokens.chart.colorlessBase);
    expect(CHART_OPACITY_STEPS).toEqual(tokens.chart.opacitySteps);
    expect(CHART_GRID_DASH).toBe(tokens.chart.gridDash.join(' '));
  });

  it('maps every select option color, in enum order, to its chart color', () => {
    const colors = Object.values(SelectOptionColor);

    expect(colors).toEqual(tokens.chart.optionColors.map((entry) => entry.name));
    tokens.chart.optionColors.forEach((entry, index) => {
      expect(entry.index).toBe(index);
      expect(CHART_OPTION_COLORS[colors[index]]).toBe(entry.hex);
    });
    expect(Object.keys(CHART_OPTION_COLORS)).toHaveLength(colors.length);
  });
});

describe('dashboard tokens (tokens.json ↔ Tailwind)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dashboard = require(join(ROOT, 'tailwind/dashboard.cjs')) as Record<string, Record<string, string>>;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const colors = require(join(ROOT, 'tailwind/colors.cjs')) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const shadows = require(join(ROOT, 'tailwind/box-shadow.cjs')) as Record<string, string>;

  it('names every color token after its variable', () => {
    const expected: Record<string, Record<string, string>> = { dash: {}, chart: {} };

    Object.values(COLOR_VARS).forEach((variable) => {
      const [, group, name] = /^--(dash|chart)-(.+)$/.exec(variable) ?? [];

      expected[group][name] = `var(${variable})`;
    });
    expect(dashboard).toEqual(expected);
  });

  it('is merged into the Tailwind colors', () => {
    expect(colors.dash).toEqual(dashboard.dash);
    expect(colors.chart).toEqual(dashboard.chart);
  });

  it('adds the dashboard shadows', () => {
    expect(shadows['dash-card']).toBe('var(--dash-card-shadow), 0 0 0 1px var(--dash-card-ring)');
    expect(shadows['dash-tooltip']).toBe('var(--chart-tooltip-shadow)');
    expect(shadows['dash-drilldown']).toBe('var(--dash-drilldown-shadow), 0 0 0 1px var(--dash-card-ring)');
    expect(shadows['dash-side-peek']).toBe('var(--dash-side-peek-shadow)');
  });
});
