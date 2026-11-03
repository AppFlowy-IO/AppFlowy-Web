/**
 * The Group by rules of a chart (WP12 §1 decisions 9 and 10, §2.11): which
 * stored Group by is effective, which properties the Group by page offers,
 * and when the Group by and Group style rows show. Pure; desktop has the same
 * rules in `chart_group_by.dart`.
 */
import { ChartGroupStyle } from '@/application/database-yjs/chart-extended-settings';
import { ChartType, isChartXFieldType } from '@/application/database-yjs/chart.type';

/** The chart types that split their bars or lines by a Group by. */
const GROUP_BY_CHART_TYPES: ReadonlySet<ChartType> = new Set([ChartType.Bar, ChartType.Line, ChartType.HorizontalBar]);

/** The chart types that use the group style (stacked, grouped, percent). */
const GROUP_STYLE_CHART_TYPES: ReadonlySet<ChartType> = new Set([ChartType.Bar, ChartType.HorizontalBar]);

/** What a chart draws its series with: a group style, or `none` without a Group by (and for lines and donuts). */
export type ChartSeriesStyle = ChartGroupStyle | 'none';

/** A property as the Group by rules need it. */
export interface ChartGroupByFieldChoice {
  id: string;
  type: number;
}

/**
 * The effective Group by property, or `null`: the stored id names an existing
 * property a chart can group by, it is not the resolved X property, and the
 * chart is a bar or line chart. A stored id that fails any of these reads as
 * "no Group by" and is never rewritten (decision 9).
 */
export function resolveGroupByFieldId(
  storedFieldId: string | null | undefined,
  fields: readonly ChartGroupByFieldChoice[],
  resolvedXFieldId: string | null | undefined,
  chartType: ChartType
): string | null {
  if (!storedFieldId || !GROUP_BY_CHART_TYPES.has(chartType)) return null;
  if (storedFieldId === resolvedXFieldId) return null;
  const field = fields.find((candidate) => candidate.id === storedFieldId);

  return field && isChartXFieldType(field.type) ? field.id : null;
}

/** The properties the Group by page lists: every X-axis type in view order, without the X property. */
export function groupByCandidates<T extends ChartGroupByFieldChoice>(
  fields: readonly T[],
  xFieldId: string | null | undefined
): T[] {
  return fields.filter((field) => field.id !== xFieldId && isChartXFieldType(field.type));
}

/** The Group by row shows for bar, horizontal bar and line charts. */
export function isGroupByVisible(chartType: ChartType): boolean {
  return GROUP_BY_CHART_TYPES.has(chartType);
}

/** The Group style row shows for bar and horizontal bar charts with an effective Group by. */
export function isGroupStyleVisible(chartType: ChartType, hasGroupBy: boolean): boolean {
  return hasGroupBy && GROUP_STYLE_CHART_TYPES.has(chartType);
}

/**
 * The style a chart draws with (decision 10): the stored group style for a
 * bar or horizontal bar chart with an effective Group by, `none` otherwise.
 */
export function effectiveGroupStyle(
  chartType: ChartType,
  hasGroupBy: boolean,
  stored: ChartGroupStyle
): ChartSeriesStyle {
  return isGroupStyleVisible(chartType, hasGroupBy) ? stored : 'none';
}
