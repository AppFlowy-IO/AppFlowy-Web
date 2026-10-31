import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { buildIdentifierLabels, useDatabaseContext, useRowMap, useRowOrdersSelector } from '@/application/database-yjs';
import {
  ChartGroupNameLookup,
  ChartGroupSummary,
  EMPTY_GROUP_KEY,
  sortChartGroups,
} from '@/application/database-yjs/chart-config';
import { ChartFormatYField, formatChartValue } from '@/application/database-yjs/chart-format';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  ChartSeriesData,
  ChartType,
  EMPTY_CHART_SERIES_DATA,
  resolveChartStyle,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import {
  ensureRelationGroupLabel,
  getRelationGroupLabelRevision,
  readRelationGroupLabel,
  retainRelationGroupLabels,
  subscribeRelationGroupLabels,
} from '@/application/database-yjs/relation/cache';
import { RowId, YDatabaseField, YDoc, YjsDatabaseKey } from '@/application/types';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import { useAppLocale } from '@/i18n/useAppLocale';

import { chartDataEqual } from '../widgets/chartUtils';

import {
  ChartFactGroup,
  ChartGroupAxis,
  ChartRowDocs,
  ChartWatchedRowData,
  computeChartFacts,
  computeNumberChartData,
  EMPTY_CHART_FACTS,
  readsRowAttributes,
} from './chartCompute';
import { createChartLabels } from './chartGrouping';
import { buildChartSeriesWithGroups, chartSeriesDataEqual, ChartSeriesFieldKind } from './chartSeries';
import { useChartedRowDataClock } from './useChartedRowDataClock';
import { useChartFields } from './useChartFields';
import { resolveChartRowDoc, useChartRowHydration } from './useChartRowHydration';

export interface UseChartDataOptions {
  settings: ChartLayoutSettings | null;
}

export interface UseChartDataReturn {
  /** What bar, line and donut charts draw (WP12); empty for the Number chart. */
  seriesData: ChartSeriesData;
  /** The Number chart's value over every row; `null` while there is none (or for other charts). */
  numberItem: ChartDataItem | null;
  /** The effective Group by property, or `null`. */
  groupByField: YDatabaseField | null;
  isLoading: boolean;
  xAxisField: YDatabaseField | null;
  fieldType: FieldType | null;
  /** Whether the database has a field a chart can group by (`CHART_X_FIELD_TYPES`). */
  hasGroupableFields: boolean;
  /** What the chart computes, formats and titles (`effectiveChartAggregation`). */
  effectiveAggregation: ChartAggregationType;
  /** Every group in its sorted order, hidden ones included (the panel's Groups page). */
  allGroups: ChartGroupSummary[];
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
  /** The row set the docs were collected for (`stableRowOrders`). */
  rows: ReadonlyArray<{ id: string }> | undefined;
}

const EMPTY_GROUPS: ChartGroupSummary[] = [];
const NO_CHARTED_ROWS: ChartedRows = { docs: [], byId: {}, rows: undefined };
const PEOPLE_TYPES: ReadonlySet<FieldType> = new Set([FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy]);
const noSubscription = () => () => undefined;

/**
 * How long the chart keeps reading the docs it has when only their identity
 * changed: the loader connects the live doc of a seeded row a batch at a time
 * (`useBackgroundRowDocLoader`), and each batch would otherwise regroup every
 * row and re-observe every doc.
 */
const DOC_SWAP_SETTLE_MS = 250;

/**
 * The charted rows the transform reads. A new row set, or a doc for a row that
 * had none (a row loaded behind the chart), is taken at once. New docs for the
 * same rows (a seed replaced by its live doc, a doc replaced by its canonical
 * copy; the values are the same) are taken on a trailing throttle, so a
 * connect pass of n / batch commits costs a few regroups, not one per batch.
 * A cell edit in the meantime reaches the docs that are read.
 */
function useSettledChartedRows(rows: ChartedRows): ChartedRows {
  const [settled, setSettled] = useState(rows);
  const latestRef = useRef(rows);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each doc belongs to one row: the same rows with as many docs are the same rows with other docs.
  const isDocSwap = rows !== settled && rows.rows === settled.rows && rows.docs.length === settled.docs.length;

  // A new row set: adjusted while rendering, no extra commit.
  if (rows !== settled && !isDocSwap) setSettled(rows);

  useLayoutEffect(() => {
    latestRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!isDocSwap || timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setSettled(latestRef.current);
    }, DOC_SWAP_SETTLE_MS);
  }, [isDocSwap, rows]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  return isDocSwap ? settled : rows;
}

