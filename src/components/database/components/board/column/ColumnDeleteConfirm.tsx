import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, Row, useFieldType } from '@/application/database-yjs';
import { useDeleteGroupColumnDispatch } from '@/application/database-yjs/dispatch/group';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function ColumnDeleteConfirm ({
  open,
  onOpenChange,
  id,
  fieldId,
  getCards,
  groupId,
}: {
  groupId: string;
  id: string,
  fieldId: string;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  getCards: (id: string) => Row[];
}) {
  const { t } = useTranslation();

  const fieldType = useFieldType(fieldId);
  const handleDelete = useDeleteGroupColumnDispatch(groupId, id, fieldId);

  const isSelectField = useMemo(() => {
    return [
      FieldType.SingleSelect,
      FieldType.MultiSelect,
    ].includes(fieldType);
  }, [fieldType]);

  const description = useMemo(() => {
    if (isSelectField) return t('board.column.deleteOptionAndCards');
    return t('board.column.deleteCards');
  }, [isSelectField, t]);

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
          <DialogTitle>{`${t('board.column.deleteColumn')}`}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {description}
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
              const rowIds = getCards(id).map(row => row.id);

              handleDelete(rowIds);
              onOpenChange?.(false);
            }}
          >{t('button.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ColumnDeleteConfirm;
