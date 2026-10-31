import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';

import { useDatabaseFields, useDatabaseView } from '@/application/database-yjs';
import { effectiveChartAggregation } from '@/application/database-yjs/chart-config';
import { ChartFormatYField } from '@/application/database-yjs/chart-format';
import {
  ChartAggregationType,
  ChartLayoutSettings,
  defaultChartXField,
  isChartXFieldType,
  isChartYFieldType,
} from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  parseNumberTypeOptions,
  parseSelectOptionTypeOptions,
  SelectOptionColor,
} from '@/application/database-yjs/fields';
import { getFieldDateTimeFormats } from '@/application/database-yjs/fields/date/utils';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { sortByFieldOrder } from './chartCompute';
import { resolveGroupByFieldId } from './chartGroupBy';

interface XAxisField {
  id: string;
  type: FieldType;
  isPrimary: boolean;
}

const DATE_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  FieldType.DateTime,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
]);

const NO_FIELD_IDS: ReadonlySet<string> = new Set();

/** Whether a `fields` event touches one of `fieldIds`: inside its map, or the field itself set or removed. */
function touchesFields(event: Y.YEvent, fieldIds: ReadonlySet<string>): boolean {
  if (event.path.length > 0) return fieldIds.has(String(event.path[0]));
  return [...event.changes.keys.keys()].some((fieldId) => fieldIds.has(fieldId));
}

/** The Y field as R-FORMAT needs it: its kind and the one format that kind prints with. */
function readFormatYField(field: YDatabaseField): ChartFormatYField {
  const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  if (type === FieldType.Number) {
    return { type: 'number', numberFormat: parseNumberTypeOptions(field, type).format };
  }

  if (type === FieldType.Checkbox) return { type: 'checkbox' };
  if (DATE_FIELD_TYPES.has(type)) {
    return { type: 'date', dateFormat: getFieldDateTimeFormats(getTypeOptions(field)).dateFormat };
  }

  return { type: 'other' };
}

/** A select property's options: in order, by id, and their colours. */
interface ChartFieldOptions {
  options: ReadonlyArray<{ id: string; name: string }>;
  optionIdToName: ReadonlyMap<string, string>;
  optionIdToColor: ReadonlyMap<string, SelectOptionColor>;
}

const NO_OPTIONS: ChartFieldOptions = { options: [], optionIdToName: new Map(), optionIdToColor: new Map() };

/**
 * The options of a select property, the same objects while the options (ids,
 * names, colours) are the same, so an unrelated field edit does not regroup
 * the rows. `clock` is the fields clock: Yjs edits options in place.
 */
function useSelectOptions(field: YDatabaseField | null, fieldType: FieldType | null, clock: number): ChartFieldOptions {
  const parsed = useMemo(() => {
    void clock;
    const isSelect = fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect;
    const list = field && isSelect ? parseSelectOptionTypeOptions(field)?.options ?? [] : [];

    return { list, key: JSON.stringify(list.map((option) => [option.id, option.name, option.color ?? null])) };
  }, [field, fieldType, clock]);

  return useMemo(
    () => {
      if (parsed.list.length === 0) return NO_OPTIONS;
      const names = new Map<string, string>();
      const colors = new Map<string, SelectOptionColor>();

      parsed.list.forEach((option) => {
        names.set(option.id, option.name);
        if (option.color) colors.set(option.id, option.color);
      });
      return {
        options: parsed.list.map((option) => ({ id: option.id, name: option.name })),
        optionIdToName: names,
        optionIdToColor: colors,
      };
    },
    // The same options (ids, names, colours) keep the same objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed.key]
  );
}

export interface ChartFields {
  /** Whether the database has a field a chart can group by (`CHART_X_FIELD_TYPES`). */
  hasGroupableFields: boolean;
  /**
   * The X field: `settings.xFieldId` when it can still group, else the default
   * (`defaultChartXField`: a legacy type first, so existing charts do not move).
   */
  resolvedXFieldId: string | null;
  xAxisField: YDatabaseField | null;
  fieldType: FieldType | null;
  /** Select X axis: the options in their order (labels and default ranks). */
  options: ReadonlyArray<{ id: string; name: string }>;
  optionIdToName: ReadonlyMap<string, string>;
  optionIdToColor: ReadonlyMap<string, SelectOptionColor>;
  /** The X field's number format (Number X axis range labels); null otherwise. */
  xNumberFormat: number | null;
  /** The Y field's type when it is usable; null for Count all. */
  yFieldType: FieldType | null;
  /**
   * What the chart computes, formats and titles (`effectiveChartAggregation`):
   * Count without a usable Y field, Earliest / Latest for a legacy Min / Max
   * over a date, Count for an unknown value.
   */
  effectiveAggregation: ChartAggregationType;
  /** The Y field, only when `effectiveAggregation` reads one. */
  yAxisField: YDatabaseField | null;
  yFieldId: string | null;
  /** Current name of the Y field, kept fresh across renames. */
  yFieldName: string;
  /** The Y field's kind and format, by value: it changes only when what the formatter prints changes. */
  yFormatField: ChartFormatYField | null;
  /** Bumps when any field changes in place (Yjs keeps the field maps' identity). */
  fieldsClock: number;
  /**
   * Bumps only when a field the chart reads cells through (the X, Group by
   * or Y field) changes in place: what regroups the rows depends on this, so
   * a column renamed or an option added elsewhere in the database leaves them.
   */
  watchedFieldsClock: number;
  /**
   * The effective Group by property (WP12 decision 9): the stored id when it
   * names a property a chart can group by, is not the X property, and the
   * chart is a bar or line chart; `null` otherwise.
   */
  groupByFieldId: string | null;
  groupByField: YDatabaseField | null;
  groupByFieldType: FieldType | null;
  /** Select Group by property: its options in order and their colours. */
  groupByOptions: ReadonlyArray<{ id: string; name: string }>;
  groupByOptionIdToColor: ReadonlyMap<string, SelectOptionColor>;
  /** The Group by property's number format (range labels); null otherwise. */
  groupByNumberFormat: number | null;
}

/**
 * The schema half of a chart: which fields it groups by and aggregates, and
 * how the Y field formats. Yjs mutates the `fields` map and the view's
 * `field_orders` in place, so two clocks invalidate what is derived from them;
 * everything a consumer gets back is a value or a field map, never a clock it
 * has to remember to depend on (except `fieldsClock`, for memos that read
 * cells through a field).
 */
