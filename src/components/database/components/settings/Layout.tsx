import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoardLayoutSettings, useDatabaseViewId } from '@/application/database-yjs';
import { useToggleShowColorColumns, useUpdateDatabaseLayout } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as LayoutIcon } from '@/assets/icons/layout.svg';
import { ReactComponent as PaletteIcon } from '@/assets/icons/palette.svg';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

function Layout({ currentLayout }: { currentLayout: DatabaseViewLayout }) {
  const { t } = useTranslation();

  const viewId = useDatabaseViewId();
  const updateLayout = useUpdateDatabaseLayout(viewId);
  const toggleColorColumns = useToggleShowColorColumns();
  const { showColorColumns } = useBoardLayoutSettings();
  const isBoardLayout = currentLayout === DatabaseViewLayout.Board;
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
      {
        value: DatabaseViewLayout.Chart,
        label: t('chart.menuName'),
      },
    ],
    [t]
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <LayoutIcon />
        {t('grid.settings.layout')}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={'appflowy-scroller max-w-[240px] overflow-y-auto'}>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              className={'w-full'}
              onSelect={() => {
                updateLayout(option.value);
              }}
            >
              <div className={'flex items-center gap-2'}>{option.label}</div>
              {currentLayout === option.value && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
          {isBoardLayout && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={'w-full'}
                onSelect={(e) => {
                  e.preventDefault();
                  toggleColorColumns(!showColorColumns);
                }}
              >
                <PaletteIcon />
                {t('board.column.colorColumns')}
                <Switch className={'ml-auto'} checked={showColorColumns} />
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Layout;
