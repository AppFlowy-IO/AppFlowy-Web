import { type ReactNode, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabaseViewId } from '@/application/database-yjs';
import { useDatabaseContext } from '@/application/database-yjs/context';
import { useUpdateDatabaseLayout } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { ReactComponent as LayoutIcon } from '@/assets/icons/layout.svg';
import { DatabaseViewCreationHint } from '@/components/_shared/DatabaseViewCreationItem';
import { ViewIcon } from '@/components/_shared/view-icon/ViewIcon';
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

function Layout({ currentLayout, children }: { currentLayout: DatabaseViewLayout; children?: ReactNode }) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { workspaceId, getSubscriptions } = useDatabaseContext();
  const isSelfHosted = useServerHostingMode() === 'self-hosted';
  const { getAction } = useDatabaseViewCreation({
    workspaceId,
    getSubscriptions,
    enabled: open,
  });
  const timelineAction = getAction(ViewLayout.Timeline);
  const viewId = useDatabaseViewId();
  const updateLayout = useUpdateDatabaseLayout(viewId);
  const options = useMemo(
    () => [
      {
        value: DatabaseViewLayout.Grid,
        icon: ViewLayout.Grid,
        label: t('grid.menuName'),
      },
      {
        value: DatabaseViewLayout.Board,
        icon: ViewLayout.Board,
        label: t('board.menuName'),
      },
      {
        value: DatabaseViewLayout.Calendar,
        icon: ViewLayout.Calendar,
        label: t('calendar.menuName'),
      },
      {
        value: DatabaseViewLayout.Timeline,
        icon: ViewLayout.Timeline,
        label: t('timeline.menuName', { defaultValue: 'Timeline' }),
      },
      ...(isSelfHosted || currentLayout === DatabaseViewLayout.Chart
        ? [
            {
              value: DatabaseViewLayout.Chart,
              icon: ViewLayout.Chart,
              label: t('chart.menuName'),
            },
          ]
        : []),
      ...(isSelfHosted || currentLayout === DatabaseViewLayout.Form
        ? [
            {
              value: DatabaseViewLayout.Form,
              icon: ViewLayout.Form,
              label: t('form.menuName'),
            },
          ]
        : []),
      {
        value: DatabaseViewLayout.List,
        icon: ViewLayout.List,
        label: t('list.menuName'),
      },
      {
        value: DatabaseViewLayout.Gallery,
        icon: ViewLayout.Gallery,
        label: t('gallery.menuName'),
      },
      {
        value: DatabaseViewLayout.Feed,
        icon: ViewLayout.Feed,
        label: t('feed.menuName'),
      },
    ],
    [t, currentLayout, isSelfHosted]
  );

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        aria-label={t('grid.settings.layout')}
        data-testid='database-layout-settings-trigger'
        onPointerLeave={(event) => {
          // Keep focus in the portaled submenu when it opens to the left.
          if (event.relatedTarget instanceof Node && contentRef.current?.contains(event.relatedTarget)) {
            event.preventDefault();
          }
        }}
      >
        <LayoutIcon aria-hidden='true' />
        <span>{t('grid.settings.layout')}</span>
        <span className='ml-auto text-xs text-text-tertiary'>
          {options.find((option) => option.value === currentLayout)?.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent ref={contentRef} className={'appflowy-scroller w-[240px] overflow-y-auto'}>
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
                  {currentLayout === DatabaseViewLayout.Gallery ? <ViewIcon layout={option.icon} size='small' /> : null}
                  <span>{option.label}</span>
                  {currentLayout === option.value && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              </DatabaseViewCreationHint>
            );
          })}
          {children}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Layout;
