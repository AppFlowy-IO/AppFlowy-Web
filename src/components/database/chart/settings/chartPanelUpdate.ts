import {
  ChartExtendedField,
  ChartExtendedLayoutKeys,
  ChartExtendedSettingsUpdate,
  parseNumberConditionalColor,
} from '@/application/database-yjs/chart-extended-settings';
import { ChartLayoutField, ChartLayoutKeys, ChartLayoutSetting } from '@/application/database-yjs/chart.type';

const LAYOUT_FIELDS = new Map(
  (Object.entries(ChartLayoutKeys) as [ChartLayoutField, string][]).map(([field, key]) => [key, field])
);
const EXTENDED_FIELDS = new Map(
  (Object.entries(ChartExtendedLayoutKeys) as [ChartExtendedField, string][]).map(([field, key]) => [key, field])
);

/**
 * A persisted panel patch (`chartPatchFor`) as the two arguments of
 * `useUpdateChartSetting`: the collab keys and the extended keys (`null`
 * resets one). A key this client does not know is never written.
 */
export function toChartUpdate(patch: Record<string, unknown>): {
  settings: Partial<ChartLayoutSetting>;
  extended: ChartExtendedSettingsUpdate | undefined;
} {
  const settings: Record<string, unknown> = {};
  const extended: Record<string, unknown> = {};

  Object.entries(patch).forEach(([key, value]) => {
    const layoutField = LAYOUT_FIELDS.get(key);
    const extendedField = EXTENDED_FIELDS.get(key);

    if (layoutField) settings[layoutField] = value;
    else if (extendedField === 'numberConditionalColor') {
      extended[extendedField] = value === null ? null : parseNumberConditionalColor(value);
    } else if (extendedField) extended[extendedField] = value;
  });

  return {
    settings: settings as Partial<ChartLayoutSetting>,
    extended: Object.keys(extended).length > 0 ? (extended as ChartExtendedSettingsUpdate) : undefined,
  };
}
