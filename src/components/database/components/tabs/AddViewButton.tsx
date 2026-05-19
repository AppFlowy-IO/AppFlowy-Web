import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAddDatabaseView } from '@/application/database-yjs/dispatch';
import { BillingService } from '@/application/services/js-services/http/billing-api';
import { DatabaseViewLayout, Subscription, ViewLayout } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { ViewIcon } from '@/components/_shared/view-icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface AddViewButtonProps {
  onBeforeAddView?: () => void;
  onAfterAddView?: () => void;
  onViewAdded: (viewId: string) => void;
}

export function AddViewButton({ onBeforeAddView, onAfterAddView, onViewAdded }: AddViewButtonProps) {
  const { t } = useTranslation();
  const onAddView = useAddDatabaseView();
  const [addLoading, setAddLoading] = useState(false);

  // Form-view Pro gate (web mirror of the desktop's
  // `canCreateFormView`). Web has no local-only mode, so the rules
  // simplify to "Pro / Team plan, or self-hosted". `useSubscriptionPlan`
  // already returns `isPro = true` for self-hosted instances, so the
  // same hook covers both branches.
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentWorkspaceId = userWorkspaceInfo?.selectedWorkspace.id;
  const getSubscriptions = useCallback(async (): Promise<Subscription[] | undefined> => {
    if (!currentWorkspaceId) return undefined;
    return BillingService.getWorkspaceSubscriptions(currentWorkspaceId);
  }, [currentWorkspaceId]);
  const { isPro } = useSubscriptionPlan(getSubscriptions);

  // `?action=change_plan` is observed by the `UpgradePlan` widget
  // mounted in `Workspaces`, which auto-opens the compare-plan modal.
  // Same entry point the chart-layout settings use — keeps the upgrade
  // UX consistent across paid features.
  const [, setSearch] = useSearchParams();
  const openUpgradePlan = useCallback(() => {
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch]);

  const handleAddView = async (layout: DatabaseViewLayout, name: string) => {
    // Pro gate at click time: Form on Free plan opens the upgrade
    // modal instead of creating a view the user can't share. Other
    // layouts proceed without gating.
    if (layout === DatabaseViewLayout.Form && !isPro) {
      openUpgradePlan();
      return;
    }
    onBeforeAddView?.();
    setAddLoading(true);
    const startTime = Date.now();
    const MIN_LOADING_TIME = 300; // Minimum time to show spinner for smooth UX

    try {
      const viewId = await onAddView(layout, name);

      onViewAdded(viewId);
    } catch (e: unknown) {
      console.error('[AddViewButton] Error adding view:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to add view');
    } finally {
      onAfterAddView?.();
      // Ensure minimum loading time to prevent jarring UI flicker
      const elapsed = Date.now() - startTime;
      const remaining = MIN_LOADING_TIME - elapsed;

      if (remaining > 0) {
        setTimeout(() => setAddLoading(false), remaining);
      } else {
        setAddLoading(false);
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid='add-view-button'
          size={'icon'}
          variant={'ghost'}
          loading={addLoading}
          className={'mx-1.5 p-1.5 text-icon-secondary'}
        >
          {addLoading ? <Progress variant={'inherit'} /> : <PlusIcon className={'h-5 w-5'} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={'bottom'}
        align={'start'}
        className={'!min-w-[120px]'}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem
          onClick={() => {
            void handleAddView(DatabaseViewLayout.Grid, t('grid.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Grid} size={'small'} />
          {t('grid.menuName')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void handleAddView(DatabaseViewLayout.Board, t('board.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Board} size={'small'} />
          {t('board.menuName')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void handleAddView(DatabaseViewLayout.Calendar, t('calendar.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Calendar} size={'small'} />
          {t('calendar.menuName')}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            void handleAddView(DatabaseViewLayout.Chart, t('chart.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Chart} size={'small'} />
          {t('chart.menuName')}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            void handleAddView(DatabaseViewLayout.Form, t('form.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Form} size={'small'} />
          {t('form.menuName')}
        </DropdownMenuItem>

        {/* List - Desktop Only */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <DropdownMenuItem disabled>
                <ViewIcon layout={ViewLayout.List} size={'small'} />
                {t('list.menuName')}
              </DropdownMenuItem>
            </div>
          </TooltipTrigger>
          <TooltipContent>{t('common.desktopOnly')}</TooltipContent>
        </Tooltip>

        {/* Gallery - Desktop Only */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <DropdownMenuItem disabled>
                <ViewIcon layout={ViewLayout.Gallery} size={'small'} />
                {t('gallery.menuName')}
              </DropdownMenuItem>
            </div>
          </TooltipTrigger>
          <TooltipContent>{t('common.desktopOnly')}</TooltipContent>
        </Tooltip>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
