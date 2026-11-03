import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import {
  DATABASE_VIEW_LAYOUT_DEFAULT_NAMES,
  DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT,
} from '@/application/database-yjs/database-view-doc-ops';
import { DatabaseViewLayout, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { DatabaseViewCreationHint, DatabaseViewProBadge } from '@/components/_shared/DatabaseViewCreationItem';
import { MobileSheet, MobileSheetItem } from '@/components/_shared/mobile-drawer/MobileSheet';
import { ViewIcon } from '@/components/_shared/view-icon';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAddDatabaseViewMenu } from '@/components/database/components/tabs/AddViewButton';
import { Progress } from '@/components/ui/progress';
import { isLimitedDatabaseViewLayout } from '@/utils/subscription';

export interface MobileDatabaseViewPillProps {
  viewIds: string[];
  selectedViewId?: string;
  setSelectedViewId?: (viewId: string) => void;
  /** The database's page in the folder; the add flow's target. */
  databasePageId: string;
  /** Names from the folder, which win over the ones stored in the database. */
  viewNameById?: Record<string, string>;
  views: Y.Map<YDatabaseView> | undefined;
  readOnly: boolean;
  onBeforeViewAdded?: () => void;
  onAfterViewAdded?: () => void;
  onViewAdded?: (viewId: string) => void;
}

const NO_VIEW_SNAPSHOT = JSON.stringify([null, null]);

/**
 * A view's name and icon layout, followed live (a rename mutates the Y map in
 * place): the folder's name, else the stored one, else the layout's default.
 */
function useViewLabel(view: YDatabaseView | undefined, nameOverride: string | undefined) {
  const { t } = useTranslation();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!view) return () => undefined;
      view.observe(onStoreChange);
      return () => view.unobserve(onStoreChange);
    },
    [view]
  );
  const getSnapshot = useCallback(() => {
    if (!view) return NO_VIEW_SNAPSHOT;
    const layout = view.get(YjsDatabaseKey.layout);

    // Rust-backed Yjs enum values may be BigInt: only primitives in the snapshot.
    return JSON.stringify([
      view.get(YjsDatabaseKey.name) ?? null,
      layout === null || layout === undefined ? null : String(layout),
    ]);
  }, [view]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [rawName, rawLayout] = JSON.parse(snapshot) as [string | null, string | null];
  const databaseLayout = (rawLayout === null ? NaN : Number(rawLayout)) as DatabaseViewLayout;
  const name =
    nameOverride?.trim() || rawName?.trim() || DATABASE_VIEW_LAYOUT_DEFAULT_NAMES[databaseLayout] || t('untitled');
  const layout = DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT[databaseLayout] ?? ViewLayout.Grid;

  return { name, layout };
}

function ViewRow({
  viewId,
  view,
  nameOverride,
  selected,
  onSelect,
}: {
  viewId: string;
  view: YDatabaseView;
  nameOverride?: string;
  selected: boolean;
  onSelect: (viewId: string) => void;
}) {
  const { name, layout } = useViewLabel(view, nameOverride);

  return (
    <MobileSheetItem
      icon={<PageIcon className='!h-5 !w-5 text-base' iconSize={20} view={{ layout }} />}
      id={viewId}
      label={name}
      onSelect={() => onSelect(viewId)}
      trailing={
        selected ? (
          <CheckIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-primary' data-testid='view-pill-check' />
        ) : null
      }
    />
  );
}

type SheetScreen = 'views' | 'layouts';

/**
 * The view switcher of a database in a mobile context (WP14 §1.4.2, W-11), in
 * place of the tab strip: a pill with the current view's icon, name and a
 * chevron (the Flutter `_DatabaseViewSelectorButton`: padding 12/8/8/8,
 * radius 12, at most 200 wide, 14px medium). It opens a "{count} views" sheet
 * that lists the views with a check on the current one. Writers also get
 * "+ New view", which lists the layouts in the same sheet, never Dashboard (a
 * phone creates no dashboard). Renaming, reordering and deleting views stay
 * with the tab strip of a wider window.
 */
