import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED } from '@/application/constants';
import { useDatabaseViewId } from '@/application/database-yjs';
import { useDatabaseContext } from '@/application/database-yjs/context';
import { useUpdateDatabaseLayout } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { ReactComponent as LayoutIcon } from '@/assets/icons/layout.svg';
import { DatabaseViewCreationHint } from '@/components/_shared/DatabaseViewCreationItem';
import { useDatabaseViewCreation } from '@/components/app/hooks/useDatabaseViewCreation';
import { useServerHostingMode } from '@/components/app/hooks/useServerInfo';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { getErrorMessage } from '@/utils/errors';

function Layout({ currentLayout }: { currentLayout: DatabaseViewLayout }) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const { workspaceId, getSubscriptions } = useDatabaseContext();
  const isSelfHosted = useServerHostingMode() === 'self-hosted';
  const { getAction } = useDatabaseViewCreation({
    workspaceId,
    getSubscriptions,
    enabled: open && EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED,
  });
  const timelineAction = getAction(ViewLayout.Timeline);
  const viewId = useDatabaseViewId();
  const updateLayout = useUpdateDatabaseLayout(viewId);
  const options = useMemo(
    () => [
      {
        value: DatabaseViewLayout.Grid,
        label: t('grid.menuName'),
      },
      {
        value: DatabaseViewLayout.Board,
        label: t('board.menuName'),
      },
      {
        value: DatabaseViewLayout.Calendar,
        label: t('calendar.menuName'),
      },
      ...(EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED || currentLayout === DatabaseViewLayout.Timeline
        ? [
            {
              value: DatabaseViewLayout.Timeline,
              label: t('timeline.menuName', { defaultValue: 'Timeline' }),
            },
          ]
        : []),
      ...(isSelfHosted || currentLayout === DatabaseViewLayout.Chart
        ? [
            {
              value: DatabaseViewLayout.Chart,
              label: t('chart.menuName'),
            },
          ]
        : []),
      ...((isSelfHosted && EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED) || currentLayout === DatabaseViewLayout.Form
        ? [
            {
              value: DatabaseViewLayout.Form,
              label: t('form.menuName'),
            },
          ]
        : []),
      {
        value: DatabaseViewLayout.List,
        label: t('list.menuName'),
      },
      {
        value: DatabaseViewLayout.Gallery,
        label: t('gallery.menuName'),
      },
      {
        value: DatabaseViewLayout.Feed,
        label: t('feed.menuName'),
      },
    ],
    [t, currentLayout, isSelfHosted]
  );

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger aria-label={t('grid.settings.layout')} data-testid='database-layout-settings-trigger'>
        <LayoutIcon aria-hidden='true' />
        <span>{t('grid.settings.layout')}</span>
        <span className='ml-auto text-xs text-text-tertiary'>
          {options.find((option) => option.value === currentLayout)?.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={'appflowy-scroller max-w-[240px] overflow-y-auto'}>
          {options.map((option) => {
            const disabled =
              option.value === DatabaseViewLayout.Timeline &&
              option.value !== currentLayout &&
              timelineAction.type !== 'create';

            return (
              <DatabaseViewCreationHint
                key={option.value}
                enabled={option.value === DatabaseViewLayout.Timeline}
                reason={disabled ? timelineAction.reason : undefined}
              >
                <DropdownMenuItem
                  disabled={disabled}
                  className={'w-full'}
                  data-testid={`database-layout-option-${option.value}`}
                  onSelect={() => {
                    if (
                      option.value === currentLayout ||
                      (option.value === DatabaseViewLayout.Timeline && getAction(ViewLayout.Timeline).type !== 'create')
                    )
                      return;
                    void (async () => {
                      try {
                        await updateLayout(option.value);
                      } catch (error) {
                        toast.error(getErrorMessage(error, 'Failed to change view layout'));
                      }
                    })();
                  }}
                >
                  <div className={'flex items-center gap-2'}>{option.label}</div>
                  {currentLayout === option.value && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              </DatabaseViewCreationHint>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Layout;
