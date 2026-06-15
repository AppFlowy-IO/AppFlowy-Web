import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent, DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

function RenameFile ({
  open,
  onOpenChange,
  onOk,
  file,
}: {
  file: FileMediaCellDataItem;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOk: (newName: string) => void;
}) {
  const { t } = useTranslation();
  const [newValue, setNewValue] = useState(file.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        onCloseAutoFocus={e => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('grid.media.rename')}</DialogTitle>
          <DialogDescription>{t('grid.media.renameHint')}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={'Enter new name'}
          value={newValue}
          ref={(input: HTMLInputElement) => {
            if (!input) return;
            if (!inputRef.current) {
              setTimeout(() => {
                input.setSelectionRange(0, input.value.length);
              }, 100);
              inputRef.current = input;
            }

          }}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              onOk(newValue);
              onOpenChange?.(false);
            }
          }}
        />
        <DialogFooter>
          <Button
            variant={'outline'}
            onClick={() => {
              onOpenChange?.(false);
            }}
          >{t('button.cancel')}</Button>
          <Button
            onClick={() => {
              onOk(newValue);
              onOpenChange?.(false);
            }}
          >{t('button.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RenameFile;