/** The display-name lookup of a people or Relation property's groups; `null` when its groups are named by key. */
function groupNameLookup(fieldType: FieldType | null, names: ChartGroupNameLookup | undefined) {
  if (!names) return null;
  if (fieldType === FieldType.Person) return names.person ?? null;
  if (fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy) return names.user ?? null;
  if (fieldType === FieldType.Relation) return names.relation ?? null;
  return null;
}

/**
 * The groups of a people or Relation property with their display names: the
 * workspace members and the related rows' titles arrive after the rows were
 * grouped, and only relabel them (the keys never change, so hidden and manual
 * groups hold). A group whose name is unknown keeps the placeholder of the
 * facts. The same array comes back when no label changes.
 */
function nameChartGroups(
  groups: ChartFactGroup[],
  fieldType: FieldType | null,
  names: ChartGroupNameLookup | undefined
): ChartFactGroup[] {
  const lookup = groupNameLookup(fieldType, names);

  if (!lookup) return groups;
  let changed = false;
  const named = groups.map((group) => {
    const raw = group.isEmpty ? undefined : lookup(group.key);
    const name = fieldType === FieldType.Relation ? raw?.trim() : raw;

    if (!name || name === group.label) return group;
    changed = true;
    return { ...group, label: name };
  });

  return changed ? named : groups;
}

function sameGroupSummaries(a: readonly ChartGroupSummary[], b: readonly ChartGroupSummary[]) {
  return (
    a.length === b.length &&
    a.every((group, index) => {
      const other = b[index];

      return (
        group.key === other.key &&
        group.label === other.label &&
        group.count === other.count &&
        group.hidden === other.hidden &&
        group.optionColor === other.optionColor &&
        group.checkboxState === other.checkboxState
      );
    })
  );
}

type GroupedField = { field: YDatabaseField | null; fieldType: FieldType | null };

function isPeopleType(fieldType: FieldType | null) {
  return fieldType !== null && PEOPLE_TYPES.has(fieldType);
}

/**
 * Names of the groups of people, users and related rows, for the X axis and
 * the Group by property: the workspace members (fetched only for a people
 * property), the Person type option, and the related rows' titles, which
 * load in the background and relabel the groups as they arrive
 * (`nameChartGroups`: the keys do not change, so hidden and manual groups
 * hold, and the rows are not regrouped). `watchedFieldsClock` is the X and
 * Group by fields' clock: Yjs mutates the Person type option in place.
 */
function useChartGroupNames(
  x: GroupedField,
  sub: GroupedField,
  isHistory: boolean,
  watchedFieldsClock: number
): { x: ChartGroupNameLookup | undefined; sub: ChartGroupNameLookup | undefined } {
  const needsMembers = isPeopleType(x.fieldType) || isPeopleType(sub.fieldType);
  const needsRelations = !isHistory && (x.fieldType === FieldType.Relation || sub.fieldType === FieldType.Relation);
  const { users } = useMentionableUsersWithAutoFetch(needsMembers);
  const relationRevision = useSyncExternalStore(
    needsRelations ? subscribeRelationGroupLabels : noSubscription,
    needsRelations ? getRelationGroupLabelRevision : () => 0
  );
  const { field: xField, fieldType: xType } = x;
  const { field: subField, fieldType: subType } = sub;
  // Person fallback names come from type options that Yjs mutates in place.
  const personOptionsRevision = xType === FieldType.Person || subType === FieldType.Person ? watchedFieldsClock : 0;

  return useMemo(() => {
    void relationRevision;
    void personOptionsRevision;
    const lookup = (field: YDatabaseField | null, fieldType: FieldType | null): ChartGroupNameLookup | undefined => {
      if (!field || fieldType === null) return undefined;
      if (isPeopleType(fieldType)) {
        const labels = buildIdentifierLabels({ fieldType, field, mentionableUsers: users });

        return { person: (id) => labels.get(id), user: (id) => labels.get(id) };
      }

      if (fieldType === FieldType.Relation && !isHistory) {
        return { relation: (id) => readRelationGroupLabel({ relationField: field, relatedRowId: id }) };
      }

      return undefined;
    };

    return { x: lookup(xField, xType), sub: lookup(subField, subType) };
  }, [xField, xType, subField, subType, isHistory, users, relationRevision, personOptionsRevision]);
}

