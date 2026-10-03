import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseContext, useRowMap, useRowOrdersSelector } from '@/application/database-yjs';
import { ChartFormatYField } from '@/application/database-yjs/chart-format';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  ChartType,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { RowId, YDatabaseField, YDoc } from '@/application/types';

import { chartDataEqual } from '../widgets/chartUtils';

import { ChartRowDocs, ChartWatchedRowData, computeChartData, computeNumberChartData } from './chartCompute';
import { createChartLabels } from './chartGrouping';
import { useChartedRowDataClock } from './useChartedRowDataClock';
import { useChartFields } from './useChartFields';
import { resolveChartRowDoc, useChartRowHydration } from './useChartRowHydration';

export interface UseChartDataOptions {
  settings: ChartLayoutSettings | null;
}

export interface UseChartDataReturn {
  chartData: ChartDataItem[];
  isLoading: boolean;
  xAxisField: YDatabaseField | null;
  fieldType: FieldType | null;
  /** Whether the database has a field a chart can group by (`GROUPABLE_FIELD_TYPES`). */
  hasGroupableFields: boolean;
  /** What the chart computes, formats and titles (`resolveEffectiveAggregation`). */
  effectiveAggregation: ChartAggregationType;
  /** Current name of the Y field (empty when the chart counts rows), kept fresh across renames. */
  yFieldName: string;
  /** The Y field's kind and format as R-FORMAT needs them; null when the chart counts rows. */
  yFormatField: ChartFormatYField | null;
  /** The rows failed to load and the chart has none to show. */
  loadError: boolean;
  /** Load the rows that failed again */
  retry: () => void;
}

/** The docs the chart reads, in row order, and the same docs by row id. */
interface ChartedRows {
  docs: YDoc[];
  byId: ChartRowDocs;
}

const EMPTY_CHART_DATA: ChartDataItem[] = [];
const NO_CHARTED_ROWS: ChartedRows = { docs: [], byId: {} };

function isFieldId(value: string | null | undefined): value is string {
  return Boolean(value);
}

/**
 * Chart data from the database rows. It composes four parts:
 *
 * 1. `useChartFields`: the X and Y fields, the effective aggregation and the
 *    Y format, kept current while Yjs mutates the schema in place.
 * 2. `useChartRowHydration`: the row docs. Seeded rows come from the shared
 *    detached docs of the background loader, the rest from `ensureRow`; the
 *    chart stays in the loading state until every row has its doc.
 * 3. `useChartedRowDataClock`: observers on the charted rows, so an edit to a
 *    cell the chart reads recomputes it.
 * 4. `chartCompute`: the pure transform, inside `useMemo`.
 *
 * The transform's inputs keep their identity while their content is the same
 * (row orders by id, row docs by object, settings by field), so unrelated
 * database changes do not regroup the rows.
 */
