import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED } from '@/application/constants';
import { useDatabaseContext } from '@/application/database-yjs/context';
import { useAddDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ViewIcon } from '@/components/_shared/view-icon';
import { useDashboardCreationGate } from '@/components/app/hooks/useDashboardCreationGate';
import { useTimelineCreationDisabledReason } from '@/components/app/hooks/useTimelineCreationDisabledReason';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getErrorMessage } from '@/utils/errors';

interface AddViewButtonProps {
  databasePageId: string;
  onBeforeAddView?: () => void;
  onAfterAddView?: () => void;
  onViewAdded: (viewId: string) => void;
}

/** One layout a new view can have, as the "+" menu and the phone's view list offer it. */
export interface AddViewLayoutOption {
  layout: DatabaseViewLayout;
  /** The icon's layout. */
  viewLayout: ViewLayout;
  /** The menu label, also the new view's name. */
  label: string;
  testId?: string;
  /** Shown disabled with this reason (the workspace plan, or its check still running). */
  disabledReason?: string;
}

/**
 * Adding a view to a database: the layouts offered (`options`, in menu
 * order), the creation with its spinner, and the open state of the menu that
 * lists them, whose opening starts the plan checks. Dashboard is offered only
 * where one can be created (never in a mobile context). Shared by the tab
 * bar's "+" menu and the phone's view list (`MobileDatabaseViewPill`).
 */
export function useAddDatabaseViewMenu({
  databasePageId,
  onBeforeAddView,
  onAfterAddView,
  onViewAdded,
}: AddViewButtonProps) {
  const { t } = useTranslation();
  const onAddView = useAddDatabaseView();
  const [addLoading, setAddLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { getSubscriptions, workspaceId } = useDatabaseContext();
  const timelineDisabledReason = useTimelineCreationDisabledReason(getSubscriptions, {
    workspaceId,
    enabled: EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED && menuOpen,
  });
  const { available: canCreateDashboard, disabledReason: dashboardDisabledReason } = useDashboardCreationGate(
    getSubscriptions,
    { workspaceId, enabled: menuOpen }
  );
  const mountedRef = useRef(true);
  const actionScopeRevisionRef = useRef(0);
  const completionCallbacksRef = useRef({ onAfterAddView, onViewAdded });

  // Callback identities change whenever the tab list changes. Keep async
  // completions pointed at the latest committed handlers without treating
  // those identity changes as operation cancellation.
  useLayoutEffect(() => {
    completionCallbacksRef.current = { onAfterAddView, onViewAdded };
  }, [onAfterAddView, onViewAdded]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      actionScopeRevisionRef.current += 1;
    },
    []
  );

  // Only a database target change invalidates an accepted click. View creation
  // itself updates the tab callbacks while the request is in flight, so using
  // callback identity as the scope would cancel the successful operation that
  // caused that render and leave this button busy forever.
  useLayoutEffect(() => {
    actionScopeRevisionRef.current += 1;
    setAddLoading(false);
    setMenuOpen(false);

    return () => {
      actionScopeRevisionRef.current += 1;
    };
  }, [databasePageId]);

  const handleAddView = async (layout: DatabaseViewLayout, name: string) => {
    if (layout === DatabaseViewLayout.Timeline && timelineDisabledReason) return;
    if (layout === DatabaseViewLayout.Dashboard && (!canCreateDashboard || dashboardDisabledReason)) return;
    const actionScopeRevision = actionScopeRevisionRef.current;
    const isCurrentActionScope = () => mountedRef.current && actionScopeRevisionRef.current === actionScopeRevision;

    onBeforeAddView?.();
    setAddLoading(true);
    const startTime = Date.now();
    const MIN_LOADING_TIME = 300; // Minimum time to show spinner for smooth UX

    try {
      const viewId = await onAddView(layout, name);

      if (isCurrentActionScope()) completionCallbacksRef.current.onViewAdded(viewId);
    } catch (e: unknown) {
      if (isCurrentActionScope()) {
        console.error('[AddViewButton] Error adding view:', e);
        toast.error(getErrorMessage(e, 'Failed to add view'));
      }
    } finally {
      if (isCurrentActionScope()) {
        completionCallbacksRef.current.onAfterAddView?.();
        // Ensure minimum loading time to prevent jarring UI flicker
        const elapsed = Date.now() - startTime;
        const remaining = MIN_LOADING_TIME - elapsed;

        if (remaining > 0) {
          setTimeout(() => {
            if (isCurrentActionScope()) setAddLoading(false);
          }, remaining);
        } else {
          setAddLoading(false);
        }
      }
    }
  };

  const options: AddViewLayoutOption[] = [
    { layout: DatabaseViewLayout.Grid, viewLayout: ViewLayout.Grid, label: t('grid.menuName') },
    { layout: DatabaseViewLayout.Board, viewLayout: ViewLayout.Board, label: t('board.menuName') },
    { layout: DatabaseViewLayout.Calendar, viewLayout: ViewLayout.Calendar, label: t('calendar.menuName') },
    ...(EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED
      ? [
          {
            layout: DatabaseViewLayout.Timeline,
            viewLayout: ViewLayout.Timeline,
            label: t('timeline.menuName', { defaultValue: 'Timeline' }),
            testId: 'add-timeline-view-button',
            disabledReason: timelineDisabledReason,
          },
        ]
      : []),
    ...(canCreateDashboard
      ? [
          {
            layout: DatabaseViewLayout.Dashboard,
            viewLayout: ViewLayout.Dashboard,
            label: t('dashboard.menuName', { defaultValue: 'Dashboard' }),
            testId: 'add-dashboard-view-button',
            disabledReason: dashboardDisabledReason,
          },
        ]
      : []),
    { layout: DatabaseViewLayout.Chart, viewLayout: ViewLayout.Chart, label: t('chart.menuName') },
    ...(EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED
      ? [
          {
            layout: DatabaseViewLayout.Form,
            viewLayout: ViewLayout.Form,
            label: t('form.builderName', { defaultValue: 'Form builder' }),
            testId: 'add-form-view-option',
          },
        ]
      : []),
    {
      layout: DatabaseViewLayout.List,
      viewLayout: ViewLayout.List,
      label: t('list.menuName'),
      testId: 'add-list-view-button',
    },
    {
      layout: DatabaseViewLayout.Gallery,
      viewLayout: ViewLayout.Gallery,
      label: t('gallery.menuName'),
      testId: 'add-gallery-view-button',
    },
    {
      layout: DatabaseViewLayout.Feed,
      viewLayout: ViewLayout.Feed,
      label: t('feed.menuName'),
      testId: 'add-feed-view-button',
    },
  ];

  return { addLoading, menuOpen, setMenuOpen, options, addView: handleAddView };
}

