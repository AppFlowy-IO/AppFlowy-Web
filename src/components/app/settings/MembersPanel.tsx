import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { Role, WorkspaceMember } from '@/application/types';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

function joinedLabel(joinedAt: string | null | undefined, t: (k: string) => string): string | null {
  if (!joinedAt) return null;
  const d = dayjs(joinedAt);

  if (!d.isValid()) return null;
  return `${t('settings.appearance.members.joinedOn')} ${d.format('MMM D, YYYY')}`;
}

function buildInviteUrl(code: string): string {
  return `${window.location.origin}/app/invited/${code}`;
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
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const memberListRef = useRef<WorkspaceMember[]>([]);
  const removingRef = useRef(false);

  const isOwner = useMemo(() => {
    const workspace = userWorkspaceInfo?.workspaces.find((w) => w.id === currentWorkspaceId);

    return workspace?.owner?.uid.toString() === currentUser?.uid.toString();
  }, [userWorkspaceInfo?.workspaces, currentWorkspaceId, currentUser?.uid]);

  // Load members — guarded against unmount and workspace switch.
  // Only owners may request pending invitations.
  useEffect(() => {
    if (!currentWorkspaceId) return;
    let cancelled = false;

    setLoadingMembers(true);
    void (async () => {
      try {
        const list = await WorkspaceService.getMembers(currentWorkspaceId, isOwner);

        if (cancelled) return;
        memberListRef.current = list;
        setMembers(list);
      } catch (e) {
        if (!cancelled) toast.error(getErrorMessage(e));
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, isOwner]);

  // Load invite code — only owners, only treat 404 as "no code yet".
  useEffect(() => {
    if (!currentWorkspaceId || !isOwner) {
      setInviteCode(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const result = await WorkspaceService.getInviteCode(currentWorkspaceId);

        if (!cancelled) setInviteCode(result?.code ?? null);
      } catch (e) {
        if (cancelled) return;
        // 404 ≈ no invite code exists yet. Anything else is a real failure
        // the owner should know about.
        if (isAPIErrorCode(e, ERROR_CODE.RECORD_NOT_FOUND)) {
          setInviteCode(null);
        } else {
          toast.error(getErrorMessage(e));
          setInviteCode(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, isOwner]);

  const refreshMembers = useCallback(async () => {
    if (!currentWorkspaceId) return;
    try {
      const list = await WorkspaceService.getMembers(currentWorkspaceId, true);

      memberListRef.current = list;
      setMembers(list);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  }, [currentWorkspaceId]);

  const handleInvite = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const emails = parseInviteEmails(emailValue);

    if (emails.length === 0) return;

    const existing = new Set(memberListRef.current.map((m) => m.email.toLowerCase()));
    const already = emails.filter((e) => existing.has(e.toLowerCase()));

    if (already.length > 0) {
      toast.warning(t('inviteMember.inviteAlready', { email: already[0] }));
      return;
    }

    setInviting(true);
    try {
      await WorkspaceService.inviteMembers(currentWorkspaceId, emails);
      toast.success(t('inviteMember.inviteSuccess'));
      setEmailValue('');
      await refreshMembers();
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
  }, [currentWorkspaceId, emailValue, refreshMembers, t]);

  const handleRemove = useCallback(
    async (email: string) => {
      if (!currentWorkspaceId || !email) return;
      if (removingRef.current) return;
      removingRef.current = true;
      setRemovingEmail(email);
      try {
        await WorkspaceService.removeMembers(currentWorkspaceId, [email]);
        toast.success(t('settings.appearance.members.removeFromWorkspaceSuccess'));
        await refreshMembers();
      } catch (e) {
        toast.error(getErrorMessage(e, t('settings.appearance.members.removeFromWorkspaceFailed')));
      } finally {
        removingRef.current = false;
        setRemovingEmail(null);
      }
    },
    [currentWorkspaceId, refreshMembers, t]
  );

  const handleCopyLink = useCallback(async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(buildInviteUrl(inviteCode));
      toast.success(t('shareAction.copyLinkSuccess'));
    } catch {
      toast.error(t('shareAction.copyLinkFailed'));
    }
  }, [inviteCode, t]);

  const handleGenerateLink = useCallback(async () => {
    if (!currentWorkspaceId || generatingLink) return;
    setGeneratingLink(true);
    try {
      const result = await WorkspaceService.createInviteCode(currentWorkspaceId, null);

      setInviteCode(result?.code ?? null);
      if (result?.code) {
        try {
          await navigator.clipboard.writeText(buildInviteUrl(result.code));
          toast.success(t('shareAction.copyLinkSuccess'));
        } catch {
          toast.success(t('settings.appearance.members.inviteLinkGenerated'));
        }
      }
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setGeneratingLink(false);
    }
  }, [currentWorkspaceId, generatingLink, t]);

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
              <div className='flex items-start justify-between gap-4'>
                <div className='flex flex-col gap-1'>
                  <div className='text-sm font-semibold text-text-primary'>
                    {t('settings.appearance.members.inviteLinkTitle')}
                  </div>
                  <div className='text-xs text-text-secondary'>
                    {inviteCode && `${t('settings.appearance.members.inviteLinkHintPrefix')} `}
                    <button
                      type='button'
                      onClick={() => void handleGenerateLink()}
                      disabled={generatingLink}
                      className='text-text-action hover:text-text-action-hover disabled:opacity-50'
                      data-testid='generate-new-invite-link'
                    >
                      {t('settings.appearance.members.generateNewLink')}
                    </button>
                  </div>
                </div>
                <Button
                  variant='outline'
                  onClick={() => void handleCopyLink()}
                  disabled={!inviteCode || generatingLink}
                  data-testid='copy-invite-link-button'
                >
                  {t('settings.appearance.members.copyLink')}
                </Button>
              </div>

              <div className='border-t border-border-primary' />

              <div className='flex flex-col gap-2'>
                <div className='text-sm font-semibold text-text-primary'>
                  {t('settings.appearance.members.inviteByEmailTitle')}
                </div>
                <div className='flex gap-2'>
                  <Input
                    className='flex-1'
                    value={emailValue}
                    placeholder={t('settings.appearance.members.inviteByEmailPlaceholder')}
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
                    {t('settings.appearance.members.invite')}
                  </Button>
                </div>
              </div>
            </>
          )}

          <div className='flex flex-col gap-3'>
            <div className='grid grid-cols-[2fr_1fr_2fr_auto] gap-4 border-b border-border-primary pb-2 text-xs font-medium text-text-secondary'>
              <span>{t('settings.appearance.members.user')}</span>
              <span>{t('settings.appearance.members.role')}</span>
              <span>{t('settings.appearance.members.email')}</span>
              <span className='w-6' aria-hidden='true' />
            </div>
            {loadingMembers && members.length === 0 ? (
              <div className='py-6 text-center text-sm text-text-secondary'>
                <Progress />
              </div>
            ) : members.length === 0 ? (
              <div className='py-6 text-center text-sm text-text-secondary'>
                {t('settings.appearance.members.noMembers')}
              </div>
            ) : (
              members.map((m, idx) => {
                const subline = m.is_pending_invitation
                  ? t('settings.appearance.members.pending')
                  : joinedLabel(m.joined_at, t);
                const canRemove = isOwner && m.role !== Role.Owner;

                return (
                  <div
                    key={m.email || `member-${idx}`}
                    data-testid={`members-row-${m.email || idx}`}
                    className='grid grid-cols-[2fr_1fr_2fr_auto] items-center gap-4 py-2 text-sm'
                  >
                    <div className='flex min-w-0 items-center gap-3'>
                      <Avatar size='md'>
                        <AvatarImage src={m.avatar_url} alt={m.name} />
                        <AvatarFallback name={m.name}>
                          {m.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex min-w-0 flex-col'>
                        <span className='truncate font-medium text-text-primary'>{m.name}</span>
                        {subline && (
                          <span
                            className={
                              m.is_pending_invitation
                                ? 'truncate text-xs text-text-warning'
                                : 'truncate text-xs text-text-secondary'
                            }
                          >
                            {subline}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className='text-text-secondary'>{roleLabel(m.role, t)}</span>
                    <span className='truncate text-text-secondary'>{m.email}</span>
                    {canRemove ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type='button'
                            data-testid={`member-actions-${m.email}`}
                            disabled={removingEmail === m.email}
                            className='flex h-6 w-6 items-center justify-center rounded-200 text-icon-secondary hover:bg-fill-content-hover disabled:opacity-50'
                            aria-label='Member actions'
                          >
                            <MoreIcon className='h-4 w-4' />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem
                            variant='destructive'
                            data-testid={`remove-member-${m.email}`}
                            onSelect={() => void handleRemove(m.email)}
                          >
                            {t('settings.appearance.members.removeFromWorkspace')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className='w-6' aria-hidden='true' />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MembersPanel;
