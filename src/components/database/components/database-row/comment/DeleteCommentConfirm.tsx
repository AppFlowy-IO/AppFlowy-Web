import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export function DeleteCommentConfirm({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  const handleDelete = () => {
    onConfirm();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(status) => {
        if (!status) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
            handleDelete();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('rowComment.deleteComment')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{t('rowComment.confirmDelete')}</DialogDescription>
        <DialogFooter>
          <Button data-testid={'delete-comment-cancel'} variant={'outline'} onClick={onClose}>
            {t('button.cancel')}
          </Button>
          <Button data-testid={'delete-comment-confirm'} variant={'destructive'} onClick={handleDelete}>
            {t('button.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteCommentConfirm;