export function useChartFields(settings: ChartLayoutSettings | null): ChartFields {
  const fields = useDatabaseFields();
  const [fieldsClock, setFieldsClock] = useState(0);
  const [watchedFieldsClock, setWatchedFieldsClock] = useState(0);
  const watchedFieldIdsRef = useRef<ReadonlySet<string>>(NO_FIELD_IDS);

  useEffect(() => {
    if (!fields) return;
    const onChange = (events: Y.YEvent[]) => {
      setFieldsClock((clock) => clock + 1);
      if (events.some((event) => touchesFields(event, watchedFieldIdsRef.current))) {
        setWatchedFieldsClock((clock) => clock + 1);
      }
    };

    fields.observeDeep(onChange);
    return () => fields.unobserveDeep(onChange);
  }, [fields]);

  // The default X axis follows the view's property order (desktop's
  // `select_chart_group_field`), so reordering columns can change it. Its own
  // clock: only the groupable-field list depends on the order, and the chart
  // data follows only when the resolved X axis changes.
  const fieldOrders = useDatabaseView()?.get(YjsDatabaseKey.field_orders);
  const [fieldOrderClock, setFieldOrderClock] = useState(0);

  useEffect(() => {
    if (!fieldOrders) return;
    const onChange = () => setFieldOrderClock((clock) => clock + 1);

    fieldOrders.observe(onChange);
    return () => fieldOrders.unobserve(onChange);
  }, [fieldOrders]);

  const xAxisFields = useMemo<XAxisField[]>(() => {
    // Yjs mutates the field maps and the order array in place.
    void fieldsClock;
    void fieldOrderClock;

    if (!fields) return [];
    const result: XAxisField[] = [];

    fields.forEach((field, fieldId) => {
      const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (isChartXFieldType(type)) result.push({ id: fieldId, type, isPrimary: Boolean(field.get(YjsDatabaseKey.is_primary)) });
    });
    // `fields` is a Y.Map whose iteration order depends on how the doc was
    // built, so rank by the view's property order instead.
    return sortByFieldOrder(result, fieldOrders);
  }, [fields, fieldOrders, fieldsClock, fieldOrderClock]);

  const hasGroupableFields = xAxisFields.length > 0;
  const settingsXFieldId = settings?.xFieldId;
  const resolvedXFieldId = useMemo<string | null>(() => {
    if (settingsXFieldId && xAxisFields.some((field) => field.id === settingsXFieldId)) return settingsXFieldId;
    return defaultChartXField(xAxisFields)?.id ?? null;
  }, [settingsXFieldId, xAxisFields]);

  const xAxisField = resolvedXFieldId && fields ? fields.get(resolvedXFieldId) ?? null : null;
  const fieldType = xAxisField ? (Number(xAxisField.get(YjsDatabaseKey.type)) as FieldType) : null;

  // An option renamed or recolored keeps the field map's identity.
  const stableOptions = useSelectOptions(xAxisField, fieldType, fieldsClock);

  const xNumberFormat = useMemo(() => {
    void fieldsClock;
    return xAxisField && fieldType === FieldType.Number ? parseNumberTypeOptions(xAxisField, fieldType).format ?? 0 : null;
  }, [xAxisField, fieldType, fieldsClock]);

  // The Group by property (WP12): only one a chart can group by, never the X property, only for bars and lines.
  const storedGroupByFieldId = settings?.extended?.groupByFieldId;
  const chartType = settings?.chartType;
  const groupByFieldId = useMemo(
    () =>
      chartType === undefined ? null : resolveGroupByFieldId(storedGroupByFieldId, xAxisFields, resolvedXFieldId, chartType),
    [storedGroupByFieldId, xAxisFields, resolvedXFieldId, chartType]
  );
  const groupByField = groupByFieldId && fields ? fields.get(groupByFieldId) ?? null : null;
  const groupByFieldType = groupByField ? (Number(groupByField.get(YjsDatabaseKey.type)) as FieldType) : null;
  const groupByOptions = useSelectOptions(groupByField, groupByFieldType, fieldsClock);
  const groupByNumberFormat = useMemo(() => {
    void fieldsClock;
    return groupByField && groupByFieldType === FieldType.Number
      ? parseNumberTypeOptions(groupByField, groupByFieldType).format ?? 0
      : null;
  }, [groupByField, groupByFieldType, fieldsClock]);

  // The one aggregation rule (`effectiveChartAggregation`): the Y field is
  // looked up for a value aggregation, and must be one a chart can aggregate.
  const storedAggregation = settings?.aggregationType ?? ChartAggregationType.Count;
  const storedYFieldId = Number(storedAggregation) === ChartAggregationType.Count ? undefined : settings?.yFieldId;
  const storedYField = storedYFieldId && fields ? fields.get(storedYFieldId) ?? null : null;
  const storedYType = storedYField ? (Number(storedYField.get(YjsDatabaseKey.type)) as FieldType) : null;

  // A retype is an in-place field change; `fieldsClock` re-renders, and the type is read again here.
  void fieldsClock;
  const yFieldType = storedYType !== null && isChartYFieldType(storedYType) ? storedYType : null;
  const effectiveAggregation = effectiveChartAggregation(storedAggregation, yFieldType);
  const yAxisField = effectiveAggregation === ChartAggregationType.Count ? null : storedYField;

  const { yFieldName, yKind, yNumberFormat, yDateFormat } = useMemo(() => {
    // A rename, a retype or a format change keeps the field map's identity.
    void fieldsClock;

    const format = yAxisField ? readFormatYField(yAxisField) : null;

    return {
      yFieldName: yAxisField ? String(yAxisField.get(YjsDatabaseKey.name) || '') : '',
      yKind: format?.type ?? null,
      yNumberFormat: format?.numberFormat ?? null,
      yDateFormat: format?.dateFormat ?? null,
    };
  }, [yAxisField, fieldsClock]);

  const yFormatField = useMemo<ChartFormatYField | null>(() => {
    if (yKind === null) return null;
    if (yKind === 'number') return { type: yKind, numberFormat: yNumberFormat };
    if (yKind === 'date') return { type: yKind, dateFormat: yDateFormat };
    return { type: yKind };
  }, [yKind, yNumberFormat, yDateFormat]);

  // The fields the observer above reports on `watchedFieldsClock`. After
  // commit: a render React discards must not change what it watches.
  const watchedFieldIdsKey = [resolvedXFieldId, groupByField ? groupByFieldId : null, storedYFieldId ?? null]
    .filter((fieldId): fieldId is string => Boolean(fieldId))
    .join('\n');

  useLayoutEffect(() => {
    watchedFieldIdsRef.current = watchedFieldIdsKey ? new Set(watchedFieldIdsKey.split('\n')) : NO_FIELD_IDS;
  }, [watchedFieldIdsKey]);

  return {
    hasGroupableFields,
    resolvedXFieldId,
    xAxisField,
    fieldType,
    options: stableOptions.options,
    optionIdToName: stableOptions.optionIdToName,
    optionIdToColor: stableOptions.optionIdToColor,
    xNumberFormat,
    yFieldType: yAxisField ? yFieldType : null,
    effectiveAggregation,
    yAxisField,
    yFieldId: yAxisField ? storedYFieldId ?? null : null,
    yFieldName,
    yFormatField,
    fieldsClock,
    watchedFieldsClock,
    groupByFieldId: groupByField ? groupByFieldId : null,
    groupByField,
    groupByFieldType,
    groupByOptions: groupByOptions.options,
    groupByOptionIdToColor: groupByOptions.optionIdToColor,
    groupByNumberFormat,
  };
}

export default useChartFields;
