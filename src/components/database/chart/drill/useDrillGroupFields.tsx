import { useEffect, useMemo, useState } from 'react';

import { useChartLayoutSetting, useDatabaseContext, useRowOrdersSelector } from '@/application/database-yjs';
import { resolveNumberBuckets } from '@/application/database-yjs/chart-config/number-buckets';
import { ChartType } from '@/application/database-yjs/chart.type';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { ChartDrillTarget, DrillGroupField } from '@/application/database-yjs/drill-query';
import { RowOrdersLoadReporterContext } from '@/application/database-yjs/selector';
import { YDatabaseField, YDoc, YjsDatabaseKey } from '@/application/types';
import { readChartCellValue } from '@/components/database/chart/hooks/chartCompute';
import { useChartFields } from '@/components/database/chart/hooks/useChartFields';

/** A number range key (`n:<lower>`) needs the axis' range size; the open ranges do not. */
function isRangeKey(key: string | undefined): boolean {
  return Boolean(key && key.startsWith('n:') && !key.startsWith('n:lt:') && !key.startsWith('n:ge:'));
}

export interface AutoBucketRequest {
  /** The X field when its range size is automatic (no `x_number_bucket_size`). */
  x: { field: YDatabaseField; min: number | null; max: number | null } | null;
  /** The Group by field: it always uses automatic ranges (WP12 decision 11). */
  sub: { field: YDatabaseField } | null;
}

export interface AutoBucketSizes {
  x?: number;
  sub?: number;
}

export interface DrillGroupFields {
  xField: DrillGroupField | null;
  subGroupField: DrillGroupField | null;
  /** False until the chart settings, and any automatic range size, are known. */
  ready: boolean;
  /** Automatic range sizes the category needs (rendered as a `NumberBucketProbe`). */
  autoBuckets: AutoBucketRequest | null;
  setAutoBucketSizes: (sizes: AutoBucketSizes) => void;
}

const fieldName = (field: YDatabaseField | null) => String(field?.get(YjsDatabaseKey.name) ?? '');

/**
 * The chart's X and Group by properties as the drill category needs them,
 * read from the chart settings of the widget's view the same way the chart
 * reads them (`useChartFields`): the resolved X field, its date grouping and
 * range size, and the effective Group by field.
 */
export function useDrillGroupFields(target: ChartDrillTarget): DrillGroupFields {
  const settings = useChartLayoutSetting();
  // The settings are read in an effect: after the first commit a null
  // setting means the view has none (the chart then uses its defaults).
  const [settingsRead, setSettingsRead] = useState(false);

  useEffect(() => setSettingsRead(true), []);
  const chartFields = useChartFields(settings);
  const [autoSizes, setAutoBucketSizes] = useState<AutoBucketSizes | null>(null);
  const isNumberChart = settings?.chartType === ChartType.Number;
  const { resolvedXFieldId, xAxisField, fieldType, groupByFieldId, groupByField, groupByFieldType } = chartFields;
  const extended = settings?.extended;
  const setSize = extended?.xNumberBucketSize ?? null;
  const needsX =
    !isNumberChart && fieldType === FieldType.Number && setSize === null && isRangeKey(target.xKey) && xAxisField;
  const needsSub =
    !isNumberChart && groupByFieldType === FieldType.Number && isRangeKey(target.subGroupKey) && groupByField;
  const bucketMin = extended?.xNumberBucketMin ?? null;
  const bucketMax = extended?.xNumberBucketMax ?? null;

  const autoBuckets = useMemo<AutoBucketRequest | null>(() => {
    if (!needsX && !needsSub) return null;
    return {
      x: needsX && xAxisField ? { field: xAxisField, min: bucketMin, max: bucketMax } : null,
      sub: needsSub && groupByField ? { field: groupByField } : null,
    };
  }, [needsX, needsSub, xAxisField, groupByField, bucketMin, bucketMax]);

  const xField = useMemo<DrillGroupField | null>(() => {
    if (isNumberChart || !resolvedXFieldId || !xAxisField || fieldType === null) return null;
    return {
      id: resolvedXFieldId,
      name: fieldName(xAxisField),
      type: fieldType,
      dateCondition: settings?.dateCondition ?? DateGroupCondition.Month,
      numberBucketSize: setSize ?? autoSizes?.x ?? null,
    };
  }, [isNumberChart, resolvedXFieldId, xAxisField, fieldType, settings?.dateCondition, setSize, autoSizes?.x]);

  const groupByDateCondition = extended?.groupByDateCondition;
  const subGroupField = useMemo<DrillGroupField | null>(() => {
    if (isNumberChart || !groupByFieldId || !groupByField || groupByFieldType === null) return null;
    return {
      id: groupByFieldId,
      name: fieldName(groupByField),
      type: groupByFieldType,
      dateCondition: groupByDateCondition ?? DateGroupCondition.Month,
      numberBucketSize: autoSizes?.sub ?? null,
    };
  }, [isNumberChart, groupByFieldId, groupByField, groupByFieldType, groupByDateCondition, autoSizes?.sub]);

  return {
    xField,
    subGroupField,
    ready: (settings !== null || settingsRead) && (autoBuckets === null || autoSizes !== null),
    autoBuckets,
    setAutoBucketSizes,
  };
}

