import { useEffect, useMemo, useState } from 'react';

import { useDatabaseFields, useDatabaseView } from '@/application/database-yjs';
import { ChartFormatYField } from '@/application/database-yjs/chart-format';
import {
  ChartAggregationType,
  ChartLayoutSettings,
  isGroupableFieldType,
  resolveEffectiveAggregation,
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

interface GroupableField {
  id: string;
  type: FieldType;
}

const DATE_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  FieldType.DateTime,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
]);

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

export interface ChartFields {
  /** Whether the database has a field a chart can group by (`GROUPABLE_FIELD_TYPES`). */
  hasGroupableFields: boolean;
  /** The X field: `settings.xFieldId` when it is still groupable, else the first groupable field in view order. */
  resolvedXFieldId: string | null;
  xAxisField: YDatabaseField | null;
  fieldType: FieldType | null;
  optionIdToName: ReadonlyMap<string, string>;
  optionIdToColor: ReadonlyMap<string, SelectOptionColor>;
  /**
   * What the chart computes, formats and titles: Count unless a value
   * aggregation this client computes has its Y field.
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

  useEffect(() => {
    if (!fields) return;
    const onChange = () => setFieldsClock((clock) => clock + 1);

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

  const groupableFields = useMemo<GroupableField[]>(() => {
    // Yjs mutates the field maps and the order array in place.
    void fieldsClock;
    void fieldOrderClock;

    if (!fields) return [];
    const result: GroupableField[] = [];

    fields.forEach((field, fieldId) => {
      const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (isGroupableFieldType(type)) result.push({ id: fieldId, type });
    });
    // `fields` is a Y.Map whose iteration order depends on how the doc was
    // built, so rank by the view's property order instead.
    return sortByFieldOrder(result, fieldOrders);
  }, [fields, fieldOrders, fieldsClock, fieldOrderClock]);

  const hasGroupableFields = groupableFields.length > 0;
  const settingsXFieldId = settings?.xFieldId;
  const resolvedXFieldId = useMemo<string | null>(() => {
    if (groupableFields.length === 0) return null;
    if (settingsXFieldId && groupableFields.some((field) => field.id === settingsXFieldId)) return settingsXFieldId;
    return groupableFields[0].id;
  }, [settingsXFieldId, groupableFields]);

  const xAxisField = resolvedXFieldId && fields ? fields.get(resolvedXFieldId) ?? null : null;
  const fieldType = xAxisField ? (Number(xAxisField.get(YjsDatabaseKey.type)) as FieldType) : null;

  const { optionIdToName, optionIdToColor } = useMemo(() => {
    // An option renamed or recolored keeps the field map's identity.
    void fieldsClock;

    const names = new Map<string, string>();
    const colors = new Map<string, SelectOptionColor>();
    const isSelect = fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect;
    const options = xAxisField && isSelect ? parseSelectOptionTypeOptions(xAxisField)?.options ?? [] : [];

    options.forEach((option) => {
      names.set(option.id, option.name);
      if (option.color) colors.set(option.id, option.color);
    });
    return { optionIdToName: names, optionIdToColor: colors };
  }, [xAxisField, fieldType, fieldsClock]);

  // The one aggregation rule (`resolveEffectiveAggregation`), applied in two
  // steps because the Y field is only looked up for a value aggregation.
  const storedAggregation = resolveEffectiveAggregation(settings?.aggregationType, true);
  const storedYFieldId = storedAggregation === ChartAggregationType.Count ? undefined : settings?.yFieldId;
  const yAxisField = storedYFieldId && fields ? fields.get(storedYFieldId) ?? null : null;
  const effectiveAggregation = resolveEffectiveAggregation(storedAggregation, yAxisField !== null);

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

  return {
    hasGroupableFields,
    resolvedXFieldId,
    xAxisField,
    fieldType,
    optionIdToName,
    optionIdToColor,
    effectiveAggregation,
    yAxisField,
    yFieldId: yAxisField ? storedYFieldId ?? null : null,
    yFieldName,
    yFormatField,
    fieldsClock,
  };
}

export default useChartFields;
