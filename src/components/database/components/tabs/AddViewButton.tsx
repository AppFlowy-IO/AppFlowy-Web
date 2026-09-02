import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useAddDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ViewIcon } from '@/components/_shared/view-icon';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

interface AddViewButtonProps {
  databasePageId: string;
  onBeforeAddView?: () => void;
  onAfterAddView?: () => void;
  onViewAdded: (viewId: string) => void;
}

export function AddViewButton({ databasePageId, onBeforeAddView, onAfterAddView, onViewAdded }: AddViewButtonProps) {
  const { t } = useTranslation();
  const onAddView = useAddDatabaseView();
  const [addLoading, setAddLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
        toast.error(e instanceof Error ? e.message : 'Failed to add view');
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
          data-testid='add-form-view-option'
          onClick={() => {
            void handleAddView(DatabaseViewLayout.Form, t('form.builderName', { defaultValue: 'Form builder' }));
          }}
        >
          <ViewIcon layout={ViewLayout.Form} size={'small'} />
          {t('form.builderName', { defaultValue: 'Form builder' })}
        </DropdownMenuItem>

        <DropdownMenuItem
          data-testid='add-list-view-button'
          onClick={() => {
            void handleAddView(DatabaseViewLayout.List, t('list.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.List} size={'small'} />
          {t('list.menuName')}
        </DropdownMenuItem>

        <DropdownMenuItem
          data-testid='add-gallery-view-button'
          onClick={() => {
            void handleAddView(DatabaseViewLayout.Gallery, t('gallery.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Gallery} size={'small'} />
          {t('gallery.menuName')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
