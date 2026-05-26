import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { Role, WorkspaceMember } from '@/application/types';
import { useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { getErrorMessage, isAPIErrorCode } from '@/utils/errors';

function parseInviteEmails(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((email) => email.trim())
        .filter(Boolean)
    )
  );
}

function roleLabel(role: Role, t: (k: string) => string): string {
  switch (role) {
    case Role.Owner:
      return t('settings.appearance.members.owner');
    case Role.Guest:
      return t('settings.appearance.members.guest');
    case Role.Member:
    default:
      return t('settings.appearance.members.member');
  }
}

export function MembersPanel() {
  const { t } = useTranslation();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [emailValue, setEmailValue] = useState('');
  const [inviting, setInviting] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const memberListRef = useRef<WorkspaceMember[]>([]);

  const isOwner = useMemo(() => {
    const workspace = userWorkspaceInfo?.workspaces.find((w) => w.id === currentWorkspaceId);

    return workspace?.owner?.uid.toString() === currentUser?.uid.toString();
  }, [userWorkspaceInfo?.workspaces, currentWorkspaceId, currentUser?.uid]);

  const loadMembers = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setLoadingMembers(true);
    try {
      const list = await WorkspaceService.getMembers(currentWorkspaceId);

      memberListRef.current = list;
      setMembers(list);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setLoadingMembers(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const handleInvite = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const emails = parseInviteEmails(emailValue);

    if (emails.length === 0) return;

    const already = emails.filter((e) =>
      memberListRef.current.find((m) => m.email === e)
    );

    if (already.length > 0) {
      toast.warning(t('inviteMember.inviteAlready', { email: already[0] }));
      return;
    }

    setInviting(true);
    try {
      await WorkspaceService.inviteMembers(currentWorkspaceId, emails);
      toast.success(t('inviteMember.inviteSuccess'));
      setEmailValue('');
      await loadMembers();
    } catch (e) {
      const message = getErrorMessage(e);

      if (isAPIErrorCode(e, ERROR_CODE.MAILER_ERROR)) {
        toast.warning(message);
      } else {
        toast.error(message);
      }
    } finally {
      setInviting(false);
    }
  }, [currentWorkspaceId, emailValue, loadMembers, t]);

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>
          {t('settings.appearance.members.label')}
        </h2>
      </div>
      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-6'>
        <div className='flex flex-col gap-6'>
          {isOwner && (
            <>
              <div className='flex flex-col gap-2'>
                <div className='text-sm font-semibold text-text-primary'>
                  {t('inviteMember.requestInviteMembers')}
                </div>
                <div className='flex gap-2'>
                  <Input
                    className='flex-1'
                    value={emailValue}
                    placeholder={t('inviteMember.addEmail')}
                    onChange={(e) => setEmailValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !inviting && emailValue) {
                        void handleInvite();
                      }
                    }}
                    data-testid='members-invite-email-input'
                  />
                  <Button
                    onClick={() => void handleInvite()}
                    disabled={!emailValue || inviting}
                    loading={inviting}
                    data-testid='members-invite-button'
                  >
                    {inviting && <Progress />}
                    {t('settings.appearance.members.sendInvite')}
                  </Button>
                </div>
              </div>

              <div className='border-t border-border-primary' />
            </>
          )}

          <div className='flex flex-col gap-3'>
            <div className='grid grid-cols-[2fr_1fr_2fr] gap-4 border-b border-border-primary pb-2 text-xs font-medium text-text-secondary'>
              <span>{t('settings.appearance.members.user')}</span>
              <span>{t('settings.appearance.members.role')}</span>
              <span>{t('settings.appearance.members.email')}</span>
            </div>
            {loadingMembers && members.length === 0 ? (
              <div className='py-6 text-center text-sm text-text-secondary'>
                <Progress />
              </div>
            ) : members.length === 0 ? (
              <div className='py-6 text-center text-sm text-text-secondary'>
                {t('settings.appearance.members.label')}
              </div>
            ) : (
              members.map((m, idx) => (
                <div
                  key={m.email || `member-${idx}`}
                  data-testid={`members-row-${m.email || idx}`}
                  className='grid grid-cols-[2fr_1fr_2fr] items-center gap-4 py-2 text-sm'
                >
                  <div className='flex items-center gap-3 min-w-0'>
                    <Avatar size='md'>
                      <AvatarImage src={m.avatar_url} alt={m.name} />
                      <AvatarFallback name={m.name}>
                        {m.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className='truncate font-medium text-text-primary'>{m.name}</span>
                  </div>
                  <span className='text-text-secondary'>{roleLabel(m.role, t)}</span>
                  <span className='truncate text-text-secondary'>{m.email}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MembersPanel;
