import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
  canSubmit = true,
  nameReadOnly = false,
  secondaryAction,
  children,
}: {
  defaultName?: string;
  open?: boolean;
  openOnChange?: (open: boolean) => void;
  onOk?: (name: string) => Promise<void>;
  okText?: string;
  title?: string;
  canSubmit?: boolean;
  nameReadOnly?: boolean;
  /** Shown at the start of the footer, e.g. Discard for a saved request. */
  secondaryAction?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  const currentUser = useCurrentUser();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A dialog kept mounted while closed must reopen with the same suggestion it first showed.
  const initialName = defaultName || (currentUser?.name ? `${currentUser.name}'s Workspace` : '');
  const [name, setName] = useState(initialName);

  const handleCreate = useCallback(async () => {
    if (!canSubmit || loading || !name.trim()) return;
    setLoading(true);
    try {
      await onOk?.(name);
      if (mounted.current) openOnChange?.(false);
      // eslint-disable-next-line
    } catch (e: any) {
      if (mounted.current) toast.error(e.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [name, openOnChange, onOk, canSubmit, loading]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) setName(initialName);
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
        {children}
        <div className='grid gap-3'>
          <Label htmlFor='name'>{t('workspace.workspaceName')}</Label>
          <Input
            id='name'
            name='name'
            autoFocus
            value={name}
            autoComplete='off'
            readOnly={nameReadOnly}
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
      <div className='mt-4 flex w-full items-center gap-3'>
        {secondaryAction}
        <div className='ml-auto flex gap-3'>
          <Button variant='outline' onClick={() => openOnChange?.(false)}>
            {t('button.cancel')}
          </Button>
          <Button
            disabled={!name.trim() || !canSubmit || loading}
            loading={loading}
            onClick={() => void handleCreate()}
          >
            {okText || t('workspace.create')}
          </Button>
        </div>
      </div>
    </NormalModal>
  );
}

export default EditWorkspace;
