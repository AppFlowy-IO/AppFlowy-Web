/**
 * The shared logic of the dashboard visual parity probes (calc, colors,
 * value resolution, check expansion) and the L0 check that every value of
 * `visual-metrics.json` resolves for every state.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import icons from '../../__fixtures__/dashboard-parity/icons.json';
import tokens from '../../__fixtures__/dashboard-parity/tokens.json';
import visualMetrics from '../../__fixtures__/dashboard-parity/visual-metrics.json';
import {
  appliesToPattern,
  calcDependencies,
  compareValues,
  evaluateCalc,
  expandChecks,
  IconsFixture,
  isBlocking,
  knownParityIds,
  measuredMetricNames,
  normalizeColor,
  orderFamily,
  parseCalc,
  PARITY_STATES,
  parseParityState,
  resolveExpected,
  ResolveContext,
  runOptionsFromEnv,
  TokensFixture,
  VisualMetricsFixture,
} from '../index';

const fixture = visualMetrics as unknown as VisualMetricsFixture;
const iconsFixture = icons as unknown as IconsFixture;
const tokenFixture = tokens as unknown as TokensFixture;

function ctx(state = 'view-light' as const, measured?: ResolveContext['measured']): ResolveContext {
  return { tokens: tokenFixture, state: parseParityState(state), client: 'web', measured };
}

describe('calc grammar', () => {
  const env = {
    token: (path: string) => ({ 'geometry.a': 10, 'geometry.b': 3 }[path] ?? NaN),
    measured: (id: string, metric: string) => (id === 'dash-x' && metric === 'width' ? 100 : undefined),
  };

  it('honours precedence, parentheses and functions', () => {
    expect(evaluateCalc(parseCalc('geometry.a + 2 * geometry.b'), env)).toBe(16);
    expect(evaluateCalc(parseCalc('(geometry.a + 2) * geometry.b'), env)).toBe(36);
    expect(evaluateCalc(parseCalc('clamp(40, 0.16 * $dash-x.width, 60)'), env)).toBe(40);
    expect(evaluateCalc(parseCalc('min(geometry.a, geometry.b) + max(1, 2)'), env)).toBe(5);
  });

  it('rounds half away from zero', () => {
    expect(evaluateCalc(parseCalc('round(2.5)'), env)).toBe(3);
    expect(evaluateCalc(parseCalc('round(0 - 2.5)'), env)).toBe(-3);
  });

  it('has no unary minus and only knows its four functions and token roots', () => {
    expect(() => parseCalc('-2')).toThrow();
    expect(() => parseCalc('abs(2)')).toThrow();
    expect(() => parseCalc('widget.size + 1')).toThrow();
  });

  it('lists the tokens and measurements an expression reads', () => {
    expect(calcDependencies('$dash-widget-box.height - geometry.widget.cardInset')).toEqual({
      tokens: ['geometry.widget.cardInset'],
      measured: [{ id: 'dash-widget-box', metric: 'height' }],
    });
    expect(calcDependencies('1.1 * $self.fontSize').measured).toEqual([{ id: 'self', metric: 'fontSize' }]);
  });
});

describe('colors', () => {
  it('normalizes every color syntax to #RRGGBBAA with round(a × 255)', () => {
    expect(normalizeColor('#fff')).toBe('#FFFFFFFF');
    expect(normalizeColor('#21232A')).toBe('#21232AFF');
    expect(normalizeColor('rgba(31, 35, 41, 0.03)')).toBe('#1F232908');
    expect(normalizeColor('rgb(0 181 255 / 6%)')).toBe('#00B5FF0F');
    expect(normalizeColor('color(srgb 0 0.709804 1 / 0.06)')).toBe('#00B5FF0F');
    expect(normalizeColor('transparent')).toBe('#00000000');
    expect(normalizeColor('rgba(0, 0, 0, 0)')).toBe('#00000000');
    expect(normalizeColor('none')).toBeNull();
  });

  it('compares numbers within the tolerance and colors exactly', () => {
    expect(compareValues(24, 24.4, 0.5).pass).toBe(true);
    expect(compareValues(24, 24.6, 0.5).pass).toBe(false);
    expect(compareValues('#00B5FF0F', '#00B5FF0F', 0.5).pass).toBe(true);
    expect(compareValues('#00B5FF0F', '#00B5FF10', 0.5).pass).toBe(false);
    expect(compareValues([2, 3], [2, 3], 0.5).pass).toBe(true);
    expect(compareValues(24, null, 0.5).pass).toBe(false);
  });
});

describe('expected values', () => {
  it('resolves color tokens per theme and the desktop dark page color', () => {
    expect(resolveExpected('color.cardBg', ctx('view-dark'))).toEqual({ ok: true, value: '#21232AFF' });
    expect(resolveExpected('color.cardBg', { ...ctx('view-dark'), client: 'desktop' })).toEqual({
      ok: true,
      value: '#1A202CFF',
    });
    expect(resolveExpected('color.editTint', ctx('edit-light'))).toEqual({ ok: true, value: '#00B5FF0F' });
  });

  it('resolves ref: colors, per-mode and per-theme objects, shadows and calc', () => {
    expect(resolveExpected('ref:border-primary', ctx('view-light'))).toEqual({ ok: true, value: '#DDE2F1FF' });
    expect(resolveExpected({ view: '#00000000', edit: 'color.editTint' }, ctx('edit-dark'))).toEqual({
      ok: true,
      value: '#00B5FF14',
    });
    expect(resolveExpected({ light: '#989EB799', dark: '#6F748C99' }, ctx('view-dark'))).toEqual({
      ok: true,
      value: '#6F748C99',
    });
    expect(resolveExpected('shadow.card', ctx('view-light'))).toEqual({
      ok: true,
      value: [{ x: 0, y: 12, blur: 32, spread: 0, color: '#1F232908' }],
    });
    expect(resolveExpected('shadow.card', ctx('view-dark'))).toEqual({ ok: true, value: [] });
    expect(
      resolveExpected(
        { calc: '$dash-widget-box.height - geometry.widget.cardInset' },
        ctx('view-light', (id, metric) => (id === 'dash-widget-box' && metric === 'height' ? 360 : undefined))
      )
    ).toEqual({ ok: true, value: 314 });
  });

  it('reports a calc that lacks a measurement', () => {
    const result = resolveExpected({ calc: '$dash-row.width / 2' }, ctx());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.missing).toEqual({ id: 'dash-row', metric: 'width' });
  });
});

describe('visual-metrics.json resolves (L0)', () => {
  // Every measured dependency gets a stand-in number, so only real contract
  // errors (unknown tokens, refs that disagree, bad forms) remain.
  const measured = () => 100;

  it.each(PARITY_STATES)('every element and variant metric resolves in %s', (state) => {
    const errors: string[] = [];

    fixture.elements.forEach((entry) => {
      const blocks = [{ where: entry.id, metrics: entry.metrics }].concat(
        (entry.variants ?? []).map((variant, index) => ({ where: `${entry.id}#${index}`, metrics: variant.metrics }))
      );

      blocks.forEach(({ where, metrics }) => {
        Object.entries(metrics).forEach(([metric, spec]) => {
          const result = resolveExpected(spec, ctx(state as 'view-light', measured));

          if (!result.ok) errors.push(`${where}.${metric}: ${result.error}`);
        });
      });
    });
    iconsFixture.icons.forEach((icon) =>
      icon.contexts.forEach((context) => {
        const result = resolveExpected(context.size, ctx(state as 'view-light', measured));

        if (!result.ok || typeof result.value !== 'number') errors.push(`icon ${icon.name} ${context.parityId} size`);
      })
    );
    expect(errors).toEqual([]);
  });

  it('every appliesTo glob matches a known parity id', () => {
    const known = knownParityIds(fixture, iconsFixture);
    const unmatched = fixture.elements
      .filter((entry) => entry.appliesTo)
      .filter((entry) => !known.some((id) => new RegExp(appliesToPattern(entry.appliesTo as string)).test(id)))
      .map((entry) => entry.id);

    expect(unmatched).toEqual([]);
  });

  it('every scene and interaction an entry names exists', () => {
    const scenes = new Set(fixture.scenes.map((scene) => scene.id));
    const interactions = new Set(Object.keys(fixture.interactions));
    const problems: string[] = [];
    const visit = (where: string, scene?: string, when?: string) => {
      if (scene && !scenes.has(scene)) problems.push(`${where}: scene ${scene}`);
      if (when && !interactions.has(when)) problems.push(`${where}: when ${when}`);
    };

    fixture.elements.forEach((entry) => {
      visit(entry.id, entry.scene, entry.when);
      (entry.variants ?? []).forEach((variant, index) => visit(`${entry.id}#${index}`, variant.scene, variant.when));
    });
    fixture.orderChecks.forEach((entry) => visit(entry.id, entry.scene, entry.when));
    fixture.textChecks.forEach((entry) => visit(entry.id, entry.scene, entry.when));
    expect(problems).toEqual([]);
  });

  it('a glob never crosses a part separator', () => {
    const pattern = new RegExp(appliesToPattern('dash-widget-menu-item-*'));

    expect(pattern.test('dash-widget-menu-item-move-left')).toBe(true);
    expect(pattern.test('dash-widget-menu-item-move-left__icon')).toBe(false);
  });
});

describe('check expansion and gating', () => {
  it('report mode measures every pending entry of the state, enforce mode none of them', () => {
    const report = expandChecks(fixture, 'view-light', runOptionsFromEnv({}));
    const enforce = expandChecks(fixture, 'view-light', runOptionsFromEnv({ DASHBOARD_PARITY_MODE: 'enforce' }));

    expect(report.metrics.length).toBeGreaterThan(50);
    expect(report.orders.length).toBeGreaterThan(0);
    expect(report.texts.length).toBeGreaterThan(0);
    expect(enforce.metrics.filter((check) => check.status === 'pending')).toEqual([]);
    // A variant inherits the entry and replaces only what it names.
    const hover = report.metrics.find((check) => check.key === 'dash-widget-title-pill#0');

    expect(hover).toMatchObject({ when: 'hover-title', scene: 'two-widgets', relativeTo: 'dash-widget-header' });
  });

  it('only enforced entries block, unless strict mode covers the wave', () => {
    const plain = runOptionsFromEnv({});
    const strict = runOptionsFromEnv({ DASHBOARD_PARITY_STRICT: '1', DASHBOARD_PARITY_WAVE: '2' });

    expect(isBlocking('enforced', 3, plain)).toBe(true);
    expect(isBlocking('pending', 2, plain)).toBe(false);
    expect(isBlocking('pending', 2, strict)).toBe(true);
    expect(isBlocking('pending', 3, strict)).toBe(false);
    expect(isBlocking('waived', 2, strict)).toBe(false);
  });

  it('an order check sees unexpected ids of the same family only', () => {
    const known = knownParityIds(fixture, iconsFixture);

    expect(orderFamily(['dash-toolbar-filter', 'dash-toolbar-settings'], known, 'dash-toolbar')).toContain(
      'dash-toolbar-open-as-page'
    );
    expect(orderFamily(['dash-toolbar-filter'], known, 'dash-toolbar')).toContain('dash-toolbar-edit-button');
    expect(
      orderFamily(['dash-widget-picker-layout-grid', 'dash-widget-picker-layout-board'], known, 'dash-widget-picker')
    ).not.toContain('dash-widget-picker-search');
    expect(
      orderFamily(['dash-row-control-move', 'dash-row', 'dash-row-control-add'], known, 'dash-grid')
    ).not.toContain('dash-grid-add-row');
  });
});

describe('the probe measures exactly what the comparator plans', () => {
  // `compare-visual-parity.mjs --emit-plan` is the reference for the join keys
  // (check, variant, scene, when, instance, metric): a probe row with another
  // key is never compared.
  const ROOT = join(__dirname, '../../../../..');
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dashboard-parity-plan-'));
    execFileSync(process.execPath, [join(ROOT, 'scripts/dashboard-parity/compare-visual-parity.mjs'), '--emit-plan', dir], {
      stdio: 'pipe',
    });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const key = (...parts: unknown[]) => parts.map((part) => (part === null || part === undefined ? '-' : String(part))).join('|');

  it.each(PARITY_STATES)('in %s', (state) => {
    const plan = JSON.parse(readFileSync(join(dir, `plan-${state}.json`), 'utf8')) as {
      measurements: { check: string; variant: number | null; scene: string; when: string; instance: string | null; metric: string }[];
      orderChecks: { check: string; scene: string; when: string; instance: string | null }[];
      textChecks: { check: string; scene: string; when: string; instance: string | null }[];
    };
    const checks = expandChecks(fixture, state, runOptionsFromEnv({}));

    expect(
      checks.metrics
        .flatMap((check) =>
          measuredMetricNames(check.metrics).map((metric) =>
            key(check.checkId, check.variant, check.scene, check.when, check.instance, metric)
          )
        )
        .sort()
    ).toEqual(plan.measurements.map((row) => key(row.check, row.variant, row.scene, row.when, row.instance, row.metric)).sort());
    expect(checks.orders.map((check) => key(check.checkId, check.scene, check.when, check.instance)).sort()).toEqual(
      plan.orderChecks.map((row) => key(row.check, row.scene, row.when, row.instance)).sort()
    );
    expect(checks.texts.map((check) => key(check.checkId, check.scene, check.when, check.instance)).sort()).toEqual(
      plan.textChecks.map((row) => key(row.check, row.scene, row.when, row.instance)).sort()
    );
  });
});
