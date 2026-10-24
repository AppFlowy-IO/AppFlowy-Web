import { useTranslation } from 'react-i18next';

import type { Row } from '@/application/database-yjs';
import { useDeleteGroupColumnDispatch } from '@/application/database-yjs/dispatch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Figma "Delete group" dialog (node 7435:211323). Deleting removes every page
 * in the group and, for select fields, the option itself: the same contract as
 * the Board column delete and desktop `delete_group`.
 */
export function GalleryDeleteGroupConfirm({
  fieldId,
  groupConfigId,
  groupId,
  onClose,
  rows,
}: {
  fieldId: string;
  groupConfigId: string;
  groupId: string;
  onClose: () => void;
  rows: Row[];
}) {
  const { t } = useTranslation();
  const deleteGroup = useDeleteGroupColumnDispatch(groupConfigId, groupId, fieldId);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid='gallery-delete-group-dialog' size='sm'>
        <DialogHeader>
          <DialogTitle>{t('gallery.deleteGroup')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{t('gallery.deleteGroupDescription')}</DialogDescription>
        <DialogFooter>
          <Button onClick={onClose} variant='outline'>
            {t('button.cancel')}
          </Button>
          <Button
            data-testid='gallery-delete-group-confirm'
            onClick={() => {
              deleteGroup(rows.map((row) => row.id));
              onClose();
            }}
            variant='destructive'
          >
            {t('button.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GalleryDeleteGroupConfirm;
