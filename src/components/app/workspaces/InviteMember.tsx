import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { Workspace, WorkspaceMember } from '@/application/types';
import { WorkspaceService } from '@/application/services/domains';
import { NormalModal } from '@/components/_shared/modal';
import { HIDDEN_BUTTON_PROPS, MODAL_CLASSES, MODAL_PAPER_PROPS } from '@/components/app/workspaces/modal-props';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string') return message;
  }

  return 'Request failed';
}

function isAPIErrorCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

function parseInviteEmails(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean)
    )
  );
}

function InviteMember({
  workspace,
  open,
  openOnChange,
}: {
  workspace: Workspace;
  open?: boolean;
  openOnChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const currentWorkspaceId = workspace.id;

  const currentUser = useCurrentUser();
  const memberListRef = useRef<WorkspaceMember[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const isOwner = workspace.owner?.uid.toString() === currentUser?.uid.toString();

  const loadMembers = useCallback(async () => {
    try {
      if (!currentWorkspaceId) return;
      memberListRef.current = await WorkspaceService.getMembers(currentWorkspaceId);
    } catch (e) {
      console.error(e);
    }
  }, [currentWorkspaceId]);

  const handleOk = async () => {
    if (!currentWorkspaceId) return;
    try {
      setLoading(true);
      const emails = parseInviteEmails(value);

      if (emails.length === 0) return;

      const hadInvited = emails.filter((e) => memberListRef.current.find((m) => m.email === e));

      if (hadInvited.length > 0) {
        toast.warning(t('inviteMember.inviteAlready', { email: hadInvited[0] }));
        return;
      }

      await WorkspaceService.inviteMembers(currentWorkspaceId, emails);

      openOnChange?.(false);
      toast.success(t('inviteMember.inviteSuccess'));
      // eslint-disable-next-line
    } catch (e: any) {
      const message = getErrorMessage(e);

      if (isAPIErrorCode(e, ERROR_CODE.MAILER_ERROR)) {
        openOnChange?.(false);
        toast.warning(message);
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setValue('');
    } else {
      void loadMembers();
      // Focus input after MUI Dialog animation completes
      const timer = setTimeout(() => inputRef.current?.focus(), 100);

      return () => clearTimeout(timer);
    }
  }, [open, loadMembers]);

  if (!isOwner) return null;

  return (
    <NormalModal
      open={!!open}
      onClose={() => openOnChange?.(false)}
      title={<div style={{ textAlign: 'left' }}>{t('inviteMember.requestInviteMembers')}</div>}
      classes={MODAL_CLASSES}
      disableAutoFocus
      disableEnforceFocus
      PaperProps={MODAL_PAPER_PROPS}
      okButtonProps={HIDDEN_BUTTON_PROPS}
      cancelButtonProps={HIDDEN_BUTTON_PROPS}
    >
      <div className='grid gap-4'>
        <div className='grid gap-3'>
          <Label htmlFor='emails'>{t('inviteMember.emails')}</Label>
          <Input
            id='emails'
            name='emails'
            ref={inputRef}
            onChange={(e) => setValue(e.target.value)}
            value={value}
            placeholder={t('inviteMember.addEmail')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleOk();
              }
            }}
          />
        </div>
      </div>
      <div className='mt-4 flex w-full justify-end gap-3'>
        <Button loading={loading} onClick={() => void handleOk()} disabled={!value}>
          {loading && <Progress />}
          {t('inviteMember.requestInvites')}
        </Button>
      </div>
    </NormalModal>
  );
}

export default InviteMember;
