import { useTranslation } from 'react-i18next';

import { FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DeleteFileConfirm ({ open, onOpenChange, onDelete, file }: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onDelete: () => void;
  file: FileMediaCellDataItem;
}) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        onCloseAutoFocus={e => {
          e.preventDefault();
        }}
        onOpenAutoFocus={e => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('grid.media.delete')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t('grid.media.deleteFileDescription', { name: file.name })}

        </DialogDescription>
        <DialogFooter>
          <Button
            variant={'outline'}
            onClick={() => {
              onOpenChange?.(false);
            }}
          >
            {t('button.cancel')}
          </Button>
          <Button
            variant={'destructive'}
            onClick={() => {
              onDelete();
              onOpenChange?.(false);
            }}
          >{t('button.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteFileConfirm;