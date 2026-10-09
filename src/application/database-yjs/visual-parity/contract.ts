/**
 * Expands `visual-metrics.json` into the checks one probe run measures for one
 * state, and decides which failures block (VISUAL-PARITY.md §2, §6, §7).
 */
import { calcDependencies } from './calc';
import { PARAMETER_METRICS } from './resolve';
import {
  ElementEntry,
  IconEntry,
  OrderCheckEntry,
  ParityStateId,
  ParityStatus,
  parseParityState,
  TextCheckEntry,
  TextKind,
  VisualMetricsFixture,
} from './types';

export const DEFAULT_SCENE = 'two-widgets';
export const DEFAULT_WHEN = 'rest';
export const DEFAULT_TOLERANCE_PX = 0.5;

/** This module expands the contract for the web probe: `clientWaivers.web` entries are not measured here. */
const PROBE_CLIENT = 'web';

export interface RunOptions {
  /** Report mode measures pending entries too; enforce mode measures enforced (and strict in-scope) entries only. */
  includePending: boolean;
  /** `DASHBOARD_PARITY_STRICT=1`: pending entries with `wave ≤ wave` fail too. */
  strict: boolean;
  /** `DASHBOARD_PARITY_WAVE=N`. */
  wave: number | null;
}

/** Read the run options from the environment variables both probes share. */
export function runOptionsFromEnv(env: Record<string, string | undefined>): RunOptions {
  const wave = env.DASHBOARD_PARITY_WAVE ? Number(env.DASHBOARD_PARITY_WAVE) : null;

  return {
    includePending: (env.DASHBOARD_PARITY_MODE ?? 'report') !== 'enforce',
    strict: env.DASHBOARD_PARITY_STRICT === '1',
    wave: wave !== null && Number.isFinite(wave) ? wave : null,
  };
}

/** Whether a failing entry breaks the run. */
export function isBlocking(status: ParityStatus, wave: number, options: RunOptions): boolean {
  if (status === 'enforced') return true;
  if (status === 'waived') return false;
  return options.strict && options.wave !== null && wave <= options.wave;
}

/** Whether an entry is measured at all in this run. */
export function isInScope(status: ParityStatus, wave: number, options: RunOptions): boolean {
  if (status === 'waived') return false;
  if (status === 'enforced') return true;
  return options.includePending || isBlocking(status, wave, options);
}

export interface MetricCheck {
  kind: 'metric';
  /** `<id>` or `<id>#<variant>`. */
  key: string;
  checkId: string;
  variant: number | null;
  scene: string;
  when: string;
  instance?: string;
  relativeTo?: string;
  content?: string[];
  appliesTo?: string;
  metrics: Record<string, unknown>;
  tolerancePx: number;
  wave: number;
  status: ParityStatus;
  attach?: string;
  desktopMeasure?: 'style';
}

export interface OrderCheck {
  kind: 'order';
  key: string;
  checkId: string;
  container: string;
  axis: 'x' | 'y';
  scene: string;
  when: string;
  instance?: string;
  expected: string[];
  wave: number;
  status: ParityStatus;
}

export interface TextCheck {
  kind: 'text';
  key: string;
  checkId: string;
  element: string;
  expected: string;
  textKind: TextKind;
  scene: string;
  when: string;
  instance?: string;
  wave: number;
  status: ParityStatus;
}

export interface StateChecks {
  metrics: MetricCheck[];
  orders: OrderCheck[];
  texts: TextCheck[];
}

function statesOf(entry: { states?: ParityStateId[] }, fixture: VisualMetricsFixture): ParityStateId[] {
  return entry.states ?? fixture.defaults.states;
}

/** The scene an entry without `scene` belongs to: the fixture's default scene. */
export function defaultScene(fixture: VisualMetricsFixture): string {
  return fixture.scenes.find((scene) => scene.default)?.id ?? DEFAULT_SCENE;
}

function defaultWhen(fixture: VisualMetricsFixture): string {
  return fixture.defaults.when ?? DEFAULT_WHEN;
}

/**
 * The element entry that measures `id` (§2.5): the entry with that id, else
 * the entry whose `appliesTo` glob matches it, else the same lookup for the
 * owner of a `__part`.
 */