/** What a property is for colours: option colours apply to selects, checkbox colours to checkboxes. */
function seriesFieldKind(fieldType: FieldType | null): ChartSeriesFieldKind {
  if (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect) return 'select';
  if (fieldType === FieldType.Checkbox) return 'checkbox';
  return 'other';
}

/** The ids of the related rows a Relation property's groups show (their titles load in the background). */
function relatedRowIdsOf(fieldType: FieldType | null, groups: readonly ChartFactGroup[] | null): string[] {
  if (fieldType !== FieldType.Relation || !groups) return [];
  return groups.filter((group) => group.key !== EMPTY_GROUP_KEY).map((group) => group.key);
}

const NO_AUTO_BUCKETS = { size: null, min: null, max: null };

/** Keeps the titles of the related rows the chart shows loaded (a Relation X axis outside history). */
function useChartRelationTitles(xAxisField: YDatabaseField | null, enabled: boolean, relatedRowIds: readonly string[]) {
  const { loadView, createRow, getViewIdFromDatabaseId } = useDatabaseContext();
  const key = enabled && xAxisField ? relatedRowIds.join('\n') : '';

  useEffect(() => {
    if (!xAxisField || !key) return;
    const ids = key.split('\n');
    const release = retainRelationGroupLabels(ids.map((relatedRowId) => ({ relationField: xAxisField, relatedRowId })));

    ids.forEach((relatedRowId) =>
      ensureRelationGroupLabel({ relationField: xAxisField, relatedRowId, loadView, createRow, getViewIdFromDatabaseId })
    );
    return release;
  }, [key, xAxisField, loadView, createRow, getViewIdFromDatabaseId]);
}

function isFieldId(value: string | null | undefined): value is string {
  return Boolean(value);
}

