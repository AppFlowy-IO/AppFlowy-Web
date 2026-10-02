import { readBoolean, readStringEnum, sameLayoutValue, setLayoutKeyIfChanged } from './layout-codec';

/**
 * Chart settings stored under snake_case keys that collab's
 * `ChartLayoutSetting` does not know (`layout_settings['3']`, ARCHITECTURE
 * §3.2). The web twin of Rust `ChartExtendedSettings`.
 *
 * A package that adds a key adds, together: (1) `field: 'snake_key'` to
 * `ChartExtendedLayoutKeys`, (2) the same field to `ChartExtendedSettings`
 * with its documented default, (3) its read in `CHART_EXTENDED_READERS`
 * (through the `layout-codec.ts` readers: absent or wrong-typed values and
 * unknown enum strings read as the default), (4) the key in Rust
 * `ChartExtendedSettings::KEYS` and its `ChartExtendedSettingsPB` field, and
 * (5) fixture cases in `dashboard-parity/layouts/`. Unlike `ChartLayoutKeys`,
 * these keys have no legacy camelCase spelling to mirror.
 */
export const ChartExtendedLayoutKeys = {
  // WP10 style keys.
  decimalPlaces: 'decimal_places',
  colorTheme: 'color_theme',
  showDataLabels: 'show_data_labels',
  legendPosition: 'legend_position',
} as const satisfies Record<string, string>;

export type ChartExtendedField = keyof typeof ChartExtendedLayoutKeys;

/** The persisted `color_theme` values (ARCHITECTURE §3.2). */
export type ChartColorTheme =
  | 'auto'
  | 'colorful'
  | 'colorless'
  | 'blue'
  | 'yellow'
  | 'green'
  | 'purple'
  | 'teal'
  | 'orange'
  | 'pink'
  | 'red';

/** In the order of Notion's Color menu (Auto and Colorful above its divider). */
export const CHART_COLOR_THEMES: readonly ChartColorTheme[] = [
  'auto',
  'colorful',
  'colorless',
  'blue',
  'yellow',
  'green',
  'purple',
  'teal',
  'orange',
  'pink',
  'red',
];

/** The persisted `legend_position` values this client writes. `side` is reserved (P2) and reads as `bottom`. */
export type ChartLegendPosition = 'auto' | 'off' | 'bottom';

export const CHART_LEGEND_POSITIONS: readonly ChartLegendPosition[] = ['auto', 'off', 'bottom'];

export const CHART_MAX_DECIMAL_PLACES = 5;

/** The typed extended chart settings, one field per `ChartExtendedLayoutKeys` entry, defaults applied. */
export interface ChartExtendedSettings {
  /** Fixed fraction digits, 0–5; `null` is auto (absent, null, a fraction, a string or out of range). */
  decimalPlaces: number | null;
  colorTheme: ChartColorTheme;
  showDataLabels: boolean;
  legendPosition: ChartLegendPosition;
}

/**
 * A typed extended-settings write: only the fields present are written, and
 * `null` resets a key whose default is "absent" (readers treat a stored `null`
 * as absent; see `writeChartExtendedValue`).
 */
export type ChartExtendedSettingsUpdate = {
  [Field in keyof ChartExtendedSettings]?: ChartExtendedSettings[Field] | null;
};

export const DEFAULT_CHART_EXTENDED_SETTINGS: ChartExtendedSettings = {
  decimalPlaces: null,
  colorTheme: 'auto',
  showDataLabels: true,
  legendPosition: 'auto',
};

/** A whole number 0–5 (a desktop bigint or a JS number); anything else, fractions included, is auto. */
export function parseChartDecimalPlaces(value: unknown): number | null {
  const number = typeof value === 'bigint' ? Number(value) : value;

  return typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= CHART_MAX_DECIMAL_PLACES
    ? number
    : null;
}

export function parseChartColorTheme(value: unknown): ChartColorTheme {
  return readStringEnum(value, CHART_COLOR_THEMES, 'auto');
}

export function parseChartLegendPosition(value: unknown): ChartLegendPosition {
  return value === 'side' ? 'bottom' : readStringEnum(value, CHART_LEGEND_POSITIONS, 'auto');
}

export function parseChartShowDataLabels(value: unknown): boolean {
  return readBoolean(value, true);
}

/** How each key reads; a stored value and a written one are compared through it. */
const CHART_EXTENDED_READERS: { [Field in ChartExtendedField]: (value: unknown) => ChartExtendedSettings[Field] } = {
  decimalPlaces: parseChartDecimalPlaces,
  colorTheme: parseChartColorTheme,
  showDataLabels: parseChartShowDataLabels,
  legendPosition: parseChartLegendPosition,
};

/** Projects the persisted chart map onto `ChartExtendedSettings`; absent keys read as their defaults. */
export function parseChartExtendedSettings(map: { get(key: string): unknown }): ChartExtendedSettings {
  return {
    decimalPlaces: parseChartDecimalPlaces(map.get(ChartExtendedLayoutKeys.decimalPlaces)),
    colorTheme: parseChartColorTheme(map.get(ChartExtendedLayoutKeys.colorTheme)),
    showDataLabels: parseChartShowDataLabels(map.get(ChartExtendedLayoutKeys.showDataLabels)),
    legendPosition: parseChartLegendPosition(map.get(ChartExtendedLayoutKeys.legendPosition)),
  };
}

/**
 * Writes one extended key in its persisted shape unless the stored value
 * reads the same, like Rust `write_changed_to`: picking Auto again over an
 * unknown `color_theme` or an out-of-range `decimal_places` writes nothing,
 * so the value another client stored survives. `null` resets the key; it is
 * written only over a value that reads differently. Returns whether it wrote.
 */
export function writeChartExtendedValue(
  map: { get(key: string): unknown; set(key: string, value: unknown): unknown },
  field: ChartExtendedField,
  value: unknown
): boolean {
  const key = ChartExtendedLayoutKeys[field] as string;
  const read = CHART_EXTENDED_READERS[field] as ((value: unknown) => unknown) | undefined;

  if (!read) return setLayoutKeyIfChanged(map, key, value);
  if (sameLayoutValue(read(map.get(key)), read(value))) return false;
  map.set(key, value);
  return true;
}

/** Field-by-field equality of two parsed extended settings (a missing value is the parsed default). */
export function sameChartExtendedSettings(
  a: ChartExtendedSettings | undefined,
  b: ChartExtendedSettings | undefined
): boolean {
  if (a === b) return true;
  const left: Record<ChartExtendedField, unknown> = { ...DEFAULT_CHART_EXTENDED_SETTINGS, ...a };
  const right: Record<ChartExtendedField, unknown> = { ...DEFAULT_CHART_EXTENDED_SETTINGS, ...b };

  return (Object.keys(ChartExtendedLayoutKeys) as ChartExtendedField[]).every((field) =>
    sameLayoutValue(left[field], right[field])
  );
}