export function elementEntryFor(fixture: VisualMetricsFixture, id: string): ElementEntry | null {
  for (const candidate of [id, id.split('__')[0]]) {
    const exact = fixture.elements.find((entry) => entry.id === candidate);

    if (exact) return exact;
    const glob = fixture.elements.find(
      (entry) => entry.appliesTo?.includes('*') && new RegExp(appliesToPattern(entry.appliesTo)).test(candidate)
    );

    if (glob) return glob;
  }

  return null;
}

/**
 * A text check with what it leaves out taken from the element it reads
 * (§2.5): `scene`, `when` and `states` are inherited, `instance` only when the
 * scene is the element's. Same rule as `compare-visual-parity.mjs`.
 */
export function resolveTextCheck(
  fixture: VisualMetricsFixture,
  entry: TextCheckEntry
): { scene: string; when: string; instance?: string; states: ParityStateId[] } {
  const owner = elementEntryFor(fixture, entry.element);
  const scene = entry.scene ?? owner?.scene ?? defaultScene(fixture);
  const instance = entry.instance ?? (owner && owner.scene === scene ? owner.instance : undefined);

  return {
    scene,
    when: entry.when ?? owner?.when ?? defaultWhen(fixture),
    instance: instance ?? undefined,
    states: entry.states ?? owner?.states ?? fixture.defaults.states,
  };
}

function expandElement(
  entry: ElementEntry,
  state: ParityStateId,
  fixture: VisualMetricsFixture,
  options: RunOptions
): MetricCheck[] {
  const checks: MetricCheck[] = [];
  const base = {
    kind: 'metric' as const,
    checkId: entry.id,
    scene: entry.scene ?? defaultScene(fixture),
    when: entry.when ?? defaultWhen(fixture),
    instance: entry.instance,
    relativeTo: entry.relativeTo,
    content: entry.content,
    appliesTo: entry.appliesTo,
    tolerancePx: entry.tolerance?.px ?? fixture.defaults.tolerancePx ?? DEFAULT_TOLERANCE_PX,
    status: entry.status,
    attach: entry.attach?.web,
    desktopMeasure: entry.desktopMeasure,
  };

  if (
    statesOf(entry, fixture).includes(state) &&
    isInScope(entry.status, entry.wave, options) &&
    !entry.clientWaivers?.[PROBE_CLIENT]
  ) {
    checks.push({ ...base, key: entry.id, variant: null, metrics: entry.metrics, wave: entry.wave });
  }

  (entry.variants ?? []).forEach((variant, index) => {
    const wave = variant.wave ?? entry.wave;
    const status = variant.status ?? entry.status;

    if (!(variant.states ?? statesOf(entry, fixture)).includes(state)) return;
    if (!isInScope(status, wave, options)) return;
    // This client cannot measure it (`clientWaivers`, inherited from the entry).
    if ((variant.clientWaivers ?? entry.clientWaivers)?.[PROBE_CLIENT]) return;
    checks.push({
      ...base,
      key: `${entry.id}#${index}`,
      variant: index,
      scene: variant.scene ?? base.scene,
      when: variant.when ?? base.when,
      instance: variant.instance ?? base.instance,
      relativeTo: variant.relativeTo ?? base.relativeTo,
      metrics: variant.metrics,
      status,
      wave,
    });
  });

  return checks;
}

function expectedOrder(entry: OrderCheckEntry, state: ParityStateId): string[] {
  if (Array.isArray(entry.expected)) return entry.expected;
  return entry.expected[parseParityState(state).mode];
}

