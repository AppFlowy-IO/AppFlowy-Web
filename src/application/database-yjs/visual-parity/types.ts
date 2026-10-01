/**
 * Types of the dashboard visual parity contract
 * (`__fixtures__/dashboard-parity/visual-metrics.json`, `icons.json`) and of
 * the reports both probes write. Test support only: nothing in the app
 * imports this folder. Design: `parity-plan/VISUAL-PARITY.md`.
 */

export type ParityMode = 'view' | 'edit';
export type ParityTheme = 'light' | 'dark';
export type ParityStateId = 'view-light' | 'view-dark' | 'edit-light' | 'edit-dark';
export type ParityClient = 'web' | 'desktop';
export type ParityStatus = 'pending' | 'enforced' | 'waived';

export const PARITY_STATES: readonly ParityStateId[] = ['view-light', 'view-dark', 'edit-light', 'edit-dark'];

export interface ParityState {
  mode: ParityMode;
  theme: ParityTheme;
}

export function parseParityState(id: ParityStateId): ParityState {
  const [mode, theme] = id.split('-') as [ParityMode, ParityTheme];

  return { mode, theme };
}

export function parityStateId(mode: ParityMode, theme: ParityTheme): ParityStateId {
  return `${mode}-${theme}` as ParityStateId;
}

/** A metric value as the contract writes it (number, token path, `ref:`, per-mode / per-theme object, `calc`, literal). */
export type ValueSpec = unknown;

export interface ElementVariant {
  scene?: string;
  when?: string;
  instance?: string;
  relativeTo?: string;
  states?: ParityStateId[];
  metrics: Record<string, ValueSpec>;
  wave?: number;
  status?: ParityStatus;
  waiver?: string;
  note?: string;
}

export interface ElementEntry {
  id: string;
  description?: string;
  states?: ParityStateId[];
  scene?: string;
  when?: string;
  instance?: string;
  relativeTo?: string;
  content?: string[];
  appliesTo?: string;
  reference?: boolean;
  desktopMeasure?: 'style';
  metrics: Record<string, ValueSpec>;
  variants?: ElementVariant[];
  attach?: { web?: string; desktop?: string };
  source?: string;
  tolerance?: { px?: number; color?: string };
  wave: number;
  status: ParityStatus;
  waiver?: string;
}

export interface OrderCheckEntry {
  id: string;
  description?: string;
  container: string;
  axis: 'x' | 'y';
  scene?: string;
  when?: string;
  instance?: string;
  expected: string[] | { view: string[]; edit: string[] };
  states?: ParityStateId[];
  source?: string;
  wave: number;
  status: ParityStatus;
  waiver?: string;
}

export type TextKind = 'text' | 'tooltip' | 'placeholder' | 'accessibleName';

export interface TextCheckEntry {
  id: string;
  element: string;
  expected: string;
  kind?: TextKind;
  locale?: string;
  scene?: string;
  when?: string;
  instance?: string;
  states?: ParityStateId[];
  wave: number;
  status: ParityStatus;
  waiver?: string;
}

export interface IdEntry {
  id: string;
  description?: string;
  attach?: { web?: string; desktop?: string };
  wave?: number;
}

export interface SceneEntry {
  id: string;
  given: string;
  setup?: string;
  default?: boolean;
}

export interface VisualMetricsFixture {
  schema: string;
  version: number;
  environment: Record<string, unknown>;
  defaults: { tolerancePx: number; states: ParityStateId[]; when: string };
  interactions: Record<string, string>;
  scenes: SceneEntry[];
  elements: ElementEntry[];
  orderChecks: OrderCheckEntry[];
  textChecks: TextCheckEntry[];
  ids: IdEntry[];
}

export interface IconAssetRef {
  asset: string;
  sha256: string | null;
  exists?: boolean;
  symbol?: string;
  usages?: string[];
}

export interface IconContext {
  parityId: string;
  size: ValueSpec;
  wave: number;
}

export interface IconEntry {
  name: string;
  role?: string;
  scope?: 'dashboard' | 'app-wide';
  contexts: IconContext[];
  web: { current: IconAssetRef | null; target: IconAssetRef };
  desktop: { current: IconAssetRef | null; target: IconAssetRef };
  canonical: { source: string; sha256: string | null; reason?: string };
  wave: number;
  status: ParityStatus;
  waiver?: string;
}

export interface NormalizationVector {
  name: string;
  input: string;
  normalized: string;
  sha256: string;
}

export interface IconsFixture {
  schema: string;
  version: number;
  icons: IconEntry[];
  nonGlyph: { name: string; parityIds: string[]; wave: number; note?: string }[];
  normalizationVectors: NormalizationVector[];
}

/** A border box in the capture's coordinate space (logical px, viewport origin). */
export interface ProbeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One measured row of a probe run. The fields of VISUAL-PARITY.md §6.1.3
 * (`check`, `variant`, `scene`, `when`, `instance`, `target`, `index`,
 * `instanceLabel`, `metric`, `actual`, `measure`, `box`, `refs`, `expected`,
 * `error`) are written to the probe file as they are; the rest is the probe's
 * own verdict, which the comparator never reads.
 */
export interface ParityReportRow {
  /** Element id, order check id, text check id, or `icon:<name>` for an icons.json context. */
  check: string;
  kind: 'metric' | 'order' | 'text' | 'icon';
  variant: number | null;
  /** Scene and interaction as the contract writes them (the join key), not as the probe reached them. */
  scene: string;
  state: ParityStateId;
  when: string;
  /** The entry's `instance` string verbatim, `null` when it has none. */
  instance: string | null;
  /** What the instance resolved to on this client (`Projects Grid`, `page`, `row 2`). */
  instanceLabel: string | null;
  /** The parity id actually measured (differs from `check` under an `appliesTo` glob). */
  target: string;
  /** 0-based position of this instance among the instances of `target` in scope. */
  index: number;
  metric: string;
  expected: unknown;
  actual: unknown;
  tolerance: number;
  pass: boolean;
  /** `render` (the real `data-parity-id`), `fallback` (baseline test-id selector), `unavailable` (not measured). */
  measure: 'render' | 'fallback' | 'unavailable';
  /** Why `actual` is `null`: `missing-id`, or a message (scene not built, interaction not available, …). */
  error?: string;
  /** A remark that does not change the verdict (drawn as a border, no next sibling, …). */
  note?: string;
  box?: ProbeBox | null;
  /** Child boxes of an order check. */
  boxes?: (ProbeBox & { id: string })[];
  /** The measured `calc` inputs, keyed `<id>.<metric>` (`self.<metric>` for `$self`). */
  refs?: Record<string, number>;
  wave: number;
  status: ParityStatus;
  attach?: string;
  /** The row fails the build (enforced, or pending in strict mode within the wave). */
  blocking: boolean;
}
