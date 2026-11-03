import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import { useDatabaseExtraFilters, useDatabaseView } from '@/application/database-yjs/context';
import type { PrivateWidgetEntry } from '@/application/database-yjs/dashboard-private';
import type { DashboardExtraFilter } from '@/application/database-yjs/dashboard.type';
import {
  buildDrillCategory,
  ChartDrillTarget,
  DrillCategoryResult,
  DrillGroupField,
} from '@/application/database-yjs/drill-query';
import {
  createViewConditionsOverlay,
  getOverlayTarget,
  ViewConditionsOverlay,
} from '@/application/database-yjs/view-conditions-overlay';
import { YDatabaseView, YjsDatabaseKey } from '@/application/types';

/** The filters and sorts the widget shows right now, as plain JSON: the drill's starting point. */
function readEffectiveConditions(view: YDatabaseView): PrivateWidgetEntry {
  const plain = (key: YjsDatabaseKey.filters | YjsDatabaseKey.sorts) => {
    const array = (view as unknown as Y.Map<unknown>).get(key) as Y.Array<unknown> | undefined;

    return (array?.toJSON() ?? []) as Record<string, unknown>[];
  };

  return { filters: plain(YjsDatabaseKey.filters), sorts: plain(YjsDatabaseKey.sorts) };
}

export interface DrillSession {
  /** The drill's own view: a private copy of the widget's conditions over the real view. */
  overlayView: YDatabaseView | undefined;
  /** The widget's resolved global filters, then the category filters. */
  extraFilters: DashboardExtraFilter[];
  category: DrillCategoryResult;
  /** False until the chart settings (and the fields of the category) are read. */
  ready: boolean;
  /** The filters the drill started from (the widget's effective ones), to tell drill-local edits. */
  seedFilters: Record<string, unknown>[];
}

/**
 * The drill session (WP13 decision 1): a second view-conditions overlay over
 * the widget's real view, seeded from the widget's *effective* conditions
 * (its private copy in View mode, the saved view otherwise). Created once per
 * open and destroyed on unmount; nothing in it is ever written to the view,
 * so readers can edit its chips too. A drill session is not a dashboard
 * source: it never takes a load-scheduler slot.
 *
 * Call it inside the widget's database context, outside the drill providers.
 */
export function useDrillSession({
  target,
  xField,
  subGroupField,
  ready: fieldsReady,
}: {
  target: ChartDrillTarget;
  xField: DrillGroupField | null;
  subGroupField: DrillGroupField | null;
  ready: boolean;
}): DrillSession {
  const { t } = useTranslation();
  // The widget overlay proxy in View mode, the real view otherwise.
  const widgetView = useDatabaseView();
  const realView = widgetView ? getOverlayTarget(widgetView) : undefined;
  const widgetExtraFilters = useDatabaseExtraFilters();
  const [overlay, setOverlay] = useState<ViewConditionsOverlay | null>(null);
  const [seedFilters, setSeedFilters] = useState<Record<string, unknown>[]>([]);
  const widgetViewRef = useRef(widgetView);
  const hasView = Boolean(realView);

  useLayoutEffect(() => {
    widgetViewRef.current = widgetView;
  }, [widgetView]);

  // Once per open (and again after a remount): the effective conditions at
  // that moment seed the copy. A part equal to the saved one stays clean and
  // keeps following collaborators' saved edits.
  useLayoutEffect(() => {
    const view = widgetViewRef.current;

    if (!hasView || !view) return;
    const initial = readEffectiveConditions(view);
    const created = createViewConditionsOverlay(getOverlayTarget(view), { initial });

    setSeedFilters(initial.filters ?? []);
    setOverlay(created);
    return () => {
      created.destroy();
      setOverlay((current) => (current === created ? null : current));
    };
  }, [hasView]);

  // A replacement of the same view (sync) keeps the drill's own conditions;
  // the new proxy makes the rows resubscribe.
  const [, setRebinds] = useState(0);

  useEffect(() => {
    if (!overlay || !realView || overlay.realView === realView) return;
    overlay.rebind(realView);
    setRebinds((count) => count + 1);
  }, [overlay, realView]);

  // Captured once, so the relative date buckets match the chart that was clicked.
  const [now] = useState(() => new Date());
  const category = useMemo(
    () =>
      buildDrillCategory({
        target,
        xField,
        subGroupField,
        now,
        labels: {
          empty: t('chart.emptyValue', { defaultValue: 'Empty' }),
          selectedRows: (count) =>
            t('chart.drilldown.selectedRows', { count, defaultValue: 'Selected rows ({{count}})' }),
        },
      }),
    [target, xField, subGroupField, now, t]
  );

  const extraFilters = useMemo(
    () => [...(widgetExtraFilters ?? []), ...category.nodes],
    [widgetExtraFilters, category.nodes]
  );

  return {
    overlayView: overlay?.view,
    extraFilters,
    category,
    ready: fieldsReady && overlay !== null,
    seedFilters,
  };
}
