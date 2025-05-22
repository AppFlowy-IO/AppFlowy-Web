import { useDatabaseViewId } from '@/application/database-yjs';
import { useUpdateDatabaseLayout } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import React, { useMemo } from 'react';
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem, DropdownMenuItemTick,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import { ReactComponent as LayoutIcon } from '@/assets/icons/layout.svg';

function Layout ({
  currentLayout,
}: {
  currentLayout: DatabaseViewLayout;
}) {
  const { t } = useTranslation();

  const viewId = useDatabaseViewId();
  const updateLayout = useUpdateDatabaseLayout(viewId);
  const options = useMemo(() => [{
    value: DatabaseViewLayout.Grid,
    label: t('grid.menuName'),
  }, {
    value: DatabaseViewLayout.Board,
    label: t('board.menuName'),
  }], [t]);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <LayoutIcon />
        {t('grid.settings.layout')}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className={'max-w-[240px] appflowy-scroller overflow-y-auto'}
        >
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              className={'w-full'}
              onSelect={() => {
                updateLayout(option.value);
              }}
            >
              <div className={'flex items-center gap-2'}>
                {option.label}
              </div>
              {currentLayout === option.value && <DropdownMenuItemTick />}

            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Layout;