import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useAddDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ViewIcon } from '@/components/_shared/view-icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

interface AddViewButtonProps {
  onViewAdded: (viewId: string) => void;
}

export function AddViewButton({ onViewAdded }: AddViewButtonProps) {
  const { t } = useTranslation();
  const onAddView = useAddDatabaseView();
  const [addLoading, setAddLoading] = useState(false);

  const handleAddView = async (layout: DatabaseViewLayout, name: string) => {
    setAddLoading(true);
    try {
      const viewId = await onAddView(layout, name);

      onViewAdded(viewId);
    } catch (e: unknown) {
      console.error('[AddViewButton] Error adding view:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to add view');
    } finally {
      setAddLoading(false);
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
          onSelect={() => {
            void handleAddView(DatabaseViewLayout.Grid, t('grid.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Grid} size={'small'} />
          {t('grid.menuName')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void handleAddView(DatabaseViewLayout.Board, t('board.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Board} size={'small'} />
          {t('board.menuName')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void handleAddView(DatabaseViewLayout.Calendar, t('calendar.menuName'));
          }}
        >
          <ViewIcon layout={ViewLayout.Calendar} size={'small'} />
          {t('calendar.menuName')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
