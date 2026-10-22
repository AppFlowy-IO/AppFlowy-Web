import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as CenterPeekIcon } from '@/assets/icons/center_peek.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as RepositionIcon } from '@/assets/icons/reposition.svg';
import { ReactComponent as SidePeekIcon } from '@/assets/icons/side_peek.svg';
import { DeleteRowConfirm } from '@/components/database/components/database-row/DeleteRowConfirm';
import { useRowPeekCanShow } from '@/components/database/row-peek/RowPeekLayout';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Desktop BlockMenuButton: 20px onFill icon, 4px padding, white at 16% on hover.
const actionClassName =
  'h-7 w-7 rounded p-1 text-white hover:bg-white/[0.16] hover:text-white focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white [&_svg]:h-5 [&_svg]:w-5';

function GalleryAction({
  label,
  testId,
  onClick,
  preserveFocus = false,
  children,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  preserveFocus?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={actionClassName}
          data-testid={testId}
          onClick={onClick}
          onMouseDown={preserveFocus ? (event) => event.preventDefault() : undefined}
          type='button'
          variant='ghost'
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function GalleryCardToolbar({
  onEdit,
  onPeek,
  onReposition,
  onCancelReposition,
  onSaveReposition,
  repositioning = false,
  readOnly = false,
  rowId,
}: {
  onEdit: () => void;
  onPeek?: () => void;
  onReposition?: () => void;
  onCancelReposition?: () => void;
  onSaveReposition?: () => void;
  repositioning?: boolean;
  readOnly?: boolean;
  rowId: string;
}) {
  const { t } = useTranslation();
  const duplicateRow = useDuplicateRowDispatch();
  const canShowSidePeek = useRowPeekCanShow();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const rowIds = useMemo(() => [rowId], [rowId]);

  if (readOnly && !onPeek) return null;

  return (
    <>
      <div
        className={cn(
          'pointer-events-none absolute right-[7px] top-[7px] z-30 flex items-center rounded-md bg-black/60 p-1 opacity-0 shadow-toolbar backdrop-blur-sm transition-opacity duration-200 group-focus-within/gallery-card:pointer-events-auto group-focus-within/gallery-card:opacity-100 group-hover/gallery-card:pointer-events-auto group-hover/gallery-card:opacity-100 motion-reduce:transition-none',
          (menuOpen || repositioning) && 'pointer-events-auto opacity-100'
        )}
        data-gallery-interactive='true'
        data-testid={`gallery-card-toolbar-${rowId}`}
        onClick={(event) => event.stopPropagation()}
      >
        {repositioning ? (
          <>
            <Button
              className='h-7 px-1.5 text-sm text-white hover:bg-white/[0.16] hover:text-white'
              data-testid='gallery-cover-cancel'
              onClick={onCancelReposition}
              variant='ghost'
            >
              {t('button.cancel')}
            </Button>
            <span aria-hidden className='mx-1 h-4 w-px bg-white/20' />
            <Button className='h-7 px-1.5 text-sm' data-testid='gallery-cover-save' onClick={onSaveReposition}>
              {t('button.save')}
            </Button>
          </>
        ) : (
          <>
            {onPeek ? (
              <GalleryAction
                label={t(canShowSidePeek ? 'grid.rowPage.openAsSidePeekPanel' : 'grid.rowPage.openAsCenterPeekPanel')}
                testId={`gallery-card-peek-${rowId}`}
                onClick={onPeek}
              >
                {canShowSidePeek ? <SidePeekIcon aria-hidden /> : <CenterPeekIcon aria-hidden />}
              </GalleryAction>
            ) : null}
            {!readOnly && onReposition ? (
              <GalleryAction
                label={t('document.plugins.cover.repositionCover')}
                testId={`gallery-card-reposition-${rowId}`}
                onClick={onReposition}
                preserveFocus
              >
                <RepositionIcon aria-hidden />
              </GalleryAction>
            ) : null}
            {!readOnly ? (
              <GalleryAction label={t('button.edit')} testId={`gallery-card-edit-${rowId}`} onClick={onEdit}>
                <EditIcon aria-hidden />
              </GalleryAction>
            ) : null}

            {!readOnly ? (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={t('button.more')}
                        className={actionClassName}
                        data-testid={`gallery-card-more-${rowId}`}
                        onClick={(event) => event.stopPropagation()}
                        type='button'
                        variant='ghost'
                      >
                        <MoreIcon aria-hidden='true' className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t('button.more')}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                  align='end'
                  className='w-[200px] !min-w-[200px]'
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
            ) : null}
          </>
        )}
      </div>

      {deleteOpen ? <DeleteRowConfirm onClose={() => setDeleteOpen(false)} open rowIds={rowIds} /> : null}
    </>
  );
}

export default GalleryCardToolbar;
