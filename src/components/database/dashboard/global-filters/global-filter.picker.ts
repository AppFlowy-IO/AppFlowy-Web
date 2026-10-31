import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { normalizeDashboardText } from '@/utils/normalize-text';

import { isGlobalFilterFieldType } from './global-filter.utils';

/**
 * The property-first picker of the dashboard's global filters (WP08 §1.2):
 * which properties it lists, grouped by source in widget order, how many
 * show before a "more" row, and whether the "Filter multiple sources" footer
 * shows. Pure; desktop builds the same model and both are checked against
 * `dashboard-parity/gfilter-picker.json`.
 */
export type GlobalFilterPickerMode = 'toolbar' | 'multi' | 'add-another';

/** A flat list (one source) shows this many properties before its more row. */
export const PICKER_FLAT_LIMIT = 8;
/** Each group (several sources) shows this many. */
export const PICKER_GROUP_LIMIT = 5;

export interface PickerSourceField {
  id: string;
  name: string;
  type: FieldType;
}

export interface PickerSource<F extends PickerSourceField = PickerSourceField> {
  databaseId: string;
  name: string;
  fields: F[];
}

export interface GlobalFilterPickerGroup<F extends PickerSourceField = PickerSourceField> {
  databaseId: string;
  name: string;
  /** Widgets of this database on the dashboard ("2 views"). */
  viewCount: number;
  /** The properties shown, in order. */
  fields: F[];
  /** Properties hidden behind the more row (0 when expanded or searching). */
  moreCount: number;
}

export interface GlobalFilterPickerModel<F extends PickerSourceField = PickerSourceField> {
  /** One source: its properties without a group header. */
  flat: boolean;
  groups: GlobalFilterPickerGroup<F>[];
  /** "Filter multiple sources" (writers, toolbar entry, 2+ sources). */
  showFooter: boolean;
  /** Nothing to list (no match, or nothing left to add). */
  empty: boolean;
}

export interface GlobalFilterPickerInput<F extends PickerSourceField = PickerSourceField> {
  sources: PickerSource<F>[];
  rows: Pick<DashboardRow, 'widgets'>[];
  query: string;
  /** Database ids whose group shows every property. */
  expanded: ReadonlySet<string> | readonly string[];
  mode: GlobalFilterPickerMode;
  /** Add another: only properties of this type. */
  fieldType?: FieldType;
  /** Add another: the sources the filter maps already. */
  excludeDatabaseIds?: readonly string[];
  canEdit: boolean;
}

/** Widgets per database, and the databases in the order they first appear. */
export function countWidgetsByDatabase(rows: Pick<DashboardRow, 'widgets'>[]): Map<string, number> {
  const counts = new Map<string, number>();

  rows.forEach((row) =>
    row.widgets.forEach((widget) => counts.set(widget.databaseId, (counts.get(widget.databaseId) ?? 0) + 1))
  );
  return counts;
}

export function buildGlobalFilterPickerModel<F extends PickerSourceField>({
  sources,
  rows,
  query,
  expanded,
  mode,
  fieldType,
  excludeDatabaseIds = [],
  canEdit,
}: GlobalFilterPickerInput<F>): GlobalFilterPickerModel<F> {
  const counts = countWidgetsByDatabase(rows);
  const order = [...counts.keys()];
  const byId = new Map(sources.map((source) => [source.databaseId, source]));
  const ordered = [
    ...order.flatMap((databaseId) => {
      const source = byId.get(databaseId);

      return source ? [source] : [];
    }),
    ...sources.filter((source) => !counts.has(source.databaseId)),
  ];
  const excluded = new Set(excludeDatabaseIds);
  const eligible = (field: F) =>
    isGlobalFilterFieldType(field.type) && (mode !== 'add-another' || field.type === fieldType);
  const listed = ordered
    .filter((source) => mode !== 'add-another' || !excluded.has(source.databaseId))
    .map((source) => ({ source, fields: source.fields.filter(eligible) }))
    .filter(({ fields }) => fields.length > 0);
  const flat = mode === 'toolbar' && listed.length === 1;
  const limit = flat ? PICKER_FLAT_LIMIT : PICKER_GROUP_LIMIT;
  const needle = normalizeDashboardText(query);
  const expandedIds = new Set(expanded);
  const groups = listed.flatMap(({ source, fields }) => {
    const matches = needle ? fields.filter((field) => normalizeDashboardText(field.name).includes(needle)) : fields;

    if (matches.length === 0) return [];
    const shown = needle || expandedIds.has(source.databaseId) ? matches : matches.slice(0, limit);

    return [
      {
        databaseId: source.databaseId,
        name: source.name,
        viewCount: counts.get(source.databaseId) ?? 0,
        fields: shown,
        moreCount: matches.length - shown.length,
      },
    ];
  });

  return {
    flat,
    groups,
    showFooter: mode === 'toolbar' && canEdit && listed.length >= 2,
    empty: groups.length === 0,
  };
}