export function MobileDatabaseViewPill({
  viewIds,
  selectedViewId,
  setSelectedViewId,
  databasePageId,
  viewNameById,
  views,
  readOnly,
  onBeforeViewAdded,
  onAfterViewAdded,
  onViewAdded,
}: MobileDatabaseViewPillProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<SheetScreen>('views');
  const activeViewId =
    selectedViewId && viewIds.includes(selectedViewId) ? selectedViewId : viewIds[0] ?? databasePageId;
  const active = useViewLabel(views?.get(activeViewId), viewNameById?.[activeViewId]);
  const canAddView = !readOnly && Boolean(onViewAdded);
  const handleViewAdded = useCallback((viewId: string) => onViewAdded?.(viewId), [onViewAdded]);
  const addMenu = useAddDatabaseViewMenu({
    databasePageId,
    onBeforeAddView: onBeforeViewAdded,
    onAfterAddView: onAfterViewAdded,
    onViewAdded: handleViewAdded,
  });
  const { setMenuOpen } = addMenu;

  // The shared checkout flow closes its layout menu only after checkout opens.
  useEffect(() => {
    if (screen === 'layouts' && !addMenu.menuOpen) {
      setOpen(false);
      setScreen('views');
    }
  }, [screen, addMenu.menuOpen]);
  const showScreen = useCallback(
    (next: SheetScreen) => {
      setScreen(next);
      // The layout list runs the plan checks while it shows (Timeline, Dashboard).
      setMenuOpen(next === 'layouts');
    },
    [setMenuOpen]
  );
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) showScreen('views');
    },
    [showScreen]
  );
  const viewCount = viewIds.length;
  const title =
    screen === 'layouts'
      ? t('dashboard.picker.newView', { defaultValue: 'New view' })
      : t('dashboard.mobile.viewCount', {
          count: viewCount,
          defaultValue_one: '{{count}} view',
          defaultValue_other: '{{count}} views',
        });

  return (
    <>
      <button
        aria-haspopup='dialog'
        aria-expanded={open}
        className='inline-flex min-w-0 max-w-[200px] shrink items-center gap-1.5 rounded-[12px] bg-fill-content-hover py-2 pl-3 pr-2 text-sm font-medium leading-5 text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-border-theme-thick'
        data-state={open ? 'open' : 'closed'}
        data-testid='database-view-pill'
        data-view-id={activeViewId}
        onClick={() => handleOpenChange(true)}
        type='button'
      >
        <PageIcon className='!h-4 !w-4 shrink-0 text-sm' iconSize={16} view={{ layout: active.layout }} />
        <span className='min-w-0 truncate' data-testid='database-view-pill-name'>
          {active.name}
        </span>
        <ChevronDownIcon aria-hidden='true' className='h-2.5 w-2.5 shrink-0 text-icon-secondary' />
      </button>
      <MobileSheet
        onBack={screen === 'layouts' ? () => showScreen('views') : undefined}
        onOpenChange={handleOpenChange}
        open={open}
        sheet='views'
        title={title}
      >
        {screen === 'views' ? (
          <>
            {viewIds.map((viewId) => {
              const view = views?.get(viewId);

              if (!view) return null;
              return (
                <ViewRow
                  key={viewId}
                  nameOverride={viewNameById?.[viewId]}
                  onSelect={(id) => {
                    handleOpenChange(false);
                    setSelectedViewId?.(id);
                  }}
                  selected={viewId === activeViewId}
                  view={view}
                  viewId={viewId}
                />
              );
            })}
            {canAddView ? (
              <MobileSheetItem
                icon={<PlusIcon aria-hidden='true' />}
                id='new-view'
                label={t('dashboard.picker.newView', { defaultValue: 'New view' })}
                onSelect={() => showScreen('layouts')}
              />
            ) : null}
          </>
        ) : (
          addMenu.options
            .filter((option) => option.layout !== DatabaseViewLayout.Dashboard)
            .map((option) => {
              const action = addMenu.getAction(option.viewLayout);
              const openingCheckout = addMenu.checkoutLayout === option.viewLayout;

              return (
                <DatabaseViewCreationHint
                  key={option.layout}
                  enabled={isLimitedDatabaseViewLayout(option.viewLayout)}
                  reason={action.reason}
                >
                  <MobileSheetItem
                    disabled={action.type === 'disabled' || addMenu.addLoading || addMenu.checkoutLayout !== null}
                    icon={<ViewIcon layout={option.viewLayout} size='small' />}
                    id={`layout-${option.layout}`}
                    label={option.label}
                    trailing={openingCheckout ? (
                      <Progress role='progressbar' aria-label={t('databaseViewCreation.openingCheckout')} />
                    ) : action.requiresPro ? <DatabaseViewProBadge /> : null}
                    onSelect={() => {
                      if (action.type === 'upgrade') {
                        void addMenu.upgradeView(option.viewLayout);
                        return;
                      }

                      handleOpenChange(false);
                      void addMenu.addView(option.layout, option.label);
                    }}
                  />
                </DatabaseViewCreationHint>
              );
            })
        )}
      </MobileSheet>
    </>
  );
}

export default MobileDatabaseViewPill;
