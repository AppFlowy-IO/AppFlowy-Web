import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { DatabaseViewLayout, UIVariant, ViewLayout } from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
import { useTimelineCreationDisabledReason } from '@/components/app/hooks/useTimelineCreationDisabledReason';

import { useDashboardContext, useDashboardLayout, useDashboardSources } from '../DashboardContext';
import { useDashboardHost } from '../DashboardUiContext';
import { useDashboardOwnerLookup } from '../hooks/useDashboardOwnerLookup';
import { useHostViews } from '../hooks/useHostViews';
import { useWidgetSourceName } from '../hooks/useWidgetSourceName';
import { useWorkspaceDatabases } from '../hooks/useWorkspaceDatabases';
import { getLayoutLabel } from '../utils';

import {
  buildWidgetPickerSections,
  catalogPrimaryViewOf,
  HostViewEntry,
  NEW_VIEW_LAYOUT_LABELS,
  PickerCreationState,
  toPickerCatalog,
  WidgetPickerSections,
} from './picker-sections';

export interface UseWidgetPickerSectionsOptions {
  mode: 'add' | 'replace';
  /** The database listed first: the host (add mode) or the widget's own database (replace mode). */
  primaryDatabaseId: string;
  /** Never offered (the flow's own default view). */
  excludeViewIds?: readonly string[];
  /** An offline add only writes a reference to an already existing view. */
  existingOnly?: boolean;
}

/** What `WidgetSourceList` renders: one object, unchanged while only the query as typed changes. */
export interface WidgetPickerListState {
  sections: WidgetPickerSections;
  expandOther: () => void;
  showAll: (databaseId: string) => void;
  catalogLoading: boolean;
  catalogFailed: boolean;
  /** Why Timeline cannot be created, when it is shown disabled. */
  timelineDisabledReason?: string;
  /** Why a Chart cannot be created, when it is shown disabled. */
  chartDisabledReason?: string;
  layoutLabel: (layout: DatabaseViewLayout) => string;
  primaryDatabaseName: string;
}

export interface WidgetPickerSectionsState extends WidgetPickerListState {
  /** The search as typed (the sections follow it when React has time). */
  query: string;
  setQuery: (query: string) => void;
  /** Sections for the query as typed right now (Enter in the search may beat the deferred list). */
  sectionsFor: (query: string) => WidgetPickerSections;
  /** A regular view of a database: it anchors a view created there. */
  anchorViewOf: (databaseId: string) => string | undefined;
  /**
   * The list's inputs without the query, memoized: the memoized
   * `WidgetSourceList` skips the urgent render of a keystroke and renders
   * once, for the deferred sections.
   */
  list: WidgetPickerListState;
}

/**
 * The inputs of `buildWidgetPickerSections` for one open picker: the host's
 * live views, the workspace catalog (loaded only once "Other data sources"
 * opens or a search starts; the "+" hover warms it), the owner lookup, the
 * Timeline and Chart creation states, and the picker's own query, expansion
 * and "Show more" state.
 */