/**
 * Chart data from the database rows. It composes five parts:
 *
 * 1. `useChartFields`: the X, Y and Group by fields, the effective
 *    aggregation and the Y format, kept current while Yjs mutates the schema
 *    in place.
 * 2. `useChartRowHydration`: the row docs. Shared detached seeds supply the
 *    initial render while the background loader connects live rows through
 *    `ensureRow`; the chart loads until every row has its initial doc. The
 *    live docs replace the seeds a few at a time (`useSettledChartedRows`).
 * 3. `useChartedRowDataClock`: observers on the charted rows, so an edit to a
 *    cell the chart reads recomputes it.
 * 4. `computeChartFacts`: the cells the chart reads, one fact per row (the
 *    expensive half, inside `useMemo`).
 * 5. `buildChartSeries` (WP12): aggregation, sort, hidden groups, cumulative,
 *    percent shares, colours and the caps, over the facts, with the display
 *    names of people and related rows applied to the groups.
 *
 * The transform's inputs keep their identity while their content is the same
 * (row orders by id, row docs by object, settings by field), so unrelated
 * database changes do not regroup the rows; nor does a change to a field the
 * chart does not read (`watchedFieldsClock`).
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
    options,
    optionIdToColor,
    xNumberFormat,
    effectiveAggregation,
    yAxisField,
    yFieldId,
    yFieldName,
    yFormatField,
    watchedFieldsClock,
    groupByFieldId,
    groupByField,
    groupByFieldType,
    groupByOptions,
    groupByOptionIdToColor,
    groupByNumberFormat,
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

    const next: ChartedRows = { docs, byId, rows: stableRowOrders };

    chartedRowsRef.current = next;
    return next;
  }, [collectsRowDocs, rowsLoaded, stableRowOrders, liveRows, cachedRowDocs]);
  const settledRows = useSettledChartedRows(chartedRows);

  // A history chart reads its snapshot rows straight from the row map.
  const rowDocs = isHistory ? liveRows : settledRows.byId;

  // Only the cells the chart reads recompute it.
  const xFieldType = isNumberChart ? null : fieldType;
  const watchedXFieldId = isNumberChart ? null : resolvedXFieldId;
  const subFieldType = isNumberChart ? null : groupByFieldType;
  const watchedSubFieldId = isNumberChart ? null : groupByFieldId;
  const yAxisType = yAxisField ? (Number(yAxisField.get(YjsDatabaseKey.type)) as FieldType) : null;
  const watched = useMemo<ChartWatchedRowData>(
    () => ({
      fieldIds: new Set([watchedXFieldId, watchedSubFieldId, yFieldId].filter(isFieldId)),
      // Created / edited time and by read the row's own attributes.
      rowTimes: readsRowAttributes(xFieldType) || readsRowAttributes(subFieldType) || readsRowAttributes(yAxisType),
    }),
    [watchedXFieldId, watchedSubFieldId, yFieldId, xFieldType, subFieldType, yAxisType]
  );
  const rowDataClock = useChartedRowDataClock(settledRows.docs, watched, collectsRowDocs && rowsLoaded);

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
  const numberItemRef = useRef<ChartDataItem | null>(null);
  const numberItem = useMemo<ChartDataItem | null>(() => {
    // Yjs mutates field maps (Y field renamed or retyped) and row docs in place.
    void watchedFieldsClock;
    void rowDataClock;

    if (!isNumberChart || !rowsLoaded) return null;
    const next =
      computeNumberChartData({
        aggregation: effectiveAggregation,
        rowOrders: stableRowOrders,
        rowDocs: numberRowDocs,
        yField: yAxisField,
      })[0] ?? null;
    const previous = numberItemRef.current;

    if (previous && next && chartDataEqual([previous], [next])) return previous;
    numberItemRef.current = next;
    return next;
  }, [
    isNumberChart,
    rowsLoaded,
    effectiveAggregation,
    yAxisField,
    stableRowOrders,
    numberRowDocs,
    watchedFieldsClock,
    rowDataClock,
  ]);

  const { t } = useTranslation();
  // `t` changes only with the language, which re-translates the categories.
  const labels = useMemo(() => createChartLabels(t), [t]);
  // The app locale writes the date and number-range labels; the keys, and so the order, never depend on it.
  const locale = useAppLocale();
  const axisFormatter = useCallback(
    (numberFormat: number | null) => (value: number) =>
      formatChartValue(value, {
        aggregation: ChartAggregationType.Sum,
        yField: { type: 'number', numberFormat: numberFormat ?? 0 },
        mode: 'axis',
        locale,
      }),
    [locale]
  );
  const formatXAxis = useMemo(() => axisFormatter(xNumberFormat), [axisFormatter, xNumberFormat]);
  const formatSubAxis = useMemo(() => axisFormatter(groupByNumberFormat), [axisFormatter, groupByNumberFormat]);
  const names = useChartGroupNames(
    { field: isNumberChart ? null : xAxisField, fieldType: xFieldType },
    { field: isNumberChart ? null : groupByField, fieldType: subFieldType },
    isHistory,
    watchedFieldsClock
  );

  // Only these settings regroup the rows: `settings` is a new object after any
  // chart write, style keys included, so the transform depends on the fields.
  const config = resolveChartStyle(settings);
  const dateCondition = settings?.dateCondition ?? DateGroupCondition.Month;
  const textGrouping = config.xTextGrouping;
  const bucketSize = config.xNumberBucketSize;
  const bucketMin = config.xNumberBucketMin;
  const bucketMax = config.xNumberBucketMax;
  const groupByDateCondition = config.groupByDateCondition;

  const xAxis = useMemo<ChartGroupAxis | null>(() => {
    if (isNumberChart || !xAxisField || fieldType === null) return null;
    return {
      field: xAxisField,
      fieldType,
      dateCondition,
      textGrouping,
      buckets: { size: bucketSize, min: bucketMin, max: bucketMax },
      options,
      optionIdToColor,
      formatAxis: formatXAxis,
    };
  }, [
    isNumberChart,
    xAxisField,
    fieldType,
    dateCondition,
    textGrouping,
    bucketSize,
    bucketMin,
    bucketMax,
    options,
    optionIdToColor,
    formatXAxis,
  ]);
  // The Group by property buckets numbers automatically and groups text exactly (WP12 decision 11).
  const subAxis = useMemo<ChartGroupAxis | null>(() => {
    if (isNumberChart || !groupByField || groupByFieldType === null) return null;
    return {
      field: groupByField,
      fieldType: groupByFieldType,
      dateCondition: groupByDateCondition,
      textGrouping: 'exact',
      buckets: NO_AUTO_BUCKETS,
      options: groupByOptions,
      optionIdToColor: groupByOptionIdToColor,
      formatAxis: formatSubAxis,
    };
  }, [
    isNumberChart,
    groupByField,
    groupByFieldType,
    groupByDateCondition,
    groupByOptions,
    groupByOptionIdToColor,
    formatSubAxis,
  ]);

  // The cells: the expensive half, rerun only when the rows, the fields it
  // reads or the grouping keys change. The display names of people and
  // related rows are applied in the series step, so a name that arrives late
  // only relabels.
  const facts = useMemo(() => {
    // Yjs mutates field maps and row docs in place, so their identity cannot
    // invalidate this memo after a schema-only change or a cell edit.
    void watchedFieldsClock;
    void rowDataClock;

    if (isNumberChart || !rowsLoaded) return EMPTY_CHART_FACTS;

    return computeChartFacts({
      aggregation: effectiveAggregation,
      yField: yAxisField,
      rowOrders: stableRowOrders,
      rowDocs,
      labels,
      locale,
      x: xAxis,
      sub: subAxis,
    });
  }, [
    rowsLoaded,
    isNumberChart,
    effectiveAggregation,
    yAxisField,
    stableRowOrders,
    rowDocs,
    watchedFieldsClock,
    rowDataClock,
    labels,
    locale,
    xAxis,
    subAxis,
  ]);

  useChartRelationTitles(xAxisField, fieldType === FieldType.Relation && !isHistory, relatedRowIdsOf(fieldType, facts.xGroups));
  useChartRelationTitles(
    groupByField,
    groupByFieldType === FieldType.Relation && !isHistory,
    relatedRowIdsOf(groupByFieldType, facts.subGroups)
  );

  // The series (WP12): sort, hidden groups, cumulative, percent shares,
  // colours and the caps re-present the same facts without reading a cell.
  // The previous build is kept while the content is the same, so a chart
  // never re-renders for an unchanged build.
  const showEmptyValues = settings?.showEmptyValues ?? true;
  const cumulative = settings?.cumulative ?? false;
  const chartType = settings?.chartType ?? ChartType.Bar;
  const { xSort, xManualOrder, hiddenGroups, groupStyle, colorTheme } = config;
  const seriesDataRef = useRef<ChartSeriesData>(EMPTY_CHART_SERIES_DATA);
  const allGroupsRef = useRef<ChartGroupSummary[]>(EMPTY_GROUPS);
  const built = useMemo(() => {
    if (isNumberChart || !rowsLoaded || facts === EMPTY_CHART_FACTS) {
      return { data: EMPTY_CHART_SERIES_DATA, all: EMPTY_GROUPS };
    }

    // WP11's candidate order; the builder applies a value sort itself.
    const isValueSort = xSort === 'value_desc' || xSort === 'value_asc';
    const next = buildChartSeriesWithGroups({
      chartType,
      aggregation: effectiveAggregation,
      groupStyle,
      cumulative,
      showEmptyValues,
      hiddenGroups,
      xSort,
      colorTheme,
      xField: {
        kind: seriesFieldKind(fieldType),
        groups: sortChartGroups(
          nameChartGroups(facts.xGroups, fieldType, names.x),
          isValueSort ? 'auto' : xSort,
          xManualOrder
        ),
      },
      subField: facts.subGroups
        ? {
            kind: seriesFieldKind(groupByFieldType),
            groups: sortChartGroups(nameChartGroups(facts.subGroups, groupByFieldType, names.sub), 'auto'),
          }
        : null,
      rows: facts.rows,
    });
    const data = chartSeriesDataEqual(seriesDataRef.current, next.data) ? seriesDataRef.current : next.data;
    const all = sameGroupSummaries(allGroupsRef.current, next.groups) ? allGroupsRef.current : next.groups;

    seriesDataRef.current = data;
    allGroupsRef.current = all;
    return { data, all };
  }, [
    facts,
    isNumberChart,
    rowsLoaded,
    chartType,
    effectiveAggregation,
    groupStyle,
    cumulative,
    showEmptyValues,
    hiddenGroups,
    xSort,
    xManualOrder,
    colorTheme,
    fieldType,
    groupByFieldType,
    names.x,
    names.sub,
  ]);

  return {
    seriesData: built.data,
    numberItem,
    groupByField: isNumberChart ? null : groupByField,
    allGroups: built.all,
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
