import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { NormalModal } from '@/components/_shared/modal';
import { HIDDEN_BUTTON_PROPS, MODAL_CLASSES, MODAL_PAPER_PROPS } from '@/components/app/workspaces/modal-props';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function EditWorkspace({
  open,
  openOnChange,
  defaultName,
  onOk,
  okText,
  title,
}: {
  defaultName?: string;
  open?: boolean;
  openOnChange?: (open: boolean) => void;
  onOk?: (name: string) => Promise<void>;
  okText?: string;
  title?: string;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const currentUser = useCurrentUser();

  const [name, setName] = useState(defaultName || `${currentUser?.name}'s Workspace`);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    try {
      await onOk?.(name);
      openOnChange?.(false);
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [name, openOnChange, onOk]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <NormalModal
      open={!!open}
      onClose={() => openOnChange?.(false)}
      title={
        <div style={{ textAlign: 'left' }}>{title || t('workspace.createNewWorkspace')}</div>
      }
      classes={MODAL_CLASSES}
      PaperProps={MODAL_PAPER_PROPS}
      okButtonProps={HIDDEN_BUTTON_PROPS}
      cancelButtonProps={HIDDEN_BUTTON_PROPS}
    >
      <div className='grid gap-4'>
        <div className='grid gap-3'>
          <Label htmlFor='name'>{t('workspace.workspaceName')}</Label>
          <Input
            id='name'
            name='name'
            autoFocus
            value={name}
            autoComplete='off'
            ref={(input: HTMLInputElement) => {
              if (!input) return;
              if (!inputRef.current) {
                setTimeout(() => {
                  input.focus();
                  input.setSelectionRange(0, input.value.length);
                }, 100);
                inputRef.current = input;
              }
            }}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                void handleCreate();
              }
            }}
          />
        </div>
      </div>
      <div className='flex w-full justify-end gap-3 mt-4'>
        <Button variant='outline' onClick={() => openOnChange?.(false)}>
          {t('button.cancel')}
        </Button>
        <Button
          disabled={!name.trim()}
          loading={loading}
          onClick={() => void handleCreate()}
        >
          {okText || t('workspace.create')}
        </Button>
      </div>
    </NormalModal>
  );
}

export default EditWorkspace;
