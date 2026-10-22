import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabaseContext } from '@/application/database-yjs';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import { UIVariant } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as RenameIcon } from '@/assets/icons/rename.svg';
import { ReactComponent as RepositionIcon } from '@/assets/icons/reposition.svg';
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
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/utils/copy';

// Figma floating action bar (node 7438:222570): 28px buttons with 20px white icons, white 16% on hover.
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

/**
 * Hover toolbar from the Figma gallery card: Reposition, Rename and More.
 * Opening the row stays on the card itself, so read-only cards show no toolbar.
 */
export function GalleryCardToolbar({
  onEdit,
  onReposition,
  onCancelReposition,
  onSaveReposition,
  repositioning = false,
  readOnly = false,
  rowId,
}: {
  onEdit: () => void;
  onReposition?: () => void;
  onCancelReposition?: () => void;
  onSaveReposition?: () => void;
  repositioning?: boolean;
  readOnly?: boolean;
  rowId: string;
}) {
  const { t } = useTranslation();
  const duplicateRow = useDuplicateRowDispatch();
  const { activeViewId, databasePageId, variant, workspaceId } = useDatabaseContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const rowIds = useMemo(() => [rowId], [rowId]);
  // The same row page URL the row modal opens in a new tab.
  const rowLink = useMemo(() => {
    if (!workspaceId || !databasePageId || variant === UIVariant.Publish) return undefined;
    const url = new URL(`/app/${workspaceId}/${databasePageId}`, window.location.origin);

    url.searchParams.set('v', activeViewId || '');
    url.searchParams.set('r', rowId);
    return url.toString();
  }, [activeViewId, databasePageId, rowId, variant, workspaceId]);
  const copyRowLink = () => {
    if (!rowLink) return;
    void copyTextToClipboard(rowLink).then(() => toast.success(t('shareAction.copyLinkSuccess')));
  };

  if (readOnly) return null;

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
              className='h-7 min-w-[64px] px-1.5 text-sm font-medium text-white hover:bg-white/[0.16] hover:text-white'
              data-testid='gallery-cover-cancel'
              onClick={onCancelReposition}
              variant='ghost'
            >
              {t('button.cancel')}
            </Button>
            <span aria-hidden className='mx-1 h-4 w-px bg-white/20' />
            <Button
              className='h-7 min-w-[64px] rounded-100 px-2 text-sm font-medium'
              data-testid='gallery-cover-save'
              onClick={onSaveReposition}
            >
              {t('button.save')}
            </Button>
          </>
        ) : (
          <>
            {onReposition ? (
              <GalleryAction
                label={t('gallery.reposition')}
                testId={`gallery-card-reposition-${rowId}`}
                onClick={onReposition}
                preserveFocus
              >
                <RepositionIcon aria-hidden />
              </GalleryAction>
            ) : null}
            <GalleryAction label={t('button.rename')} testId={`gallery-card-edit-${rowId}`} onClick={onEdit}>
              <RenameIcon aria-hidden />
            </GalleryAction>

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
                      <MoreIcon aria-hidden='true' />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('button.more')}</TooltipContent>
              </Tooltip>
              {/* Figma card menu (node 7438:223081): Copy link, Duplicate, Delete at 240px. */}
              <DropdownMenuContent
                align='end'
                className='w-[240px] !min-w-[240px]'
                data-testid='gallery-row-action-menu'
                side='bottom'
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  {rowLink ? (
                    <DropdownMenuItem data-testid='gallery-row-copy-link' onSelect={copyRowLink}>
                      <LinkIcon aria-hidden='true' />
                      {t('shareAction.copyLink')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem data-testid='gallery-row-duplicate' onSelect={() => void duplicateRow(rowId)}>
                    <DuplicateIcon aria-hidden='true' />
                    {t('button.duplicate')}
                  </DropdownMenuItem>
                  {/* Primary at rest like the Figma menu; the error color marks it only while highlighted. */}
                  <DropdownMenuItem
                    className='hover:text-text-error focus:text-text-error hover:[&_svg]:text-text-error focus:[&_svg]:text-text-error'
                    data-testid='gallery-row-delete'
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <DeleteIcon aria-hidden='true' />
                    {t('button.delete')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {deleteOpen ? <DeleteRowConfirm onClose={() => setDeleteOpen(false)} open rowIds={rowIds} /> : null}
    </>
  );
}

export default GalleryCardToolbar;
