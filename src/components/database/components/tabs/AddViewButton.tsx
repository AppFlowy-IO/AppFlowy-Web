import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED } from '@/application/constants';
import { useDatabaseContext } from '@/application/database-yjs/context';
import { assertDatabaseViewCapacity } from '@/application/database-yjs/database-view-capacity';
import { DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT } from '@/application/database-yjs/database-view-doc-ops';
import { useAddDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { DatabaseViewCreationItem } from '@/components/_shared/DatabaseViewCreationItem';
import { ViewIcon } from '@/components/_shared/view-icon';
import { useDashboardCreationGate } from '@/components/app/hooks/useDashboardCreationGate';
import { DatabaseViewCreationAction, useDatabaseViewCreation } from '@/components/app/hooks/useDatabaseViewCreation';
import { useDatabaseViewCapacity } from '@/components/database/hooks/useDatabaseViewCapacity';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
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
  const { getSubscriptions, workspaceId, databaseDoc } = useDatabaseContext();
  const { disabledReason: capacityDisabledReason } = useDatabaseViewCapacity(databaseDoc);
  const { getAction, checkCreation, startCheckout } = useDatabaseViewCreation({
    getSubscriptions,
    workspaceId,
    enabled: menuOpen,
  });
  const { available: canCreateDashboard, disabledReason: dashboardDisabledReason } = useDashboardCreationGate(
    getSubscriptions,
    { workspaceId, enabled: menuOpen }
  );
  // Keep an upgrade's item busy while checkout opens, on desktop and mobile.
  const [checkoutLayout, setCheckoutLayout] = useState<ViewLayout | null>(null);
  const getLayoutAction = (layout: ViewLayout): DatabaseViewCreationAction =>
    capacityDisabledReason
      ? { type: 'disabled', reason: capacityDisabledReason }
      : layout === ViewLayout.Dashboard
      ? !canCreateDashboard || dashboardDisabledReason
        ? { type: 'disabled', reason: dashboardDisabledReason }
        : { type: 'create' }
      : getAction(layout);
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
    setCheckoutLayout(null);
    setMenuOpen(false);

    return () => {
      actionScopeRevisionRef.current += 1;
    };
  }, [databasePageId]);

  const handleAddView = async (layout: DatabaseViewLayout, name: string) => {
    try {
      assertDatabaseViewCapacity(databaseDoc);
    } catch (error) {
      toast.error(getErrorMessage(error));
      return;
    }

    if (layout === DatabaseViewLayout.Dashboard && (!canCreateDashboard || dashboardDisabledReason)) return;
    if (!checkCreation(DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT[layout], () => setMenuOpen(false))) return;
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

  const handleUpgrade = (viewLayout: ViewLayout) => {
    const checkout = startCheckout(viewLayout);

    if (!checkout) return;
    const actionScopeRevision = actionScopeRevisionRef.current;

    setCheckoutLayout(viewLayout);
    void checkout.finally(() => {
      if (!mountedRef.current || actionScopeRevisionRef.current !== actionScopeRevision) return;
      setCheckoutLayout(null);
      setMenuOpen(false);
    });
    return checkout;
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

  return {
    addLoading,
    menuOpen,
    setMenuOpen,
    options,
    addView: handleAddView,
    getAction: getLayoutAction,
    checkoutLayout,
    upgradeView: handleUpgrade,
  };
}

export function AddViewButton({ databasePageId, onBeforeAddView, onAfterAddView, onViewAdded }: AddViewButtonProps) {
  const { t } = useTranslation();
  const { addLoading, menuOpen, setMenuOpen, options, addView, getAction, checkoutLayout, upgradeView } = useAddDatabaseViewMenu({
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
        {options.map(({ layout, viewLayout, label, testId }) => (
          <DatabaseViewCreationItem
            key={layout}
            layout={viewLayout}
            action={getAction(viewLayout)}
            loading={checkoutLayout === viewLayout}
            disabled={checkoutLayout !== null}
            data-testid={testId}
            onSelect={(event) => {
              if (getAction(viewLayout).type === 'upgrade') {
                event.preventDefault();
                void upgradeView(viewLayout);
                return;
              }

              void addView(layout, label);
            }}
          >
            <ViewIcon layout={viewLayout} size='small' />
            {label}
          </DatabaseViewCreationItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
