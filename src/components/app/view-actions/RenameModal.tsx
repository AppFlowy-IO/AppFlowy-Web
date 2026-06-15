import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { UpdatePagePayload, View, ViewIconType } from '@/application/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';


function RenameModal ({ view, open, onClose, viewId, updatePage }: {
  open: boolean;
  onClose: () => void;
  viewId: string;
  view?: View;
  updatePage: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
}) {

  const { t } = useTranslation();

  const [newValue, setNewValue] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleOk = useCallback(async () => {
    if (!view) return;
    if (!newValue) {
      toast.warning(t('web.error.pageNameIsEmpty'));
      return;
    }

    if (newValue === view.name) {
      return;
    }

    setLoading(true);
    try {
      await updatePage(viewId, {
        name: newValue, icon: view.icon || {
          ty: ViewIconType.Emoji,
          value: '',
        }, extra: view.extra || {},
      });
      onClose();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [newValue, t, updatePage, view, viewId, onClose]);

  useEffect(() => {
    if (view) {
      setNewValue(view.name);
    }
  }, [view]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        onCloseAutoFocus={e => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('button.rename')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          data-testid="rename-modal-input"
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
              void handleOk();
            }
          }}
        />
        <DialogFooter>
          <Button
            variant={'outline'}
            onClick={onClose}
          >
            {t('button.cancel')}
          </Button>
          <Button
            data-testid="rename-modal-save"
            loading={loading}
            onClick={() => {
              void handleOk();
              onClose();
            }}
          >{t('button.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RenameModal;