/** Every check of the contract that this run measures in `state`. */
export function expandChecks(fixture: VisualMetricsFixture, state: ParityStateId, options: RunOptions): StateChecks {
  const metrics = fixture.elements.flatMap((entry) => expandElement(entry, state, fixture, options));
  const orders: OrderCheck[] = fixture.orderChecks
    .filter(
      (entry) =>
        statesOf(entry, fixture).includes(state) &&
        isInScope(entry.status, entry.wave, options) &&
        !entry.clientWaivers?.[PROBE_CLIENT]
    )
    .map((entry) => ({
      kind: 'order',
      key: entry.id,
      checkId: entry.id,
      container: entry.container,
      axis: entry.axis,
      scene: entry.scene ?? defaultScene(fixture),
      when: entry.when ?? defaultWhen(fixture),
      instance: entry.instance,
      expected: expectedOrder(entry, state),
      wave: entry.wave,
      status: entry.status,
    }));
  const texts: TextCheck[] = fixture.textChecks.flatMap((entry): TextCheck[] => {
    const resolved = resolveTextCheck(fixture, entry);

    if (!resolved.states.includes(state) || !isInScope(entry.status, entry.wave, options)) return [];
    if (entry.clientWaivers?.[PROBE_CLIENT]) return [];
    return [
      {
        kind: 'text',
        key: entry.id,
        checkId: entry.id,
        element: entry.element,
        expected: entry.expected,
        textKind: entry.kind ?? 'text',
        scene: resolved.scene,
        when: resolved.when,
        instance: resolved.instance,
        wave: entry.wave,
        status: entry.status,
      },
    ];
  });

  return { metrics, orders, texts };
}

/** The `$id.metric` measurements the metrics of a check read (`self` stays `self`). */
export function measuredDependencies(metrics: Record<string, unknown>): { id: string; metric: string }[] {
  const deps: { id: string; metric: string }[] = [];
  const visit = (spec: unknown) => {
    if (!spec || typeof spec !== 'object') return;
    const object = spec as Record<string, unknown>;

    if (typeof object.calc === 'string') {
      deps.push(...calcDependencies(object.calc).measured);
      return;
    }

    Object.values(object).forEach(visit);
  };

  Object.values(metrics).forEach(visit);
  return deps.filter(
    (dep, index) => deps.findIndex((other) => other.id === dep.id && other.metric === dep.metric) === index
  );
}

/** The metric names a check measures on its element (parameters such as `gapAxis` excluded). */
export function measuredMetricNames(metrics: Record<string, unknown>): string[] {
  return Object.keys(metrics).filter((name) => !PARAMETER_METRICS.has(name));
}

/**
 * `appliesTo` globs (§2.2): `*` matches `[a-z0-9-]*` and never crosses `__`.
 * Returns a RegExp source anchored at both ends.
 */
export function appliesToPattern(glob: string): string {
  return `^${glob
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9-]*')}$`;
}

/**
 * Every parity id the contract knows (elements, `ids`, order and text check
 * references, icon contexts), for the order-check family filter.
 */
export function knownParityIds(fixture: VisualMetricsFixture, icons?: { icons: IconEntry[] }): string[] {
  const ids = new Set<string>();

  fixture.elements.forEach((entry) => ids.add(entry.id));
  fixture.ids.forEach((entry) => ids.add(entry.id));
  fixture.orderChecks.forEach((entry) => {
    ids.add(entry.container);
    (Array.isArray(entry.expected) ? entry.expected : [...entry.expected.view, ...entry.expected.edit]).forEach((id) =>
      ids.add(id)
    );
  });
  fixture.textChecks.forEach((entry) => ids.add(entry.element));
  icons?.icons.forEach((icon) => icon.contexts.forEach((context) => ids.add(context.parityId)));
  return [...ids].filter((id) => !id.includes('*'));
}

function commonPrefix(ids: string[]) {
  return ids.reduce((prefix, id) => {
    let index = 0;

    while (index < prefix.length && index < id.length && prefix[index] === id[index]) index += 1;
    return prefix.slice(0, index);
  });
}

/**
 * The ids an order check compares (§2.5, web probe rule): the parity children
 * of the container are filtered to the expected ids plus every known id of
 * their family, so a toolbar check sees an unexpected
 * `dash-toolbar-open-as-page` while a picker check ignores the picker's search
 * field. The family prefix is the common prefix of the expected ids cut after
 * its last `-` (or the common prefix plus `-` when it is itself an expected
 * id); with a single expected id it is the container id plus `-`.
 */
export function orderFamily(expected: string[], known: string[], container: string): string[] {
  const distinct = [...new Set(expected)];
  let prefix: string;

  if (distinct.length < 2) prefix = `${container}-`;
  else {
    const common = commonPrefix(distinct);

    prefix = distinct.includes(common) ? `${common}-` : common.slice(0, common.lastIndexOf('-') + 1);
  }

  return [...new Set([...distinct, ...known.filter((id) => !id.includes('__') && id.startsWith(prefix))])];
}
