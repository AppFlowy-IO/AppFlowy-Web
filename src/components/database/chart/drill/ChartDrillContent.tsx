import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useDatabase,
  useDatabaseContext,
  useDatabaseExtraFilters,
  useDatabaseView,
  useFiltersSelector,
} from '@/application/database-yjs';
import {
  DatabaseExtraFiltersContext,
  DatabaseSearchQueryContext,
  DatabaseViewOverlayContext,
} from '@/application/database-yjs/context';
import { collectDatabaseViewNames, nextViewName } from '@/application/database-yjs/dashboard-owned-views';
import { sameFilters } from '@/application/database-yjs/dashboard-private';
import { ChartDrillTarget, DrillCategoryChip } from '@/application/database-yjs/drill-query';
import { leavesPage, readViewOpenPagesIn, resolveRecordOpening } from '@/application/database-yjs/open-pages-in';
import { type Row, RowOrdersLoadReporterContext } from '@/application/database-yjs/selector';
import { RowId, UIVariant, YjsDatabaseKey } from '@/application/types';
import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';
import { useDashboardContextOptional } from '@/components/database/dashboard/DashboardContext';

import { DrillFilterBar } from './DrillFilterBar';
import { DrillHeader, DrillSearchState } from './DrillHeader';
import { DrillMoreMenu, DrillMoreMenuProps } from './DrillMoreMenu';
import { DrillEmptyKind, DrillTable } from './DrillTable';
import { NumberBucketProbe, useDrillGroupFields } from './useDrillGroupFields';
import { useDrillRows } from './useDrillRows';
import { useDrillSession } from './useDrillSession';
import { useSaveDrillAsView } from './useSaveDrillAsView';
import { useSourceDatabase } from './useSourceDatabase';

/** The drill search follows the input this long after the last keystroke (WP13 §3.6). */
export const DRILL_SEARCH_DEBOUNCE_MS = 300;

export type DrillVariant = 'dialog' | 'sheet';

export interface ChartDrillContentProps {
  target: ChartDrillTarget;
  title: string;
  onClose: () => void;
  variant: DrillVariant;
}

/** A phone (or a web viewport under 768px): the dashboard's mobile context, else the viewport's. */
export function useDrillMobileContext() {
  const viewport = useMobileContext();

  return useDashboardContextOptional()?.mobileContext ?? viewport;
}

interface DrillLayoutProps {
  title: string;
  variant: DrillVariant;
  rows: Row[] | undefined;
  chips: DrillCategoryChip[];
  showDrillFilters: boolean;
  search: DrillSearchState;
  more: DrillMoreMenuProps | null;
  emptyKind: DrillEmptyKind;
  onClearSearch: () => void;
  onOpenRow: (rowId: RowId) => void;
  alwaysShowOpen: boolean;
  onClose: () => void;
}

function DrillLayout({
  title,
  variant,
  rows,
  chips,
  showDrillFilters,
  search,
  more,
  emptyKind,
  onClearSearch,
  onOpenRow,
  alwaysShowOpen,
  onClose,
}: DrillLayoutProps) {
  return (
    <>
      <DrillHeader
        more={more ? <DrillMoreMenu {...more} /> : null}
        onClose={onClose}
        rowCount={rows?.length}
        search={search}
        title={title}
        variant={variant}
      />
      <DrillFilterBar chips={chips} showDrillFilters={showDrillFilters} variant={variant} />
      <DrillTable
        alwaysShowOpen={alwaysShowOpen}
        emptyKind={emptyKind}
        onClearSearch={search.value ? onClearSearch : undefined}
        onOpenRow={onOpenRow}
        rows={rows}
        variant={variant}
      />
    </>
  );
}

/** Inside the drill providers: the live rows, and whether a drill-local filter narrows them. */
function DrillLiveBody({
  rowAllowList,
  seedFilters,
  searching,
  ...layout
}: Omit<DrillLayoutProps, 'rows' | 'emptyKind' | 'showDrillFilters'> & {
  rowAllowList: RowId[] | null;
  seedFilters: Record<string, unknown>[];
  searching: boolean;
}) {
  const { rows } = useDrillRows({ rowAllowList });
  // Re-renders when the drill's filters change.
  const filters = useFiltersSelector();
  const view = useDatabaseView();
  const drillFiltered = useMemo(() => {
    void filters;
    return !sameFilters(view?.get(YjsDatabaseKey.filters), seedFilters);
  }, [filters, view, seedFilters]);

  return (
    <DrillLayout
      {...layout}
      emptyKind={searching || drillFiltered ? 'noResults' : 'noData'}
      rows={rows}
      showDrillFilters
    />
  );
}

/**
 * The drill-down content (WP13 §3.3–§3.12): the drill session, its nested
 * providers (the drill's own view overlay, the global plus category extra
 * filters, the drill search; no load reporting), then the header, the chips
 * and the live table. The dialog and the phone sheet (WP14) both host it.
 * Render it inside the widget's (or the chart page's) database context.
 */
