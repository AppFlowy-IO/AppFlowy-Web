import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { DeleteRowConfirm } from '@/components/database/components/database-row/DeleteRowConfirm';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function GalleryCardToolbar({ onEdit, rowId }: { onEdit: () => void; rowId: string }) {
  const { t } = useTranslation();
  const duplicateRow = useDuplicateRowDispatch();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const rowIds = useMemo(() => [rowId], [rowId]);

  return (
    <>
      <div
        className='pointer-events-none absolute right-[7px] top-[7px] z-20 flex items-center overflow-hidden rounded-[4px] border border-[rgba(31,35,41,0.12)] bg-white opacity-0 shadow-[0_0_4px_rgba(31,35,41,0.02),0_0_4px_-2px_rgba(31,35,41,0.02)] transition-opacity duration-200 group-focus-within/gallery-card:pointer-events-auto group-focus-within/gallery-card:opacity-100 group-hover/gallery-card:pointer-events-auto group-hover/gallery-card:opacity-100 motion-reduce:transition-none [[data-dark-mode=true]_&]:border-[#59647A] [[data-dark-mode=true]_&]:bg-[#1A202C]'
        data-gallery-interactive='true'
        data-testid={`gallery-card-toolbar-${rowId}`}
        onClick={(event) => event.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('button.edit')}
              className='h-[22px] w-6 rounded-none p-[3px] text-[#828282] hover:bg-white focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fill-theme-thick [[data-dark-mode=true]_&]:text-[#59647A] [[data-dark-mode=true]_&]:hover:bg-[#1A202C]'
              data-testid={`gallery-card-edit-${rowId}`}
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
              type='button'
              variant='ghost'
            >
              <EditIcon aria-hidden='true' className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('button.edit')}</TooltipContent>
        </Tooltip>

        <span
          aria-hidden='true'
          className='h-[22px] w-px shrink-0 bg-[rgba(31,35,41,0.12)] [[data-dark-mode=true]_&]:bg-[#59647A]'
          data-testid='gallery-card-toolbar-divider'
        />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t('tooltip.openMenu')}
                  className='h-[22px] w-6 rounded-none p-[3px] text-[#828282] hover:bg-white focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fill-theme-thick [[data-dark-mode=true]_&]:text-[#59647A] [[data-dark-mode=true]_&]:hover:bg-[#1A202C]'
                  data-testid={`gallery-card-more-${rowId}`}
                  onClick={(event) => event.stopPropagation()}
                  type='button'
                  variant='ghost'
                >
                  <MoreIcon aria-hidden='true' className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('tooltip.openMenu')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align='end'
            className='w-[180px] !min-w-[180px]'
            data-testid='gallery-row-action-menu'
            side='bottom'
            sideOffset={8}
          >
            <DropdownMenuGroup>
              <DropdownMenuItem data-testid='gallery-row-duplicate' onSelect={() => void duplicateRow(rowId)}>
                <DuplicateIcon aria-hidden='true' />
                {t('button.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid='gallery-row-delete'
                onSelect={() => setDeleteOpen(true)}
                variant='destructive'
              >
                <DeleteIcon aria-hidden='true' />
                {t('button.delete')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {deleteOpen ? <DeleteRowConfirm onClose={() => setDeleteOpen(false)} open rowIds={rowIds} /> : null}
    </>
  );
}

export default GalleryCardToolbar;