export function useWidgetPickerSections({
  mode,
  primaryDatabaseId,
  excludeViewIds,
  existingOnly = false,
}: UseWidgetPickerSectionsOptions): WidgetPickerSectionsState {
  const { t } = useTranslation();
  const hostContext = useDatabaseContext();
  const database = useDatabase();
  const { hostDatabaseId, dashboardViewId } = useDashboardContext();
  const { hostViewIds } = useDashboardLayout();
  const { sourceDocs } = useDashboardSources();
  const { getSubscriptions, workspaceId } = useDashboardHost();
  const [query, setQuery] = useState('');
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const deferredQuery = useDeferredValue(query);
  const isPublish = hostContext.variant === UIVariant.Publish;
  const primaryIsHost = primaryDatabaseId === hostDatabaseId;
  const catalogWanted = !isPublish && (otherExpanded || query.trim().length > 0 || !primaryIsHost);
  const { databases: rawCatalog, loading, error } = useWorkspaceDatabases(hostContext.workspaceId, catalogWanted);
  const catalog = useMemo(() => toPickerCatalog(rawCatalog), [rawCatalog]);
  const hostViews = useHostViews(database);
  const catalogRef = useRef(rawCatalog);
  const sourceDocsRef = useRef(sourceDocs);

  catalogRef.current = rawCatalog;
  sourceDocsRef.current = sourceDocs;
  const ownerOf = useDashboardOwnerLookup({
    hostDoc: hostContext.databaseDoc,
    sourceDocs: sourceDocsRef,
    catalog: catalogRef,
  });
  const hostName = useWidgetSourceName(primaryDatabaseId, true) ?? '';
  const catalogPrimary = catalog.find((entry) => entry.databaseId === primaryDatabaseId);
  const primaryDatabaseName = hostName || catalogPrimary?.name || '';

  // Host views carry their collab owner; a foreign primary database lists its catalog views.
  const primaryViews = useMemo<HostViewEntry[]>(() => {
    if (primaryIsHost) {
      const icons = new Map(
        (rawCatalog.find((entry) => entry.database_id === primaryDatabaseId)?.views ?? []).map((view) => [
          view.view_id,
          view.icon ?? null,
        ])
      );

      return hostViews.map((view) => ({ ...view, icon: icons.get(view.viewId) ?? null }));
    }

    return (catalogPrimary?.views ?? [])
      .filter((view) => !view.isContainer)
      .map((view) => ({ viewId: view.viewId, name: view.name, layout: view.layout, embedded: false, icon: view.icon }));
  }, [catalogPrimary, hostViews, primaryDatabaseId, primaryIsHost, rawCatalog]);

  const timelineReason = useTimelineCreationDisabledReason(getSubscriptions, {
    workspaceId,
    enabled: mode === 'add' && !existingOnly,
  });
  const timelineCreation: PickerCreationState = timelineReason ? 'disabled' : 'enabled';
  const chartCreationAllowed =
    !getWorkspacePlanPolicy().requiresOnlineViewCreation(ViewLayout.Chart) ||
    (typeof navigator === 'undefined' ? true : navigator.onLine);
  const chartDisabledReason = chartCreationAllowed
    ? undefined
    : t('dashboard.widget.offline', { defaultValue: "Available when you're back online" });

  const layoutLabel = useCallback(
    (layout: DatabaseViewLayout) => {
      const entry = NEW_VIEW_LAYOUT_LABELS[layout];

      return t(entry.key, { defaultValue: entry.defaultValue });
    },
    [t]
  );
  const fallbackName = useCallback(
    (layout: ViewLayout) => {
      const label = getLayoutLabel(layout);

      return t(label.key, { defaultValue: label.defaultValue });
    },
    [t]
  );

  const excludeKey = (excludeViewIds ?? []).join('\n');

  const sectionsFor = useCallback(
    (forQuery: string) =>
      buildWidgetPickerSections({
        primaryDatabaseId,
        primaryDatabaseName,
        primaryIsHost,
        primaryViews,
        hostTabViewIds: primaryIsHost ? hostViewIds : null,
        ownerOf: (viewId) => ownerOf(viewId),
        dashboardViewId,
        excludeViewIds: excludeKey ? excludeKey.split('\n') : [],
        catalog,
        query: forQuery,
        otherExpanded,
        showAll: expandedGroups,
        timelineCreation,
        chartCreation: chartCreationAllowed ? 'enabled' : 'disabled',
        canCreateInOtherDatabases: Boolean(hostContext.loadView && hostContext.createDatabaseView),
        includeNewView: mode === 'add' && !existingOnly,
        layoutLabel,
        fallbackName,
      }),
    [
      catalog,
      chartCreationAllowed,
      dashboardViewId,
      excludeKey,
      existingOnly,
      expandedGroups,
      fallbackName,
      hostContext.createDatabaseView,
      hostContext.loadView,
      hostViewIds,
      primaryViews,
      layoutLabel,
      mode,
      otherExpanded,
      ownerOf,
      primaryDatabaseId,
      primaryDatabaseName,
      primaryIsHost,
      timelineCreation,
    ]
  );
  const sections = useMemo(() => sectionsFor(deferredQuery), [deferredQuery, sectionsFor]);

  const anchorViewOf = useCallback(
    (databaseId: string) => {
      const entry = rawCatalog.find((candidate) => candidate.database_id === databaseId);

      return entry ? catalogPrimaryViewOf(entry)?.view_id : undefined;
    },
    [rawCatalog]
  );

  const expandOther = useCallback(() => setOtherExpanded(true), []);
  const showAll = useCallback(
    (databaseId: string) => setExpandedGroups((current) => new Set([...Array.from(current), databaseId])),
    []
  );
  const catalogLoading = catalogWanted && loading;
  const catalogFailed = catalogWanted && Boolean(error) && !loading;
  const timelineDisabledReason = timelineCreation === 'disabled' ? timelineReason : undefined;
  const list = useMemo<WidgetPickerListState>(
    () => ({
      sections,
      expandOther,
      showAll,
      catalogLoading,
      catalogFailed,
      timelineDisabledReason,
      chartDisabledReason,
      layoutLabel,
      primaryDatabaseName,
    }),
    [
      catalogFailed,
      catalogLoading,
      chartDisabledReason,
      expandOther,
      layoutLabel,
      primaryDatabaseName,
      sections,
      showAll,
      timelineDisabledReason,
    ]
  );

  return { ...list, query, setQuery, sectionsFor, anchorViewOf, list };
}