export function AddViewButton({ databasePageId, onBeforeAddView, onAfterAddView, onViewAdded }: AddViewButtonProps) {
  const { t } = useTranslation();
  const { addLoading, menuOpen, setMenuOpen, options, addView } = useAddDatabaseViewMenu({
    databasePageId,
    onBeforeAddView,
    onAfterAddView,
    onViewAdded,
  });

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t('grid.settings.addView', { defaultValue: 'Add view' })}
          data-testid='add-view-button'
          size={'icon'}
          variant={'ghost'}
          loading={addLoading}
          className={'mx-1.5 p-1.5 text-icon-secondary'}
          type='button'
        >
          {addLoading ? <Progress variant={'inherit'} /> : <PlusIcon aria-hidden='true' className={'h-5 w-5'} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={'bottom'} align={'start'} className={'!min-w-[120px]'}>
        {options.map((option) => {
          const item = (
            <DropdownMenuItem
              data-testid={option.testId}
              disabled={Boolean(option.disabledReason)}
              key={option.layout}
              onClick={() => {
                void addView(option.layout, option.label);
              }}
            >
              <ViewIcon layout={option.viewLayout} size={'small'} />
              {option.label}
            </DropdownMenuItem>
          );

          // A refused layout explains itself on hover.
          return option.disabledReason ? (
            <Tooltip key={option.layout}>
              <TooltipTrigger asChild>
                <div>{item}</div>
              </TooltipTrigger>
              <TooltipContent>{option.disabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            item
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
