import React from 'react';
import { useTranslation } from 'react-i18next';

import { useBoardLayoutSettings, useReadOnly } from '@/application/database-yjs';
import { useToggleBoardColorColumns } from '@/application/database-yjs/dispatch/board';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as PaletteIcon } from '@/assets/icons/palette.svg';
import BoardSettingGroup from '@/components/database/components/settings/BoardSettingGroup';
import Layout from '@/components/database/components/settings/Layout';
import Properties from '@/components/database/components/settings/Properties';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

/**
 * "Color columns" (WP09 §1.5): tints each select column with its option
 * colour. Writers only; it writes `show_color_columns` and nothing else.
 */
export function BoardColorColumnsItem() {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const { showColorColumns } = useBoardLayoutSettings();
  const toggleColorColumns = useToggleBoardColorColumns();

  if (readOnly) return null;

  // A toggle row: a checkbox menu item (the switch only mirrors its state).
  return (
    <DropdownMenuItem
      aria-checked={showColorColumns}
      className='w-full'
      data-checked={showColorColumns ? 'true' : 'false'}
      data-testid='board-color-columns-toggle'
      onSelect={(event) => {
        event.preventDefault();
        toggleColorColumns(!showColorColumns);
      }}
      role='menuitemcheckbox'
    >
      <PaletteIcon aria-hidden='true' className='h-5 w-5' />
      <span>{t('board.column.colorColumns')}</span>
      <Switch
        aria-hidden='true'
        checked={showColorColumns}
        className='pointer-events-none ml-auto'
        tabIndex={-1}
      />
    </DropdownMenuItem>
  );
}

/** The Board settings rows; also rendered by a dashboard widget's settings host. */
export function BoardSettingsItems() {
  return (
    <>
      <Properties />
      <Layout currentLayout={DatabaseViewLayout.Board} />
      <BoardColorColumnsItem />
      <BoardSettingGroup />
    </>
  );
}

function BoardSettings({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className={'h-7 w-7'}>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onCloseAutoFocus={(e) => e.preventDefault()}
        side={'bottom'}
        align={'end'}
        className={'!min-w-[120px]'}
      >
        <DropdownMenuGroup>
          <BoardSettingsItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default BoardSettings;