/**
 * The doc the probe reads for a row, by the chart's rule (`resolveChartRowDoc`):
 * the live doc when it holds the row, else the row's seed. A live doc that is
 * still empty (opened on its seed before its sync, or reset) must not hide
 * the seed the chart counted, or the automatic range size could differ from
 * the chart's and the drill list other rows than the bar.
 */
export function resolveDrillRowDoc(
  rowId: string,
  rowMap: Record<string, YDoc> | null | undefined,
  peek: ((rowId: string) => YDoc | null) | undefined
): YDoc | undefined {
  const live = rowMap?.[rowId];

  return hasRowConditionData(live) ? live : peek?.(rowId) ?? live ?? undefined;
}

function resolvedSize(
  rowIds: string[],
  docs: Record<string, YDoc>,
  field: YDatabaseField,
  settings: { min: number | null; max: number | null }
): number | undefined {
  const values = rowIds.flatMap((rowId) => {
    const value = readChartCellValue(rowId, field, FieldType.Number, docs);

    return value.kind === 'number' ? [value.value] : [];
  });

  return resolveNumberBuckets(values, { size: null, min: settings.min, max: settings.max })?.size;
}

function NumberBucketReader({
  request,
  onResolve,
}: {
  request: AutoBucketRequest;
  onResolve: (sizes: AutoBucketSizes) => void;
}) {
  // The widget's rows: the ones the chart grouped.
  const rows = useRowOrdersSelector();
  const { rowMap, peekRowDocFromSeed } = useDatabaseContext();
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (resolved || !rows) return;
    const docs: Record<string, YDoc> = {};
    const rowIds = rows.map((row) => row.id);

    rowIds.forEach((rowId) => {
      const doc = resolveDrillRowDoc(rowId, rowMap, peekRowDocFromSeed);

      if (doc) docs[rowId] = doc;
    });
    const present = rowIds.filter((rowId) => docs[rowId]);

    onResolve({
      x: request.x ? resolvedSize(present, docs, request.x.field, request.x) : undefined,
      sub: request.sub ? resolvedSize(present, docs, request.sub.field, { min: null, max: null }) : undefined,
    });
    setResolved(true);
  }, [resolved, rows, rowMap, peekRowDocFromSeed, request, onResolve]);

  return null;
}

/**
 * Resolves the automatic range sizes of a Number axis from the widget's rows,
 * once per open, as the chart does (`resolveNumberBuckets` over the values).
 * Render it in the widget's context (not the drill's); it reports no load.
 */
export function NumberBucketProbe(props: { request: AutoBucketRequest; onResolve: (sizes: AutoBucketSizes) => void }) {
  return (
    <RowOrdersLoadReporterContext.Provider value={undefined}>
      <NumberBucketReader {...props} />
    </RowOrdersLoadReporterContext.Provider>
  );
}
