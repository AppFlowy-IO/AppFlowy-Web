import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import { MoreHorizontal, Users } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { Role, WorkspaceGroup, WorkspaceMember } from '@/application/types';
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
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getErrorMessage, isAPIErrorCode } from '@/utils/errors';

type PeopleTab = 'members' | 'groups';

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

function roleLabel(role: Role, t: TFunction): string {
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

function joinedLabel(joinedAt: string | null | undefined, t: TFunction): string | null {
  if (!joinedAt) return null;
  const d = dayjs(joinedAt);

  if (!d.isValid()) return null;
  return `${t('settings.appearance.members.joinedOn')} ${d.format('MMM D, YYYY')}`;
}

function buildInviteUrl(code: string): string {
  return `${window.location.origin}/app/invited/${code}`;
}

function tabLabel(label: string, count: number): string {
  return `${label} ${count}`;
}

function matchesMember(member: WorkspaceMember, search: string, t: TFunction): boolean {
  const value = search.trim().toLowerCase();

  if (!value) return true;

  return (
    member.name.toLowerCase().includes(value) ||
    member.email.toLowerCase().includes(value) ||
    roleLabel(member.role, t).toLowerCase().includes(value)
  );
}

function matchesGroup(group: WorkspaceGroup, search: string): boolean {
  const value = search.trim().toLowerCase();

  if (!value) return true;
  return group.name.toLowerCase().includes(value);
}

function groupMemberCountLabel(count: number, t: TFunction): string {
  return t('settings.appearance.people.groupMembersCount', { count });
}

export function MembersPanel() {
  const { t } = useTranslation();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const [tab, setTab] = useState<PeopleTab>('members');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [emailValue, setEmailValue] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [updatingGroupId, setUpdatingGroupId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const memberListRef = useRef<WorkspaceMember[]>([]);
  const removingRef = useRef(false);

  const isOwner = useMemo(() => {
    const workspace = userWorkspaceInfo?.workspaces.find((w) => w.id === currentWorkspaceId);

    return workspace?.owner?.uid.toString() === currentUser?.uid.toString();
  }, [userWorkspaceInfo?.workspaces, currentWorkspaceId, currentUser?.uid]);

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

  useEffect(() => {
    if (!currentWorkspaceId || !isOwner) {
      setGroups([]);
      return;
    }

    let cancelled = false;

    setLoadingGroups(true);
    void (async () => {
      try {
        const result = await WorkspaceService.getWorkspaceGroups(currentWorkspaceId);

        if (!cancelled) setGroups(result.groups || []);
      } catch (e) {
        if (!cancelled) toast.error(getErrorMessage(e, t('settings.appearance.people.loadGroupsFailed')));
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, isOwner, t]);

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

  const refreshGroups = useCallback(async () => {
    if (!currentWorkspaceId || !isOwner) return;
    try {
      const result = await WorkspaceService.getWorkspaceGroups(currentWorkspaceId);

      setGroups(result.groups || []);
    } catch (e) {
      toast.error(getErrorMessage(e, t('settings.appearance.people.loadGroupsFailed')));
    }
  }, [currentWorkspaceId, isOwner, t]);

  const visibleMembers = useMemo(
    () => members.filter((member) => matchesMember(member, memberSearch, t)),
    [memberSearch, members, t]
  );

  const visibleGroups = useMemo(
    () => groups.filter((group) => matchesGroup(group, groupSearch)),
    [groupSearch, groups]
  );

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

  const handleCreateGroup = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!currentWorkspaceId || !isOwner) return;
      const name = newGroupName.trim();

      if (!name) return;

      setCreatingGroup(true);
      try {
        await WorkspaceService.createWorkspaceGroup(currentWorkspaceId, { name });
        toast.success(t('settings.appearance.people.createGroupSuccess'));
        setNewGroupName('');
        setShowCreateGroup(false);
        await refreshGroups();
      } catch (e) {
        toast.error(getErrorMessage(e, t('settings.appearance.people.createGroupFailed')));
      } finally {
        setCreatingGroup(false);
      }
    },
    [currentWorkspaceId, isOwner, newGroupName, refreshGroups, t]
  );

  const startRenameGroup = useCallback((group: WorkspaceGroup) => {
    setEditingGroupId(group.group_id);
    setEditingGroupName(group.name);
  }, []);

  const handleRenameGroup = useCallback(
    async (group: WorkspaceGroup) => {
      if (!currentWorkspaceId || !isOwner) return;
      const name = editingGroupName.trim();

      if (!name) return;
      if (name === group.name) {
        setEditingGroupId(null);
        setEditingGroupName('');
        return;
      }

      setUpdatingGroupId(group.group_id);
      try {
        await WorkspaceService.updateWorkspaceGroup(currentWorkspaceId, group.group_id, { name });
        toast.success(t('settings.appearance.people.renameGroupSuccess'));
        setEditingGroupId(null);
        setEditingGroupName('');
        await refreshGroups();
      } catch (e) {
        toast.error(getErrorMessage(e, t('settings.appearance.people.renameGroupFailed')));
      } finally {
        setUpdatingGroupId(null);
      }
    },
    [currentWorkspaceId, editingGroupName, isOwner, refreshGroups, t]
  );

  const handleDeleteGroup = useCallback(
    async (group: WorkspaceGroup) => {
      if (!currentWorkspaceId || !isOwner) return;

      setDeletingGroupId(group.group_id);
      try {
        await WorkspaceService.removeWorkspaceGroup(currentWorkspaceId, group.group_id);
        toast.success(t('settings.appearance.people.deleteGroupSuccess'));
        await refreshGroups();
      } catch (e) {
        toast.error(getErrorMessage(e, t('settings.appearance.people.deleteGroupFailed')));
      } finally {
        setDeletingGroupId(null);
      }
    },
    [currentWorkspaceId, isOwner, refreshGroups, t]
  );

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='px-8 pb-4 pt-7'>
        <h2 className='text-[28px] font-semibold leading-9 text-text-primary'>
          {t('settings.appearance.people.title')}
        </h2>
        <div className='mt-2 flex items-center gap-3 text-sm text-text-primary'>
          <span>{t('settings.appearance.people.description')}</span>
          <button type='button' className='text-text-action hover:text-text-action-hover'>
            {t('workspace.learnMore')}
          </button>
        </div>
      </div>

      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 pb-6'>
        <div className='flex flex-col gap-6'>
          {isOwner && (
            <section className='flex items-start justify-between gap-4 pt-10'>
              <div className='flex max-w-[520px] flex-col gap-2'>
                <div className='text-sm font-semibold text-text-primary'>
                  {t('settings.appearance.people.addMembersViaLink')}
                </div>
                <div className='text-sm leading-6 text-text-secondary'>
                  {t('settings.appearance.people.inviteLinkDescription')}{' '}
                  <button
                    type='button'
                    onClick={() => void handleGenerateLink()}
                    disabled={generatingLink}
                    className='underline hover:text-text-primary disabled:opacity-50'
                    data-testid='generate-new-invite-link'
                  >
                    {t('settings.appearance.members.generateNewLink')}
                  </button>
                  .
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
            </section>
          )}

          <Tabs value={tab} onValueChange={(value) => setTab(value as PeopleTab)} className='gap-5'>
            <div className='flex items-center justify-between gap-4'>
              <TabsList className='gap-1'>
                <TabsTrigger
                  value='members'
                  className='h-9 rounded-300 px-3 py-1 text-base data-[state=active]:bg-fill-content-hover data-[state=active]:after:hidden'
                >
                  {tabLabel(t('settings.appearance.people.membersTab'), members.length)}
                </TabsTrigger>
                <TabsTrigger
                  value='groups'
                  className='h-9 rounded-300 px-3 py-1 text-base data-[state=active]:bg-fill-content-hover data-[state=active]:after:hidden'
                >
                  {tabLabel(t('settings.appearance.people.groupsTab'), groups.length)}
                </TabsTrigger>
              </TabsList>

              {tab === 'groups' && isOwner && (
                <Button type='button' size='lg' onClick={() => setShowCreateGroup(true)}>
                  {t('settings.appearance.people.createGroup')}
                </Button>
              )}
            </div>

            <TabsContent value='members' className='outline-none'>
              <div className='flex flex-col gap-5'>
                {isOwner && (
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
                )}

                <div className='flex items-center justify-end'>
                  <SearchInput
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder={t('settings.appearance.people.searchMembers')}
                    className='h-9 w-[260px]'
                  />
                </div>

                <div className='flex flex-col'>
                  <div className='grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_minmax(0,2fr)_32px] gap-4 border-b border-border-primary pb-2 text-xs font-medium text-text-secondary'>
                    <span>{t('settings.appearance.members.user')}</span>
                    <span>{t('settings.appearance.members.role')}</span>
                    <span>{t('settings.appearance.members.email')}</span>
                    <span className='w-6' aria-hidden='true' />
                  </div>
                  {loadingMembers && members.length === 0 ? (
                    <div className='py-6 text-center text-sm text-text-secondary'>
                      <Progress />
                    </div>
                  ) : visibleMembers.length === 0 ? (
                    <div className='py-6 text-center text-sm text-text-secondary'>
                      {t('settings.appearance.members.noMembers')}
                    </div>
                  ) : (
                    visibleMembers.map((m, idx) => {
                      const subline = m.is_pending_invitation
                        ? t('settings.appearance.members.pending')
                        : joinedLabel(m.joined_at, t);
                      const canRemove = isOwner && m.role !== Role.Owner;

                      return (
                        <div
                          key={m.email || `member-${idx}`}
                          data-testid={`members-row-${m.email || idx}`}
                          className='grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_minmax(0,2fr)_32px] items-center gap-4 border-b border-border-primary py-3 text-sm'
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
                                  className='flex h-7 w-7 items-center justify-center rounded-300 text-icon-secondary hover:bg-fill-content-hover disabled:opacity-50'
                                  aria-label={t('settings.appearance.people.memberActions')}
                                >
                                  <MoreHorizontal className='h-4 w-4' />
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
                            <span className='w-7' aria-hidden='true' />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value='groups' className='outline-none'>
              <div className='flex flex-col gap-5'>
                {!isOwner ? (
                  <div className='rounded-400 border border-border-primary px-4 py-6 text-sm text-text-secondary'>
                    {t('settings.appearance.people.groupsOwnerOnly')}
                  </div>
                ) : (
                  <>
                    {showCreateGroup && (
                      <form
                        className='flex items-center gap-2 rounded-400 border border-border-primary p-3'
                        onSubmit={(event) => void handleCreateGroup(event)}
                      >
                        <Input
                          value={newGroupName}
                          onChange={(e) => setNewGroupName(e.target.value)}
                          placeholder={t('settings.appearance.people.groupNamePlaceholder')}
                          autoFocus
                          className='flex-1'
                        />
                        <Button type='submit' disabled={!newGroupName.trim() || creatingGroup} loading={creatingGroup}>
                          {t('settings.appearance.people.create')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          onClick={() => {
                            setShowCreateGroup(false);
                            setNewGroupName('');
                          }}
                        >
                          {t('button.cancel')}
                        </Button>
                      </form>
                    )}

                    <div className='flex items-center justify-between gap-3'>
                      <button
                        type='button'
                        className='flex items-center gap-2 text-sm font-medium text-text-secondary'
                      >
                        <Users className='h-4 w-4' />
                        {t('settings.appearance.people.groupType')}
                      </button>
                      <SearchInput
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                        placeholder={t('settings.appearance.people.searchGroups')}
                        className='h-9 w-[260px]'
                      />
                    </div>

                    <div className='flex flex-col'>
                      <div className='grid grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(120px,1fr)_32px] gap-4 border-b border-border-primary pb-2 text-xs font-medium text-text-secondary'>
                        <span>{t('settings.appearance.people.groupsTab')}</span>
                        <span>{t('settings.appearance.people.groupType')}</span>
                        <span>{t('settings.appearance.people.membersTab')}</span>
                        <span className='w-6' aria-hidden='true' />
                      </div>
                      {loadingGroups && groups.length === 0 ? (
                        <div className='py-6 text-center text-sm text-text-secondary'>
                          <Progress />
                        </div>
                      ) : visibleGroups.length === 0 ? (
                        <div className='py-6 text-center text-sm text-text-secondary'>
                          {t('settings.appearance.people.noGroups')}
                        </div>
                      ) : (
                        visibleGroups.map((group) => {
                          const editing = editingGroupId === group.group_id;

                          return (
                            <div
                              key={group.group_id}
                              className='grid grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(120px,1fr)_32px] items-center gap-4 border-b border-border-primary py-3 text-sm'
                            >
                              <div className='flex min-w-0 items-center gap-3'>
                                <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill-content-hover text-icon-secondary'>
                                  <Users className='h-5 w-5' />
                                </div>
                                {editing ? (
                                  <div className='flex min-w-0 flex-1 items-center gap-2'>
                                    <Input
                                      value={editingGroupName}
                                      onChange={(e) => setEditingGroupName(e.target.value)}
                                      autoFocus
                                      className='h-9 flex-1'
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          void handleRenameGroup(group);
                                        }

                                        if (e.key === 'Escape') {
                                          setEditingGroupId(null);
                                          setEditingGroupName('');
                                        }
                                      }}
                                    />
                                    <Button
                                      type='button'
                                      size='sm'
                                      disabled={!editingGroupName.trim() || updatingGroupId === group.group_id}
                                      loading={updatingGroupId === group.group_id}
                                      onClick={() => void handleRenameGroup(group)}
                                    >
                                      {t('button.save')}
                                    </Button>
                                  </div>
                                ) : (
                                  <span className='truncate font-medium text-text-primary'>{group.name}</span>
                                )}
                              </div>
                              <span className='truncate text-text-secondary'>
                                {t('settings.appearance.people.workspaceGroup')}
                              </span>
                              <span className='truncate text-text-secondary'>
                                {groupMemberCountLabel(group.member_count, t)}
                              </span>
                              {!editing && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type='button'
                                      disabled={deletingGroupId === group.group_id}
                                      className='flex h-7 w-7 items-center justify-center rounded-300 text-icon-secondary hover:bg-fill-content-hover disabled:opacity-50'
                                      aria-label={t('settings.appearance.people.groupActions')}
                                    >
                                      <MoreHorizontal className='h-4 w-4' />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align='end'>
                                    <DropdownMenuItem onSelect={() => startRenameGroup(group)}>
                                      {t('settings.appearance.people.renameGroup')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      variant='destructive'
                                      onSelect={() => void handleDeleteGroup(group)}
                                    >
                                      {t('settings.appearance.people.deleteGroup')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

export default MembersPanel;
