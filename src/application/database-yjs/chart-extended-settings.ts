import { sameLayoutValue, setLayoutKeyIfChanged } from './layout-codec';

/**
 * Chart settings stored under snake_case keys that collab's
 * `ChartLayoutSetting` does not know (`layout_settings['3']`, ARCHITECTURE
 * §3.2). The web twin of Rust `ChartExtendedSettings`; it holds no keys yet.
 *
 * A package that adds a key adds, together: (1) `field: 'snake_key'` to
 * `ChartExtendedLayoutKeys`, (2) the same field to `ChartExtendedSettings`
 * with its documented default, (3) its read in `parseChartExtendedSettings`
 * (through the `layout-codec.ts` readers: absent or wrong-typed values and
 * unknown enum strings read as the default), (4) the key in Rust
 * `ChartExtendedSettings::KEYS` and its `ChartExtendedSettingsPB` field, and
 * (5) fixture cases in `dashboard-parity/layouts/`. Unlike `ChartLayoutKeys`,
 * these keys have no legacy camelCase spelling to mirror.
 */
export const ChartExtendedLayoutKeys = {} as const satisfies Record<string, string>;

export type ChartExtendedField = keyof typeof ChartExtendedLayoutKeys;

/** The typed extended chart settings, one field per `ChartExtendedLayoutKeys` entry, defaults applied. */
// eslint-disable-next-line @typescript-eslint/no-empty-interface -- filled key by key from WP10 on.
export interface ChartExtendedSettings {}

/**
 * A typed extended-settings write: only the fields present are written, and
 * `null` resets a key whose default is "absent" (readers treat a stored `null`
 * as absent; see `writeChartExtendedValue`).
 */
export type ChartExtendedSettingsUpdate = {
  [Field in keyof ChartExtendedSettings]?: ChartExtendedSettings[Field] | null;
};

export const DEFAULT_CHART_EXTENDED_SETTINGS: ChartExtendedSettings = {};

/** Projects the persisted chart map onto `ChartExtendedSettings`; absent keys read as their defaults. */
export function parseChartExtendedSettings(_map: { get(key: string): unknown }): ChartExtendedSettings {
  return DEFAULT_CHART_EXTENDED_SETTINGS;
}

/**
 * Writes one extended key in its persisted shape, unless the stored value is
 * already equal. `null` resets the key: it is written only over a stored
 * value, so resetting an absent key writes nothing. Returns whether it wrote.
 */
export function writeChartExtendedValue(
  map: { get(key: string): unknown; set(key: string, value: unknown): unknown },
  field: ChartExtendedField,
  value: unknown
): boolean {
  const key = ChartExtendedLayoutKeys[field] as string;

  if (value === null && (map.get(key) === undefined || map.get(key) === null)) return false;
  return setLayoutKeyIfChanged(map, key, value);
}

/** Field-by-field equality of two parsed extended settings (a missing value is the parsed default). */
export function sameChartExtendedSettings(
  a: ChartExtendedSettings | undefined,
  b: ChartExtendedSettings | undefined
): boolean {
  if (a === b) return true;
  const left: Partial<Record<ChartExtendedField, unknown>> = a ?? DEFAULT_CHART_EXTENDED_SETTINGS;
  const right: Partial<Record<ChartExtendedField, unknown>> = b ?? DEFAULT_CHART_EXTENDED_SETTINGS;

  return (Object.keys(ChartExtendedLayoutKeys) as ChartExtendedField[]).every((field) =>
    sameLayoutValue(left[field], right[field])
  );
}