export function ChartDrillContent({ target, title, onClose, variant }: ChartDrillContentProps) {
  const fields = useDrillGroupFields(target);
  const session = useDrillSession({
    target,
    xField: fields.xField,
    subGroupField: fields.subGroupField,
    ready: fields.ready,
  });
  const context = useDatabaseContext();
  const database = useDatabase();
  const widgetExtraFilters = useDatabaseExtraFilters();
  const mobile = useDrillMobileContext();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const next = searchValue.trim();

    if (next === query) return;
    // Clearing applies at once; typing waits for a pause.
    if (!next) {
      setQuery('');
      return;
    }

    const timer = window.setTimeout(() => setQuery(next), DRILL_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [searchValue, query]);

  const search = useMemo<DrillSearchState>(
    () => ({ open: searchOpen, setOpen: setSearchOpen, value: searchValue, setValue: setSearchValue }),
    [searchOpen, searchValue]
  );
  const clearSearch = useCallback(() => {
    setSearchValue('');
    setQuery('');
    setSearchOpen(false);
  }, []);

  const { readOnly, canWrite, variant: uiVariant, isDocumentBlock, databaseDoc, activeViewId, navigateToRow } = context;
  const publish = uiVariant === UIVariant.Publish;
  const openRow = useCallback(
    (rowId: RowId) => {
      // A drill-down uses the chart view's "Open pages in".
      const opening = resolveRecordOpening({
        readOnly,
        isDocumentBlock: Boolean(isDocumentBlock),
        publish,
        mobile,
        raw: readViewOpenPagesIn(databaseDoc, activeViewId),
        source: 'drilldown',
      });

      // Peeks stack above the live table; a page (full page, a phone, a
      // published row page) closes the drill-down first.
      if (leavesPage(opening)) onClose();
      navigateToRow?.(rowId, undefined, { source: 'drilldown' });
    },
    [readOnly, isDocumentBlock, publish, mobile, databaseDoc, activeViewId, navigateToRow, onClose]
  );

  const viewName = String(useDatabaseView()?.get(YjsDatabaseKey.name) ?? '');
  const source = useSourceDatabase(viewName || title);
  const saveView = useSaveDrillAsView({
    drillView: session.overlayView,
    globals: widgetExtraFilters ?? [],
    categoryNodes: session.category.nodes,
    containerViewId: source.containerViewId,
    onClose,
  });
  const openSourceDatabase = source.open;
  const openDatabase = useCallback(() => {
    onClose();
    void openSourceDatabase();
  }, [onClose, openSourceDatabase]);
  const defaultViewName = useMemo(() => nextViewName(title, collectDatabaseViewNames(database)), [title, database]);
  const canSaveView = !readOnly && canWrite !== false;
  const more = useMemo<DrillMoreMenuProps | null>(
    () =>
      publish || (!canSaveView && !source.canOpen)
        ? null
        : {
            canSaveView,
            saveDisabled: session.category.rowAllowList !== null,
            databaseName: source.name,
            onOpenDatabase: openDatabase,
            defaultViewName,
            onSaveView: saveView,
          },
    [
      publish,
      canSaveView,
      source.canOpen,
      source.name,
      session.category.rowAllowList,
      openDatabase,
      defaultViewName,
      saveView,
    ]
  );

  const layout = {
    title,
    variant,
    chips: session.category.chips,
    search,
    more,
    onClearSearch: clearSearch,
    onOpenRow: openRow,
    alwaysShowOpen: mobile,
    onClose,
  };

  return (
    <div
      className='flex h-full min-h-0 w-full flex-col'
      data-testid={variant === 'sheet' ? 'chart-drilldown' : 'chart-drilldown-content'}
    >
      {fields.autoBuckets ? (
        <NumberBucketProbe onResolve={fields.setAutoBucketSizes} request={fields.autoBuckets} />
      ) : null}
      {session.overlayView && session.ready ? (
        <DatabaseViewOverlayContext.Provider value={session.overlayView}>
          <DatabaseExtraFiltersContext.Provider value={session.extraFilters}>
            <DatabaseSearchQueryContext.Provider value={query}>
              {/* A drill session is not a dashboard source: it never reports load. */}
              <RowOrdersLoadReporterContext.Provider value={undefined}>
                <DrillLiveBody
                  {...layout}
                  rowAllowList={session.category.rowAllowList}
                  searching={query !== ''}
                  seedFilters={session.seedFilters}
                />
              </RowOrdersLoadReporterContext.Provider>
            </DatabaseSearchQueryContext.Provider>
          </DatabaseExtraFiltersContext.Provider>
        </DatabaseViewOverlayContext.Provider>
      ) : (
        <DrillLayout {...layout} emptyKind='noData' rows={undefined} showDrillFilters={false} />
      )}
    </div>
  );
}

export default ChartDrillContent;
