import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RowMetaKey } from '@/application/database-yjs';
import { FileMediaCellDataItem, FileMediaType } from '@/application/database-yjs/cell.type';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { RowCoverType } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as RenameIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as PreviewIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as CoverIcon } from '@/assets/icons/image.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/open.svg';
import { ReactComponent as DownloadIcon } from '@/assets/icons/save_as.svg';
import DeleteFileConfirm from '@/components/database/components/cell/file-media/DeleteFileConfirm';
import RenameFile from '@/components/database/components/cell/file-media/RenameFile';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { downloadFile, openFileUrl } from '@/utils/download';

function FileMediaMore({
  file,
  onPreview,
  rowId,
  onUpdateName,
  onDelete,
}: {
  file: FileMediaCellDataItem;
  onPreview: () => void;
  rowId: string;
  onUpdateName: (name: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  const updateRowMeta = useUpdateRowMetaDispatch(rowId);

  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const [openMenu, setOpenMenu] = useState(false);
  const actions = useMemo(
    () =>
      [
        file.file_type === FileMediaType.Image && {
          key: 'expand',
          label: t('grid.media.expand'),
          icon: <PreviewIcon />,
          onSelect: () => {
            onPreview();
          },
        },
        file.file_type === FileMediaType.Image && {
          key: 'setCover',
          label: t('grid.media.setAsCover'),
          icon: <CoverIcon />,
          onSelect: () => {
            updateRowMeta(
              RowMetaKey.CoverId,
              JSON.stringify({
                cover_type: RowCoverType.FileCover,
                data: file.url,
              })
            );
          },
        },
        file.file_type !== FileMediaType.Image && {
          key: 'openInBrowser',
          label: t('grid.media.openInBrowser'),
          icon: <OpenIcon />,
          onSelect: () => {
            void openFileUrl(file.url, '_blank', file.name);
          },
        },
        {
          key: 'rename',
          label: t('button.rename'),
          icon: <RenameIcon />,
          onSelect: () => {
            setRenameModalOpen(true);
          },
        },
        file.file_type !== FileMediaType.Link && {
          key: 'download',
          label: t('button.download'),
          icon: <DownloadIcon />,
          onSelect: () => {
            void downloadFile(file.url, file.name);
          },
        },
        {
          key: 'delete',
          label: t('button.delete'),
          icon: <DeleteIcon />,
          onSelect: () => {
            setDeleteConfirm(true);
          },
        },
      ].filter(Boolean) as {
        key: string;
        label: string;
        icon: React.ReactNode;
        onSelect: () => void;
      }[],
    [file, onPreview, t, updateRowMeta]
  );

  return (
    <>
      <Popover modal open={openMenu} onOpenChange={setOpenMenu}>
        <PopoverTrigger asChild>
          <Button variant={'ghost'} size={'icon-sm'} className={'bg-surface-primary hover:bg-surface-primary-hover'}>
            <MoreIcon className={'h-5 w-5 text-icon-secondary'} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={'p-2'}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {actions.map((action) => (
            <div
              className={cn(dropdownMenuItemVariants({ variant: action.key === 'delete' ? 'destructive' : 'default' }))}
              key={action.key}
              onClick={(e) => {
                e.stopPropagation();
                action.onSelect();
                setOpenMenu(false);
              }}
            >
              {action.icon}
              {action.label}
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {renameModalOpen && (
        <RenameFile file={file} onOk={onUpdateName} open={renameModalOpen} onOpenChange={setRenameModalOpen} />
      )}

      {deleteConfirm && (
        <DeleteFileConfirm file={file} open={deleteConfirm} onOpenChange={setDeleteConfirm} onDelete={onDelete} />
      )}
    </>
  );
}

export default FileMediaMore;