export function useChartData({ settings }: UseChartDataOptions): UseChartDataReturn {
  const rowOrders = useRowOrdersSelector();
  const liveRows = useRowMap();
  const { dataSource } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const {
    hasGroupableFields,
    resolvedXFieldId,
    xAxisField,
    fieldType,
    optionIdToName,
    optionIdToColor,
    effectiveAggregation,
    yAxisField,
    yFieldId,
    yFieldName,
    yFormatField,
    fieldsClock,
  } = useChartFields(settings);

  // Stable string representation of the row order. Yjs often returns a fresh
  // array reference even when the contents are unchanged, so we depend on the
  // joined ids in effects instead of the array identity.
  const rowIdsKey = useMemo(() => rowOrders?.map((r) => r.id).join(',') ?? '', [rowOrders]);
  // Boolean view of whether `rowOrders` has been observed at all. Needed
  // because `rowIdsKey` is `''` for both `undefined` and `[]`.
  const rowOrdersReady = !!rowOrders;
  // The same ids keep the same array: filtered and sorted views re-emit
  // `rowOrders` after unrelated changes, and cell edits bump `rowDataClock`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRowOrders = useMemo(() => rowOrders, [rowOrdersReady, rowIdsKey]);

  const isNumberChart = settings?.chartType === ChartType.Number;
  // A Number chart that counts rows only needs `rowOrders.length`, so it
  // skips row hydration entirely.
  const needsRowDocs = !isNumberChart || effectiveAggregation !== ChartAggregationType.Count;

  const { rowsLoaded, hasFailedRows, retry, cachedRowDocs } = useChartRowHydration({
    rowOrders: stableRowOrders,
    rowIdsKey,
    liveRows,
    needsRowDocs,
  });

  // The row docs the chart reads. The live row map is a new object whenever
  // any row doc of the database arrives or is canonicalised, and the loader
  // publishes its docs in batches, so the previous object is kept while every
  // charted doc is the same: the observers then stay attached, and the
  // transform below does not regroup the rows.
  // Nothing reads the docs while the rows load, so the walk waits until then.
  // History snapshots are immutable and decode rows through a bounded cache,
  // so they are never collected (which would pin every decoded doc).
  const collectsRowDocs = needsRowDocs && !isHistory;
  const chartedRowsRef = useRef<ChartedRows>(NO_CHARTED_ROWS);
  const chartedRows = useMemo(() => {
    const previous = chartedRowsRef.current;

    if (!collectsRowDocs) {
      chartedRowsRef.current = NO_CHARTED_ROWS;
      return NO_CHARTED_ROWS;
    }

    if (!rowsLoaded || !stableRowOrders) return previous;

    const docs: YDoc[] = [];
    const byId: Record<RowId, YDoc> = {};

    stableRowOrders.forEach((row) => {
      const doc = resolveChartRowDoc(row.id, liveRows, cachedRowDocs);

      if (!doc) return;
      docs.push(doc);
      byId[row.id] = doc;
    });

    // Each doc belongs to one row, so the same docs in the same order are the same rows.
    if (previous.docs.length === docs.length && previous.docs.every((doc, index) => doc === docs[index])) {
      return previous;
    }

    const next = { docs, byId };

    chartedRowsRef.current = next;
    return next;
  }, [collectsRowDocs, rowsLoaded, stableRowOrders, liveRows, cachedRowDocs]);

  // A history chart reads its snapshot rows straight from the row map.
  const rowDocs = isHistory ? liveRows : chartedRows.byId;

  // Only the cells the chart reads recompute it.
  const xFieldType = isNumberChart ? null : fieldType;
  const watchedXFieldId = isNumberChart ? null : resolvedXFieldId;
  const watched = useMemo<ChartWatchedRowData>(
    () => ({
      fieldIds: new Set([watchedXFieldId, yFieldId].filter(isFieldId)),
      // CreatedTime / LastEditedTime groups read the row's own timestamps.
      rowTimes: xFieldType === FieldType.CreatedTime || xFieldType === FieldType.LastEditedTime,
    }),
    [watchedXFieldId, yFieldId, xFieldType]
  );
  const rowDataClock = useChartedRowDataClock(chartedRows.docs, watched, collectsRowDocs && rowsLoaded);

  // Rows go back to `undefined` while a newly applied filter hydrates them:
  // show the loading state, not an empty chart.
  const isLoading = !rowsLoaded || !rowOrdersReady;
  // A chart that has rows keeps showing them; the failed rows are retried.
  const loadError = rowsLoaded && hasFailedRows && chartedRows.docs.length === 0;

  // The Number chart depends only on the aggregation, the Y field and the rows
  // (row docs only when it aggregates the Y field), so title / number format /
  // x-axis edits leave it alone. The item keeps its identity while the value
  // and row ids are unchanged, which lets the memoized NumberChart skip renders.
  const numberRowDocs = needsRowDocs ? rowDocs : null;
  const numberChartDataRef = useRef<ChartDataItem[]>(EMPTY_CHART_DATA);
  const numberChartData = useMemo<ChartDataItem[]>(() => {
    // Yjs mutates field maps (Y field renamed or retyped) and row docs in place.
    void fieldsClock;
    void rowDataClock;

    if (!isNumberChart || !rowsLoaded) return EMPTY_CHART_DATA;
    const next = computeNumberChartData({
      aggregation: effectiveAggregation,
      rowOrders: stableRowOrders,
      rowDocs: numberRowDocs,
      yField: yAxisField,
    });

    if (chartDataEqual(numberChartDataRef.current, next)) return numberChartDataRef.current;
    numberChartDataRef.current = next;
    return next;
  }, [
    isNumberChart,
    rowsLoaded,
    effectiveAggregation,
    yAxisField,
    stableRowOrders,
    numberRowDocs,
    fieldsClock,
    rowDataClock,
  ]);

  const { t } = useTranslation();
  // `t` changes only with the language, which re-translates the categories.
  const labels = useMemo(() => createChartLabels(t), [t]);

  // Only these settings regroup the rows: `settings` is a new object after any
  // chart write, style keys included, so the transform depends on the fields.
  const showEmptyValues = settings?.showEmptyValues ?? true;
  const cumulative = settings?.cumulative ?? false;
  const dateCondition = settings?.dateCondition ?? DateGroupCondition.Month;

  // `ChartProvider` keeps the previous array when this returns the same
  // content, so recomputing here never re-renders a chart by itself.
  const groupedChartData = useMemo<ChartDataItem[]>(() => {
    // Yjs mutates field maps and row docs in place, so their identity cannot
    // invalidate this memo after a schema-only change or a cell edit.
    void fieldsClock;
    void rowDataClock;

    if (isNumberChart || !rowsLoaded) return EMPTY_CHART_DATA;

    return computeChartData({
      aggregation: effectiveAggregation,
      yField: yAxisField,
      showEmptyValues,
      cumulative,
      dateCondition,
      rowOrders: stableRowOrders,
      rowDocs,
      xAxisField,
      fieldType,
      optionIdToName,
      optionIdToColor,
      labels,
    });
  }, [
    rowsLoaded,
    isNumberChart,
    effectiveAggregation,
    yAxisField,
    showEmptyValues,
    cumulative,
    dateCondition,
    stableRowOrders,
    rowDocs,
    xAxisField,
    fieldType,
    fieldsClock,
    rowDataClock,
    optionIdToName,
    optionIdToColor,
    labels,
  ]);

  return {
    chartData: isNumberChart ? numberChartData : groupedChartData,
    isLoading,
    xAxisField,
    fieldType,
    hasGroupableFields,
    effectiveAggregation,
    yFieldName,
    yFormatField,
    loadError,
    retry,
  };
}

export default useChartData;
