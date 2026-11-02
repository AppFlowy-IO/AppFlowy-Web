import {
  Fragment,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import {
  useChartLayoutSetting,
  useDatabaseFields,
  useDatabaseViewId,
  usePropertiesSelector,
  useReadOnly,
} from '@/application/database-yjs';
import {
  buildChartPanelModel,
  ChartPanelAction,
  ChartPanelRowId,
  chartPatchFor,
  effectiveChartAggregation,
} from '@/application/database-yjs/chart-config';
import {
  CHART_TEXT_GROUPINGS,
  CHART_X_SORTS,
  ChartTextGrouping,
  ChartXSort,
  numberConditionalColorToPersisted,
} from '@/application/database-yjs/chart-extended-settings';
import {
  CHART_NUMBER_FORMATS,
  ChartNumberFormat,
  ChartType,
  defaultChartXField,
  DEFAULT_CHART_NUMBER_FORMAT,
  isChartXFieldType,
  isChartYFieldType,
  resolveChartStyle,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { BillingService } from '@/application/services/domains';
import type { Subscription } from '@/application/types';
import { YjsDatabaseKey } from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useIsOfficialHosted, useServerHostingMode } from '@/components/app/hooks/useServerInfo';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { useChartGroups } from '@/components/database/chart/chartGroupsRegistry';
import { groupByCandidates, resolveGroupByFieldId } from '@/components/database/chart/hooks/chartGroupBy';
import { getChartAggregationLabel, getChartSeriesTitle } from '@/components/database/chart/widgets/numberChartUtils';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';
import { cn } from '@/lib/utils';

import { ChartGroupByPage, ChartGroupByRow } from './ChartGroupByRow';
import { ChartGroupStyleControl } from './ChartGroupStyleControl';
import { chartPanelIconOf } from './chartPanelIcon';
import { toChartUpdate } from './chartPanelUpdate';
import { ChartSettingsRow } from './ChartSettingsRow';
import { ChartSettingsSection } from './ChartSettingsSection';
import { ChartTypeRow } from './ChartTypeRow';
import { CHART_DATE_CONDITIONS, chartDateConditionOption } from './dateConditions';
import { NumberChartTitleInput } from './NumberChartTitleInput';
import { BucketsPage } from './pages/BucketsPage';
import { CalculatePage } from './pages/CalculatePage';
import { FieldPickerPage } from './pages/FieldPickerPage';
import { GroupsPage } from './pages/GroupsPage';
import { useNumberColorLabel } from './pages/NumberColorChips';
import { NumberColorPage } from './pages/NumberColorPage';
import { OptionListPage } from './pages/OptionListPage';
import {
  ChartColorPage,
  ChartColorSetting,
  ChartDataLabelsSetting,
  ChartDecimalPlacesPage,
  ChartDecimalPlacesSetting,
  ChartLegendPage,
  ChartLegendSetting,
} from './style';

/** The pages the panel pushes; each is opened by the row with the same id. */
type ChartPanelPage =
  | 'x_what'
  | 'x_date_grouping'
  | 'x_text_grouping'
  | 'x_buckets'
  | 'x_sort'
  | 'x_groups'
  | 'y_what'
  | 'y_calculate'
  | 'y_decimals'
  | 'y_group_by'
  | 'style_color'
  | 'style_legend'
  | 'number_format'
  | 'number_color';

const SORT_LABELS: Record<ChartXSort, [string, string]> = {
  auto: ['chart.sort.default', 'Default'],
  manual: ['chart.sort.manual', 'Manual'],
  label_asc: ['chart.sort.labelAsc', 'A → Z'],
  label_desc: ['chart.sort.labelDesc', 'Z → A'],
  value_desc: ['chart.sort.valueDesc', 'Value high → low'],
  value_asc: ['chart.sort.valueAsc', 'Value low → high'],
};

const TEXT_GROUPING_LABELS: Record<ChartTextGrouping, [string, string]> = {
  exact: ['chart.settings.exactValue', 'Exact value'],
  first_letter: ['chart.settings.firstLetter', 'First letter'],
};

const NUMBER_FORMAT_LABELS: Record<ChartNumberFormat, [string, string]> = {
  auto: ['chart.number.formatAuto', 'Auto'],
  compact: ['chart.number.formatCompact', 'Compact'],
  percent: ['chart.number.formatPercent', 'Percent'],
};

/** The page part of an option test id: `x_sort` → `x-sort`. */
function pageTestId(page: ChartPanelPage) {
  return page.replace(/_/g, '-');
}

/**
 * The chart settings panel (WP11 §1.1): a host-agnostic body with the chart
 * type icon row and the sections of the chart type. Every choice is inline or
 * a page pushed onto the panel's own stack, so it works inside the
 * standalone gear menu and a dashboard widget's settings host without
 * opening overlays. Read-only viewers get nothing.
 */
export function ChartSettingsPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const settings = useChartLayoutSetting();
  const updateChartSetting = useUpdateChartSetting();
  const viewId = useDatabaseViewId();
  const groups = useChartGroups(viewId);
  const fields = useDatabaseFields();
  const { properties } = usePropertiesSelector(false);
  const isDark = Boolean(useContext(ThemeModeContext)?.isDark);
  const colorLabel = useNumberColorLabel();

  // Pro-plan gating of the premium chart types (`useSubscriptionPlan` is Pro on self-hosted servers).
  const isHosted = useIsOfficialHosted();
  const hostingMode = useServerHostingMode();
  const workspaceId = useUserWorkspaceInfo()?.selectedWorkspace.id;
  const getSubscriptions = useCallback(async (): Promise<Subscription[] | undefined> => {
    if (!workspaceId) return undefined;
    return BillingService.getWorkspaceSubscriptions(workspaceId);
  }, [workspaceId]);
  // Readers never see the panel: no subscription fetch for them. The plan is
  // shared with the add-widget flow: one request per workspace for a minute,
  // not one per open of the panel.
  const {
    isPro,
    isLoading: planLoading,
    hasError: planError,
    loadSubscription,
  } = useSubscriptionPlan(readOnly ? undefined : getSubscriptions, {
    cacheKey: workspaceId ? `dashboard-plan:${workspaceId}` : undefined,
  });
  // A click on a premium type while the plan is unknown asks for it once more.
  const resolvePro = useCallback(
    async () => {
      const plan = await loadSubscription();

      return plan === null ? null : getWorkspacePlanPolicy(hostingMode).hasProAccess(plan);
    },
    [hostingMode, loadSubscription]
  );
  // `?action=change_plan` opens the upgrade modal (`UpgradePlan` in `Workspaces`).
  const [, setSearch] = useSearchParams();
  const handleUpgrade = useCallback(() => {
    if (!isHosted) return;
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [isHosted, setSearch]);

  const chartType = settings?.chartType ?? ChartType.Bar;
  const config = resolveChartStyle(settings);
  const aggregation = Number(settings?.aggregationType ?? 0);
  const fieldChoices = useMemo(
    () =>
      properties.map((property) => ({
        id: property.id,
        name: property.name,
        type: property.type,
        isPrimary: Boolean(fields?.get(property.id)?.get(YjsDatabaseKey.is_primary)),
      })),
    [properties, fields]
  );
  const xChoices = useMemo(() => fieldChoices.filter((field) => isChartXFieldType(field.type)), [fieldChoices]);
  const yChoices = useMemo(() => fieldChoices.filter((field) => isChartYFieldType(field.type)), [fieldChoices]);
  const xField =
    xChoices.find((field) => field.id === settings?.xFieldId) ?? defaultChartXField(xChoices) ?? null;
  const yField = settings?.yFieldId ? yChoices.find((field) => field.id === settings.yFieldId) ?? null : null;
  const xType = xField?.type ?? null;
  const yType = yField?.type ?? null;
  const effective = effectiveChartAggregation(aggregation, yType);
  // WP12: the effective Group by (a property a chart can group by, not X, on a bar or line chart).
  const groupByChoices = useMemo(() => groupByCandidates(fieldChoices, xField?.id), [fieldChoices, xField?.id]);
  const groupByFieldId = resolveGroupByFieldId(config.groupByFieldId, fieldChoices, xField?.id, chartType);
  const groupByField = groupByFieldId ? fieldChoices.find((field) => field.id === groupByFieldId) ?? null : null;
  const model = buildChartPanelModel({
    chartType,
    xType,
    yType,
    aggregation,
    showTitle: config.showTitle,
    groupBy: groupByField !== null,
  });

  // One action is one `updateChartSetting` call: picking the Group by property as X also clears it, in one undo step.
  const storedGroupByFieldId = config.groupByFieldId;
  const apply = useCallback(
    (action: ChartPanelAction) => {
      const patch = chartPatchFor(action, {
        x_sort: config.xSort,
        aggregation_type: aggregation,
        group_by_field_id: storedGroupByFieldId,
      });
      const { settings: base, extended } = toChartUpdate(patch);

      updateChartSetting(base, extended);
    },
    [config.xSort, aggregation, storedGroupByFieldId, updateChartSetting]
  );

  // Page stack: one level deep; Back (or Escape) returns to the root and focuses the opening row.
  const [page, setPage] = useState<ChartPanelPage | null>(null);
  const returnRowRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(page);

  // Written after commit, not during render: the Escape handler must not see a
  // page from a render React discarded.
  useLayoutEffect(() => {
    pageRef.current = page;
  }, [page]);

  const open = useCallback((next: ChartPanelPage) => {
    returnRowRef.current = next;
    setPage(next);
  }, []);
  const back = useCallback(() => setPage(null), []);

  useLayoutEffect(() => {
    if (page !== null || !returnRowRef.current) return;
    const row = panelRef.current?.querySelector<HTMLElement>(`[data-row-id="${returnRowRef.current}"]`);

    returnRowRef.current = null;
    row?.focus();
  }, [page]);

  // Radix closes its menu on Escape from a document capture listener, which the
  // panel registers before (it mounts first): on a page Escape goes back
  // instead; on the root it closes the host and discards a title draft.
  const titleCancelledRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const panel = panelRef.current;

      if (event.key !== 'Escape' || !panel) return;
      const scope = panel.closest('[role="menu"]') ?? panel;
      const active = document.activeElement;

      if (active && active !== document.body && !scope.contains(active)) return;
      if (pageRef.current !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPage(null);
        return;
      }

      titleCancelledRef.current = true;
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Losing edit rights removes the title input like a close: its draft is not saved. This layout
  // effect runs before the removed input's unmount save (a passive effect cleanup).
  useLayoutEffect(() => {
    if (readOnly) titleCancelledRef.current = true;
  }, [readOnly]);

  // Keys stay in the panel, so a menu host does no typeahead or roving focus here.
  const stopKeys = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') event.stopPropagation();
  };

  const icon = (rowId: ChartPanelRowId): ReactNode => chartPanelIconOf(rowId);
  const label = (key: [string, string]) => t(key[0], { defaultValue: key[1] });
  const dateLabel = (value: number) => {
    const option = chartDateConditionOption(value);

    return t(option.labelKey, { defaultValue: option.fallback });
  };

  const totalGroups = groups?.length ?? 0;
  const hiddenCount = groups?.filter((group) => group.hidden).length ?? 0;
  const autoCaption = getChartSeriesTitle(t, { aggregation: effective, yFieldName: yField?.name ?? '' });
  const countAll = t('chart.agg.countAll', { defaultValue: 'Count all' });

  const renderRow = (rowId: ChartPanelRowId, rowLabel: string, disabled?: boolean): ReactNode => {
    const common = { rowId, label: rowLabel, icon: icon(rowId), disabled };

    switch (rowId) {
      case 'chart_type':
        return (
          <ChartTypeRow
            key={`${workspaceId}:${viewId}`}
            value={chartType}
            isPro={isPro}
            planKnown={!planLoading && !planError}
            isHosted={isHosted}
            onChange={(value) => apply({ kind: 'chart_type', value })}
            onUpgrade={handleUpgrade}
            resolvePro={resolvePro}
          />
        );
      case 'x_what':
        return (
          <ChartSettingsRow
            {...common}
            parityId='dash-chart-panel-row-what-to-show'
            value={xField?.name}
            onClick={() => open('x_what')}
          />
        );
      case 'x_date_grouping':
        return (
          <ChartSettingsRow
            {...common}
            value={dateLabel(settings?.dateCondition ?? DateGroupCondition.Month)}
            onClick={() => open('x_date_grouping')}
          />
        );
      case 'x_text_grouping':
        return (
          <ChartSettingsRow
            {...common}
            value={label(TEXT_GROUPING_LABELS[config.xTextGrouping])}
            onClick={() => open('x_text_grouping')}
          />
        );
      case 'x_buckets':
        return (
          <ChartSettingsRow
            {...common}
            value={
              config.xNumberBucketSize === null
                ? t('chart.settings.auto', { defaultValue: 'Auto' })
                : t('chart.settings.size', { defaultValue: 'Size {{size}}', size: config.xNumberBucketSize })
            }
            onClick={() => open('x_buckets')}
          />
        );
      case 'x_sort':
        return <ChartSettingsRow {...common} value={label(SORT_LABELS[config.xSort])} onClick={() => open('x_sort')} />;
      case 'x_groups':
        return (
          <ChartSettingsRow
            {...common}
            value={
              hiddenCount > 0
                ? t('chart.groups.visibleOfTotal', {
                    defaultValue: '{{visible}} of {{total}}',
                    visible: totalGroups - hiddenCount,
                    total: totalGroups,
                  })
                : groups
                ? String(totalGroups)
                : undefined
            }
            onClick={() => open('x_groups')}
          />
        );
      case 'x_show_empty':
        return (
          <ChartSettingsRow
            {...common}
            toggle={{
              checked: settings?.showEmptyValues ?? true,
              onChange: (value) => apply({ kind: 'show_empty', value }),
            }}
          />
        );
      case 'y_what':
        return (
          <ChartSettingsRow
            {...common}
            parityId='dash-chart-panel-row-what-to-show'
            value={yField?.name ?? countAll}
            onClick={() => open('y_what')}
          />
        );
      case 'y_calculate':
        return (
          <ChartSettingsRow
            {...common}
            value={disabled ? countAll : getChartAggregationLabel(t, effective)}
            onClick={() => open('y_calculate')}
          />
        );
      case 'y_decimals':
        return (
          <ChartDecimalPlacesSetting
            icon={icon(rowId)}
            value={config.decimalPlaces}
            onOpen={() => open('y_decimals')}
          />
        );
      case 'y_group_by':
        return (
          <ChartGroupByRow
            icon={icon(rowId)}
            label={rowLabel}
            fieldName={groupByField?.name ?? null}
            onOpen={() => open('y_group_by')}
          />
        );
      case 'y_group_style':
        return (
          <ChartGroupStyleControl
            icon={icon(rowId)}
            label={rowLabel}
            value={config.groupStyle}
            onChange={(value) => apply({ kind: 'group_style', value })}
          />
        );
      case 'y_cumulative':
        return (
          <ChartSettingsRow
            {...common}
            toggle={{ checked: settings?.cumulative ?? false, onChange: (value) => apply({ kind: 'cumulative', value }) }}
          />
        );
      case 'style_color':
        return (
          <ChartColorSetting icon={icon(rowId)} value={config.colorTheme} onOpen={() => open('style_color')} />
        );
      case 'style_data_labels':
        return (
          <ChartDataLabelsSetting
            icon={icon(rowId)}
            value={config.showDataLabels}
            onChange={(value) => apply({ kind: 'show_data_labels', value })}
          />
        );
      case 'style_legend':
        return (
          <ChartLegendSetting icon={icon(rowId)} value={config.legendPosition} onOpen={() => open('style_legend')} />
        );
      case 'number_title':
        return (
          <ChartSettingsRow
            {...common}
            testId='chart-number-title-toggle'
            toggle={{ checked: config.showTitle, onChange: (value) => apply({ kind: 'show_title', value }) }}
          />
        );
      case 'number_title_input':
        return (
          <NumberChartTitleInput
            value={settings?.titleText ?? ''}
            placeholder={autoCaption}
            cancelledRef={titleCancelledRef}
            onCommit={(value) => apply({ kind: 'title_text', value })}
          />
        );
      case 'number_format':
        return (
          <ChartSettingsRow
            {...common}
            value={label(NUMBER_FORMAT_LABELS[settings?.numberFormat ?? DEFAULT_CHART_NUMBER_FORMAT])}
            onClick={() => open('number_format')}
          />
        );
      case 'number_color':
        return (
          <ChartSettingsRow
            {...common}
            value={
              config.numberConditionalColor?.enabled
                ? t('chart.numberColor.dynamic', { defaultValue: 'Dynamic' })
                : colorLabel(config.numberColor)
            }
            onClick={() => open('number_color')}
          />
        );
      default:
        return null;
    }
  };

  const rowTitle = (rowId: ChartPanelPage) => {
    for (const section of model) {
      const row = section.rows.find((item) => item.id === rowId);

      if (row) return t(row.labelKey, { defaultValue: row.label });
    }

    return '';
  };

  const renderPage = (current: ChartPanelPage): ReactNode => {
    const title = rowTitle(current);

    switch (current) {
      case 'x_what':
        return (
          <FieldPickerPage
            title={title}
            fields={xChoices}
            selectedId={xField?.id ?? null}
            onBack={back}
            onSelect={(fieldId) => {
              if (fieldId && fieldId !== settings?.xFieldId) apply({ kind: 'x_field', value: fieldId });
              back();
            }}
          />
        );
      case 'y_what':
        return (
          <FieldPickerPage
            title={title}
            fields={yChoices}
            selectedId={yField?.id ?? null}
            allowCountAll
            onBack={back}
            onSelect={(fieldId) => {
              const picked = fieldId ? yChoices.find((field) => field.id === fieldId) : null;

              if (!picked) apply({ kind: 'y_count_all' });
              else if (picked.id !== yField?.id) apply({ kind: 'y_field', value: picked.id, fieldType: picked.type });
              back();
            }}
          />
        );
      case 'x_date_grouping':
        return (
          <OptionListPage
            title={title}
            page={pageTestId(current)}
            selected={settings?.dateCondition ?? DateGroupCondition.Month}
            onBack={back}
            onSelect={(value) => apply({ kind: 'date_grouping', value })}
            options={CHART_DATE_CONDITIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey, { defaultValue: option.fallback }),
              testValue: String(option.value),
            }))}
          />
        );
      case 'x_text_grouping':
        return (
          <OptionListPage
            title={title}
            page={pageTestId(current)}
            selected={config.xTextGrouping}
            onBack={back}
            onSelect={(value) => apply({ kind: 'text_grouping', value })}
            options={CHART_TEXT_GROUPINGS.map((value) => ({ value, label: label(TEXT_GROUPING_LABELS[value]), testValue: value }))}
          />
        );
      case 'x_sort':
        return (
          <OptionListPage
            title={title}
            page={pageTestId(current)}
            selected={config.xSort}
            onBack={back}
            onSelect={(value) => apply({ kind: 'sort', value })}
            options={CHART_X_SORTS.map((value) => ({ value, label: label(SORT_LABELS[value]), testValue: value }))}
          />
        );
      case 'x_buckets':
        return (
          <BucketsPage
            title={title}
            value={{ size: config.xNumberBucketSize, min: config.xNumberBucketMin, max: config.xNumberBucketMax }}
            ranges={groups ?? []}
            onBack={back}
            onChange={(value) => apply({ kind: 'buckets', ...value })}
          />
        );
      case 'x_groups':
        return (
          <GroupsPage
            title={title}
            groups={groups}
            hiddenGroups={config.hiddenGroups}
            onBack={back}
            onHiddenChange={(value) => apply({ kind: 'hidden_groups', value })}
            onReorder={(value) => apply({ kind: 'drop_groups', value })}
          />
        );
      case 'y_calculate':
        return (
          <CalculatePage
            title={title}
            yType={yType}
            chartType={chartType}
            selected={effective}
            onBack={back}
            onSelect={(value) => apply({ kind: 'calculate', value })}
          />
        );
      case 'y_group_by':
        return (
          <ChartGroupByPage
            title={title}
            fields={groupByChoices}
            selectedId={groupByField?.id ?? null}
            dateCondition={config.groupByDateCondition}
            onBack={back}
            onSelect={(fieldId) => {
              if (fieldId !== storedGroupByFieldId) apply({ kind: 'group_by', value: fieldId });

              back();
            }}
            onSelectDate={(fieldId, value) => {
              apply({ kind: 'group_by_date', field: fieldId, value });
              back();
            }}
          />
        );
      case 'y_decimals':
        return (
          <ChartDecimalPlacesPage
            value={config.decimalPlaces}
            onBack={back}
            onChange={(value) => apply({ kind: 'decimal_places', value })}
          />
        );
      case 'style_color':
        return (
          <ChartColorPage
            value={config.colorTheme}
            isDark={isDark}
            onBack={back}
            onChange={(value) => apply({ kind: 'color_theme', value })}
          />
        );
      case 'style_legend':
        return (
          <ChartLegendPage
            value={config.legendPosition}
            onBack={back}
            onChange={(value) => apply({ kind: 'legend_position', value })}
          />
        );
      case 'number_format':
        return (
          <OptionListPage
            title={title}
            page={pageTestId(current)}
            selected={settings?.numberFormat ?? DEFAULT_CHART_NUMBER_FORMAT}
            onBack={back}
            onSelect={(value) => apply({ kind: 'number_format', value })}
            options={CHART_NUMBER_FORMATS.map((value) => ({ value, label: label(NUMBER_FORMAT_LABELS[value]), testValue: value }))}
          />
        );
      case 'number_color':
        return (
          <NumberColorPage
            title={title}
            numberColor={config.numberColor}
            conditional={config.numberConditionalColor}
            onBack={back}
            onNumberColorChange={(value) => apply({ kind: 'number_color', value })}
            onConditionalChange={(value) =>
              apply({ kind: 'conditional_color', value: numberConditionalColorToPersisted(value) })
            }
          />
        );
      default:
        return null;
    }
  };

  // A page whose row is gone (the chart type or the property changed under it) returns to the root.
  const shownPage = page && model.some((section) => section.rows.some((row) => row.id === page)) ? page : null;

  useEffect(() => {
    if (page !== null && shownPage === null) setPage(null);
  }, [page, shownPage]);

  if (readOnly) return null;

  return (
    <div
      ref={panelRef}
      role='group'
      aria-label={t('chart.settings.chartSettings', { defaultValue: 'Chart settings' })}
      data-testid='chart-settings-panel'
      data-page={shownPage ?? 'root'}
      data-chart-type={chartType}
      className={cn(
        'flex max-h-[min(560px,calc(100vh-32px))] w-full flex-col overflow-y-auto px-3 pb-3 pt-1 appflowy-scroller',
        className
      )}
      onKeyDown={stopKeys}
    >
      {shownPage
        ? renderPage(shownPage)
        : model.map((section) => (
            <ChartSettingsSection
              key={section.id}
              id={section.id}
              title={section.title ? t(section.titleKey, { defaultValue: section.title }) : ''}
            >
              {section.rows.map((row) => (
                <Fragment key={row.id}>
                  {renderRow(row.id, t(row.labelKey, { defaultValue: row.label }), row.disabled)}
                </Fragment>
              ))}
            </ChartSettingsSection>
          ))}
    </div>
  );
}

export default ChartSettingsPanel;
