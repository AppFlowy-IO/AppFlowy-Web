import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { UpdatePagePayload, View } from '@/application/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

function RenameModal({
  view,
  open,
  onClose,
  viewId,
  updatePage,
}: {
  open: boolean;
  onClose: () => void;
  viewId: string;
  view?: Pick<View, 'name'>;
  updatePage: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
}) {
  const { t } = useTranslation();

  const [newValue, setNewValue] = React.useState(view?.name ?? '');
  const [loading, setLoading] = React.useState(false);
  const activeViewIdRef = useRef<string>();
  const dirtyRef = useRef(false);

  const handleOk = useCallback(async () => {
    if (!view) return;
    if (!newValue.trim()) {
      toast.warning(t('web.error.pageNameIsEmpty'));
      return;
    }

    if (newValue === view.name) {
      onClose();
      return;
    }

    setLoading(true);
    try {
      await updatePage(viewId, {
        name: newValue,
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
    if (!view) return;

    if (activeViewIdRef.current !== viewId) {
      activeViewIdRef.current = viewId;
      dirtyRef.current = false;
      setNewValue(view.name);
      return;
    }

    if (!dirtyRef.current) {
      setNewValue(view.name);
    }
  }, [view, viewId]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        // Take over the dialog's initial focus so the field is focused *and*
        // fully selected in one deterministic step. Previously the selection was
        // applied on a 100ms timer that raced the dialog's own autofocus: when
        // the timer lost, the caret sat at the end of the pre-filled name and
        // typing appended to it instead of replacing it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();

          const input = inputRef.current;

          if (!input) return;

          input.focus();
          input.select();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('button.rename')}</DialogTitle>
        </DialogHeader>
        <Input
          data-testid='rename-modal-input'
          placeholder={'Enter new name'}
          value={newValue}
          ref={inputRef}
          onChange={(e) => {
            dirtyRef.current = true;
            setNewValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              void handleOk();
            }
          }}
        />
        <DialogFooter>
          <Button variant={'outline'} onClick={onClose}>
            {t('button.cancel')}
          </Button>
          <Button
            data-testid='rename-modal-save'
            loading={loading}
            onClick={() => {
              void handleOk();
            }}
          >
            {t('button.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RenameModal;
