import dayjs from 'dayjs';
import { MoreHorizontal, Search, Trash2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { Role, WorkspaceGroup, WorkspaceGroupMember, WorkspaceMember } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import {
  getWorkspaceMemberUid,
  useAddableWorkspaceMembers,
  WorkspaceMemberInlineSearch,
  WorkspaceMemberInlineSearchInput,
  workspaceMemberDisplayName,
} from '@/components/app/share/WorkspaceMemberInlineSearch';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getErrorMessage, isAPIErrorCode } from '@/utils/errors';

import type { TFunction } from 'i18next';

type PeopleTab = 'members' | 'groups';
type GroupDetailTab = 'general' | 'members';
const GROUP_EXCLUDED_WORKSPACE_ROLES = [Role.Guest];

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

function matchesGroup(group: WorkspaceGroup, normalizedSearch: string): boolean {
  if (!normalizedSearch) return true;
  return group.name.toLowerCase().includes(normalizedSearch);
}

function groupMemberCountLabel(count: number, t: TFunction): string {
  return t('settings.appearance.people.groupMembersCount', { count });
}

function groupMemberDisplayName(member: WorkspaceGroupMember, t: TFunction): string {
  return (
    member.name?.trim() || member.email?.trim() || t('settings.appearance.people.userFallbackName', { uid: member.uid })
  );
}

function fallbackInitial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || '?';
}

type CurrentWorkspaceId = ReturnType<typeof useCurrentWorkspaceId>;

export function MembersPanel() {
  const currentWorkspaceId = useCurrentWorkspaceId();
  const activeWorkspaceScopeRef = useRef({
    generation: 0,
    workspaceId: currentWorkspaceId,
  });

  if (activeWorkspaceScopeRef.current.workspaceId !== currentWorkspaceId) {
    activeWorkspaceScopeRef.current = {
      generation: activeWorkspaceScopeRef.current.generation + 1,
      workspaceId: currentWorkspaceId,
    };
  }

  const workspaceGeneration = activeWorkspaceScopeRef.current.generation;
  const isCurrentWorkspaceRequest = useCallback((workspaceId: CurrentWorkspaceId, generation: number) => {
    const currentScope = activeWorkspaceScopeRef.current;

    return currentScope.workspaceId === workspaceId && currentScope.generation === generation;
  }, []);

  return (
    <MembersPanelForWorkspace
      key={currentWorkspaceId ?? 'no-workspace'}
      currentWorkspaceId={currentWorkspaceId}
      workspaceGeneration={workspaceGeneration}
      isCurrentWorkspaceRequest={isCurrentWorkspaceRequest}
    />
  );
}

function MembersPanelForWorkspace({
  currentWorkspaceId,
  workspaceGeneration,
  isCurrentWorkspaceRequest,
}: {
  currentWorkspaceId: CurrentWorkspaceId;
  workspaceGeneration: number;
  isCurrentWorkspaceRequest: (workspaceId: CurrentWorkspaceId, generation: number) => boolean;
}) {
  const { t } = useTranslation();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const [tab, setTab] = useState<PeopleTab>('members');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [emailValue, setEmailValue] = useState('');
  const [renamingGroup, setRenamingGroup] = useState<WorkspaceGroup | null>(null);
  const [renamingGroupName, setRenamingGroupName] = useState('');
  const [deleteConfirmationGroup, setDeleteConfirmationGroup] = useState<WorkspaceGroup | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<WorkspaceGroup | null>(null);
  const [inviting, setInviting] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [updatingGroupId, setUpdatingGroupId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupSearch, setShowGroupSearch] = useState(false);
  const groupSearchInputRef = useRef<HTMLInputElement | null>(null);
  const removingRef = useRef(false);

  const isOwner = useMemo(() => {
    const workspace = userWorkspaceInfo?.workspaces.find((w) => w.id === currentWorkspaceId);

    return workspace?.role === Role.Owner || workspace?.owner?.uid.toString() === currentUser?.uid.toString();
  }, [userWorkspaceInfo?.workspaces, currentWorkspaceId, currentUser?.uid]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    let cancelled = false;

    setLoadingMembers(true);
    void (async () => {
      try {
        const list = await WorkspaceService.getMembers(currentWorkspaceId, isOwner);

        if (cancelled) return;
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

  // Keep the group search UI in sync when the list empties, without an extra
  // render cycle from a state-syncing effect.
  const applyGroups = useCallback((list: WorkspaceGroup[]) => {
    setGroups(list);
    if (list.length === 0) {
      setGroupSearch('');
      setShowGroupSearch(false);
    }
  }, []);

  useEffect(() => {
    if (!currentWorkspaceId || !isOwner) {
      applyGroups([]);
      return;
    }

    let cancelled = false;

    setLoadingGroups(true);
    void (async () => {
      try {
        const result = await WorkspaceService.getWorkspaceGroups(currentWorkspaceId);

        if (!cancelled) applyGroups(result.groups || []);
      } catch (e) {
        if (!cancelled) toast.error(getErrorMessage(e, t('settings.appearance.people.loadGroupsFailed')));
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyGroups, currentWorkspaceId, isOwner, t]);

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

  useEffect(() => {
    if (!showGroupSearch) return;

    groupSearchInputRef.current?.focus();
  }, [showGroupSearch]);

  const refreshMembers = useCallback(async () => {
    if (!currentWorkspaceId) return;
    try {
      const list = await WorkspaceService.getMembers(currentWorkspaceId, true);

      setMembers(list);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  }, [currentWorkspaceId]);

  const refreshGroups = useCallback(async () => {
    if (!currentWorkspaceId || !isOwner) return;
    const requestedWorkspaceId = currentWorkspaceId;
    const requestGeneration = workspaceGeneration;
    const isCurrentRequest = () => isCurrentWorkspaceRequest(requestedWorkspaceId, requestGeneration);

    try {
      const result = await WorkspaceService.getWorkspaceGroups(requestedWorkspaceId);

      if (isCurrentRequest()) applyGroups(result.groups || []);
    } catch (e) {
      if (isCurrentRequest()) {
        toast.error(getErrorMessage(e, t('settings.appearance.people.loadGroupsFailed')));
      }
    }
  }, [applyGroups, currentWorkspaceId, isCurrentWorkspaceRequest, isOwner, t, workspaceGeneration]);

  const visibleGroups = useMemo(() => {
    const normalizedGroupSearch = groupSearch.trim().toLowerCase();

    return groups.filter((group) => matchesGroup(group, normalizedGroupSearch));
  }, [groupSearch, groups]);

  const selectedGroupForPanel = useMemo(() => {
    if (!selectedGroup) return null;

    return groups.find((group) => group.group_id === selectedGroup.group_id) ?? selectedGroup;
  }, [groups, selectedGroup]);

  const handleInvite = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const emails = parseInviteEmails(emailValue);

    if (emails.length === 0) return;

    const existing = new Set(members.map((m) => m.email.toLowerCase()));
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
  }, [currentWorkspaceId, emailValue, members, refreshMembers, t]);

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

  const startRenameGroup = useCallback((group: WorkspaceGroup) => {
    setRenamingGroup(group);
    setRenamingGroupName(group.name);
  }, []);

  const closeRenameGroup = useCallback(() => {
    if (updatingGroupId) return;
    setRenamingGroup(null);
    setRenamingGroupName('');
  }, [updatingGroupId]);

  const handleRenameGroup = useCallback(
    async (group: WorkspaceGroup) => {
      if (!currentWorkspaceId || !isOwner) return;
      const name = renamingGroupName.trim();

      if (!name) return;
      if (name === group.name) {
        setRenamingGroup(null);
        setRenamingGroupName('');
        return;
      }

      setUpdatingGroupId(group.group_id);
      try {
        await WorkspaceService.updateWorkspaceGroup(currentWorkspaceId, group.group_id, { name });
        toast.success(t('settings.appearance.people.renameGroupSuccess'));
        setRenamingGroup(null);
        setRenamingGroupName('');
        await refreshGroups();
      } catch (e) {
        toast.error(getErrorMessage(e, t('settings.appearance.people.renameGroupFailed')));
      } finally {
        setUpdatingGroupId(null);
      }
    },
    [currentWorkspaceId, isOwner, refreshGroups, renamingGroupName, t]
  );

  const handleDeleteGroup = useCallback(
    async (group: WorkspaceGroup) => {
      if (!currentWorkspaceId || !isOwner) return;

      setDeletingGroupId(group.group_id);
      try {
        await WorkspaceService.removeWorkspaceGroup(currentWorkspaceId, group.group_id);
        toast.success(t('settings.appearance.people.deleteGroupSuccess'));
        setDeleteConfirmationGroup(null);
        setSelectedGroup((current) => (current?.group_id === group.group_id ? null : current));
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
            <div className='flex items-center gap-4'>
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
            </div>

            <TabsContent value='members' className='outline-none'>
              <div className='flex flex-col gap-5'>
                {isOwner && (
                  <div className='flex flex-col gap-2'>
                    <div className='text-sm font-semibold text-text-primary'>
                      {t('settings.appearance.members.inviteByEmailTitle')}
                    </div>
                    <WorkspaceMemberInlineSearchInput
                      search={emailValue}
                      onSearchChange={setEmailValue}
                      searchPlaceholder={t('settings.appearance.members.inviteByEmailPlaceholder')}
                      addButtonLabel={t('settings.appearance.members.invite')}
                      addButtonDisabled={!emailValue || inviting}
                      addButtonLoading={inviting}
                      addButtonIcon={inviting ? <Progress /> : null}
                      inputTestId='members-invite-email-input'
                      addButtonTestId='members-invite-button'
                      onAddButtonClick={() => void handleInvite()}
                      onInputKeyDown={(e) => {
                        if (e.key === 'Enter' && !inviting && emailValue) {
                          e.preventDefault();
                          void handleInvite();
                        }
                      }}
                    />
                  </div>
                )}

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
                          className='grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_minmax(0,2fr)_32px] items-center gap-4 border-b border-border-primary py-3 text-sm'
                        >
                          <div className='flex min-w-0 items-center gap-3'>
                            <Avatar size='md'>
                              <AvatarImage src={m.avatar_url} alt={m.name} />
                              <AvatarFallback name={m.name}>{m.name.charAt(0).toUpperCase()}</AvatarFallback>
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
                    <div className='flex items-center justify-end gap-2'>
                      {groups.length > 0 &&
                        (showGroupSearch ? (
                          <SearchInput
                            value={groupSearch}
                            inputRef={groupSearchInputRef}
                            onChange={(e) => setGroupSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== 'Escape') return;

                              e.preventDefault();
                              setGroupSearch('');
                              setShowGroupSearch(false);
                            }}
                            placeholder={t('settings.appearance.people.searchGroupsByName')}
                            className='h-9 w-[260px]'
                          />
                        ) : (
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-lg'
                            onClick={() => setShowGroupSearch(true)}
                            aria-label={t('settings.appearance.people.searchGroups')}
                            data-testid='people-groups-open-search-button'
                          >
                            <Search className='h-5 w-5' />
                          </Button>
                        ))}
                      <Button
                        type='button'
                        size='lg'
                        onClick={() => setShowCreateGroup(true)}
                        data-testid='people-create-group-button'
                      >
                        {t('settings.appearance.people.createGroup')}
                      </Button>
                    </div>

                    <div className='flex flex-col'>
                      <div className='grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_32px] gap-4 border-b border-border-primary pb-2 text-xs font-medium text-text-secondary'>
                        <span>{t('settings.appearance.people.groupsTab')}</span>
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
                          return (
                            <div
                              key={group.group_id}
                              data-testid={`group-row-${group.group_id}`}
                              className='grid cursor-pointer grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_32px] items-center gap-4 border-b border-border-primary py-3 text-sm hover:bg-fill-content-hover'
                              onClick={() => setSelectedGroup(group)}
                            >
                              <div className='flex min-w-0 items-center gap-3'>
                                <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill-content-hover text-icon-secondary'>
                                  <Users className='h-5 w-5' />
                                </div>
                                <span className='truncate font-medium text-text-primary'>{group.name}</span>
                              </div>
                              <span className='truncate text-text-secondary'>
                                {groupMemberCountLabel(group.member_count, t)}
                              </span>
                              <div onClick={(e) => e.stopPropagation()}>
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
                                      onSelect={() => setDeleteConfirmationGroup(group)}
                                    >
                                      {t('settings.appearance.people.deleteGroup')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
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
      {selectedGroupForPanel && currentWorkspaceId && (
        <GroupDetailModal
          open
          workspaceId={currentWorkspaceId}
          group={selectedGroupForPanel}
          onClose={() => setSelectedGroup(null)}
          onGroupChanged={refreshGroups}
          onGroupDeleted={() => {
            setSelectedGroup(null);
            void refreshGroups();
          }}
          workspaceMembers={members}
        />
      )}
      {showCreateGroup && currentWorkspaceId && (
        <CreateGroupModal
          open
          workspaceId={currentWorkspaceId}
          workspaceMembers={members}
          onClose={() => setShowCreateGroup(false)}
          onCreated={refreshGroups}
        />
      )}
      {renamingGroup && (
        <NormalModal
          open
          title={t('settings.appearance.people.renameGroup')}
          onClose={closeRenameGroup}
          onCancel={closeRenameGroup}
          onOk={() => void handleRenameGroup(renamingGroup)}
          okText={t('button.save')}
          okLoading={updatingGroupId === renamingGroup.group_id}
          okButtonProps={{
            disabled:
              !renamingGroupName.trim() ||
              renamingGroupName.trim() === renamingGroup.name ||
              updatingGroupId === renamingGroup.group_id,
            'data-testid': 'people-rename-group-submit',
          }}
          cancelButtonProps={{ disabled: updatingGroupId === renamingGroup.group_id }}
          PaperProps={{
            className: 'w-[420px] max-w-[calc(100vw-32px)]',
            'data-testid': 'rename-group-modal',
          }}
        >
          <Input
            value={renamingGroupName}
            onChange={(event) => setRenamingGroupName(event.target.value)}
            placeholder={t('settings.appearance.people.groupNamePlaceholder')}
            autoFocus
            disabled={updatingGroupId === renamingGroup.group_id}
            data-testid='people-rename-group-name-input'
          />
        </NormalModal>
      )}
      {deleteConfirmationGroup && (
        <NormalModal
          open
          danger
          title={t('settings.appearance.people.deleteGroupQuestion')}
          onClose={() => {
            if (!deletingGroupId) setDeleteConfirmationGroup(null);
          }}
          onCancel={() => {
            if (!deletingGroupId) setDeleteConfirmationGroup(null);
          }}
          onOk={() => void handleDeleteGroup(deleteConfirmationGroup)}
          okText={t('button.delete')}
          okLoading={deletingGroupId === deleteConfirmationGroup.group_id}
          okButtonProps={{
            'data-testid': 'people-delete-group-confirm',
          }}
          cancelButtonProps={{ disabled: deletingGroupId === deleteConfirmationGroup.group_id }}
          PaperProps={{
            className: 'w-[420px] max-w-[calc(100vw-32px)]',
            'data-testid': 'delete-group-confirmation',
          }}
        >
          <div className='text-sm text-text-secondary'>{t('settings.appearance.people.deleteGroupDescription')}</div>
        </NormalModal>
      )}
    </div>
  );
}

interface GroupDetailModalProps {
  open: boolean;
  workspaceId: string;
  group: WorkspaceGroup;
  workspaceMembers: WorkspaceMember[];
  onClose: () => void;
  onGroupChanged: () => Promise<void>;
  onGroupDeleted: () => void;
}

interface CreateGroupModalProps {
  open: boolean;
  workspaceId: string;
  workspaceMembers: WorkspaceMember[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}

interface CreateGroupMemberPickerProps {
  search: string;
  selectedMembers: WorkspaceMember[];
  addableMembers: WorkspaceMember[];
  disabled?: boolean;
  noMembersLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  unavailableTitle: string;
  removeMemberLabel: string;
  onSearchChange: (value: string) => void;
  onAddMember: (member: WorkspaceMember) => void;
  onRemoveMember: (member: WorkspaceMember) => void;
}

function CreateGroupMemberPicker({
  search,
  selectedMembers,
  addableMembers,
  disabled = false,
  noMembersLabel,
  searchPlaceholder,
  noResultsLabel,
  unavailableTitle,
  removeMemberLabel,
  onSearchChange,
  onAddMember,
  onRemoveMember,
}: CreateGroupMemberPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const visibleMembers = addableMembers.slice(0, 8);
  const hasSearch = search.trim().length > 0;

  return (
    <div className='flex flex-col'>
      <div
        className='rounded-300 bg-fill-content px-2 py-1'
        onClick={() => inputRef.current?.focus()}
        data-testid='create-group-member-picker'
      >
        {selectedMembers.map((member) => {
          const displayName = workspaceMemberDisplayName(member);

          return (
            <div
              key={getWorkspaceMemberUid(member) ?? member.email}
              className='flex items-center gap-3 rounded-300 px-2 py-2'
            >
              <Avatar size='md'>
                <AvatarImage src={member.avatar_url} alt={displayName} />
                <AvatarFallback name={displayName}>{fallbackInitial(displayName)}</AvatarFallback>
              </Avatar>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium text-text-primary'>{displayName}</div>
                {member.email !== displayName && (
                  <div className='truncate text-xs text-text-secondary'>{member.email}</div>
                )}
              </div>
              <button
                type='button'
                className='flex h-7 w-7 items-center justify-center rounded-300 text-icon-secondary hover:bg-fill-content-hover disabled:opacity-50'
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveMember(member);
                }}
                disabled={disabled}
                aria-label={removeMemberLabel}
              >
                <X className='h-4 w-4' />
              </button>
            </div>
          );
        })}
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onSearchChange('');
              inputRef.current?.blur();
              return;
            }

            if (e.key === 'Backspace' && !search && selectedMembers.length > 0) {
              onRemoveMember(selectedMembers[selectedMembers.length - 1]);
              return;
            }

            if (e.key === 'Enter') {
              const firstAvailableMember = visibleMembers.find((member) => getWorkspaceMemberUid(member));

              if (!firstAvailableMember) return;
              e.preventDefault();
              onAddMember(firstAvailableMember);
            }
          }}
          disabled={disabled}
          placeholder={selectedMembers.length === 0 ? noMembersLabel : searchPlaceholder}
          className='h-10 w-full bg-transparent px-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed'
          data-testid='create-group-member-search-input'
        />
      </div>

      {hasSearch && (
        <div className='mt-2 max-h-[240px] overflow-y-auto rounded-400 border border-border-primary bg-fill-content p-2 shadow-xl'>
          {visibleMembers.length === 0 ? (
            <div className='px-3 py-2 text-sm text-text-tertiary'>{noResultsLabel}</div>
          ) : (
            visibleMembers.map((member) => {
              const uid = getWorkspaceMemberUid(member);
              const displayName = workspaceMemberDisplayName(member);
              const showEmail = Boolean(member.email && member.email !== displayName);

              return (
                <button
                  key={`${member.email}-${uid ?? 'missing-uid'}`}
                  type='button'
                  className='flex w-full items-center gap-3 rounded-300 px-3 py-2 text-left hover:bg-fill-content-hover focus:bg-fill-content-hover focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'
                  onClick={() => onAddMember(member)}
                  disabled={disabled || !uid}
                  title={!uid ? unavailableTitle : undefined}
                  data-testid='create-group-member-search-result'
                >
                  <Avatar size='md'>
                    <AvatarImage src={member.avatar_url} alt={displayName} />
                    <AvatarFallback name={displayName}>{fallbackInitial(displayName)}</AvatarFallback>
                  </Avatar>
                  <div className='min-w-0 flex-1 truncate text-sm text-text-primary'>
                    <span className='font-semibold'>{displayName}</span>
                    {showEmail && <span className='ml-1 text-text-secondary'>{member.email}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function CreateGroupModal({ open, workspaceId, workspaceMembers, onClose, onCreated }: CreateGroupModalProps) {
  const { t } = useTranslation();
  const [groupName, setGroupName] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<WorkspaceMember[]>([]);
  const [creating, setCreating] = useState(false);

  const selectedMemberUids = useMemo(
    () => selectedMembers.map((member) => getWorkspaceMemberUid(member)).filter((uid): uid is string => Boolean(uid)),
    [selectedMembers]
  );
  const selectedMemberUidSet = useMemo(() => new Set(selectedMemberUids), [selectedMemberUids]);
  const selectedMemberEmailSet = useMemo(
    () => new Set(selectedMembers.map((member) => member.email.trim().toLowerCase())),
    [selectedMembers]
  );
  const addableWorkspaceMembers = useAddableWorkspaceMembers({
    workspaceMembers,
    search: memberSearch,
    excludedUids: selectedMemberUidSet,
    excludedEmails: selectedMemberEmailSet,
    excludedRoles: GROUP_EXCLUDED_WORKSPACE_ROLES,
    excludePending: true,
  });

  const handleAddMember = useCallback(
    (member: WorkspaceMember) => {
      const uid = getWorkspaceMemberUid(member);

      if (!uid) {
        toast.error(t('settings.appearance.people.workspaceMemberUidUnavailable'));
        return;
      }

      setSelectedMembers((current) =>
        current.some((currentMember) => getWorkspaceMemberUid(currentMember) === uid) ? current : [...current, member]
      );
      setMemberSearch('');
    },
    [t]
  );

  const handleRemoveSelectedMember = useCallback((member: WorkspaceMember) => {
    const uid = getWorkspaceMemberUid(member);

    setSelectedMembers((current) =>
      current.filter((currentMember) =>
        uid
          ? getWorkspaceMemberUid(currentMember) !== uid
          : currentMember.email.toLowerCase() !== member.email.toLowerCase()
      )
    );
  }, []);

  const handleCreateGroup = useCallback(async () => {
    const name = groupName.trim();

    if (!name || creating) return;
    if (selectedMemberUids.length !== selectedMembers.length) {
      toast.error(t('settings.appearance.people.workspaceMemberUidUnavailable'));
      return;
    }

    setCreating(true);
    try {
      const createdGroup = await WorkspaceService.createWorkspaceGroup(workspaceId, { name });

      try {
        for (const uid of selectedMemberUids) {
          await WorkspaceService.addWorkspaceGroupMember(workspaceId, createdGroup.group_id, { uid });
        }
      } catch (addMemberError) {
        try {
          await WorkspaceService.removeWorkspaceGroup(workspaceId, createdGroup.group_id);
          toast.error(getErrorMessage(addMemberError, t('settings.appearance.people.addGroupMemberFailed')));
          return;
        } catch {
          toast.error(t('settings.appearance.people.createGroupRollbackFailed'));
          await onCreated();
          onClose();
          return;
        }
      }

      toast.success(t('settings.appearance.people.createGroupSuccess'));

      try {
        await onCreated();
      } catch (refreshError) {
        toast.error(getErrorMessage(refreshError, t('settings.appearance.people.loadGroupsFailed')));
      }

      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e, t('settings.appearance.people.createGroupFailed')));
    } finally {
      setCreating(false);
    }
  }, [creating, groupName, onClose, onCreated, selectedMemberUids, selectedMembers.length, t, workspaceId]);

  return (
    <NormalModal
      open={open}
      onClose={onClose}
      title=''
      maxWidth={false}
      PaperProps={{
        className: 'w-[720px] max-w-[calc(100vw-32px)]',
        'data-testid': 'create-group-modal',
      }}
      cancelButtonProps={{ style: { display: 'none' } }}
      okButtonProps={{ style: { display: 'none' } }}
    >
      <div className='flex max-h-[76vh] min-h-[520px] flex-col gap-7 px-2 pb-2'>
        <div className='flex flex-col items-center gap-4 pt-3 text-center'>
          <Users className='h-12 w-12 text-icon-secondary' />
          <div className='flex flex-col gap-2'>
            <div className='text-2xl font-semibold text-text-primary'>
              {t('settings.appearance.people.createNewGroup')}
            </div>
            <div className='text-base text-text-secondary'>{t('settings.appearance.people.createGroupDescription')}</div>
          </div>
        </div>

        <div className='flex flex-col gap-5'>
          <section className='flex flex-col gap-2'>
            <div className='text-sm font-medium text-text-primary'>{t('settings.appearance.people.iconAndName')}</div>
            <div className='flex items-center gap-2'>
              <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-400 border border-border-primary bg-fill-content-hover text-icon-secondary'>
                <Users className='h-7 w-7' />
              </div>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateGroup();
                  }
                }}
                placeholder={t('settings.appearance.people.createGroupNamePlaceholder')}
                autoFocus
                className='h-12 flex-1 text-base'
                data-testid='people-create-group-name-input'
              />
            </div>
          </section>

          <section className='flex flex-col gap-3'>
            <div className='text-sm font-medium text-text-primary'>{t('settings.appearance.people.membersTab')}</div>
            <CreateGroupMemberPicker
              search={memberSearch}
              selectedMembers={selectedMembers}
              addableMembers={addableWorkspaceMembers}
              disabled={creating}
              noMembersLabel={t('settings.appearance.people.noMembersYet')}
              searchPlaceholder={t('settings.appearance.people.searchWorkspaceMembers')}
              noResultsLabel={t('settings.appearance.people.noWorkspaceMembersToAdd')}
              unavailableTitle={t('settings.appearance.people.workspaceMemberUidUnavailable')}
              removeMemberLabel={t('settings.appearance.people.removeFromGroup')}
              onSearchChange={setMemberSearch}
              onAddMember={handleAddMember}
              onRemoveMember={handleRemoveSelectedMember}
            />
          </section>
        </div>

        <div className='flex flex-col gap-3'>
          <Button
            type='button'
            size='lg'
            disabled={!groupName.trim() || creating}
            loading={creating}
            onClick={() => void handleCreateGroup()}
            data-testid='people-create-group-submit'
            className='h-12 w-full text-base font-medium'
          >
            {creating && <Progress variant='inherit' />}
            {t('settings.appearance.people.createGroupAction')}
          </Button>
          <Button type='button' variant='ghost' size='lg' onClick={onClose} disabled={creating} className='w-full'>
            {t('button.cancel')}
          </Button>
        </div>
      </div>
    </NormalModal>
  );
}

function GroupDetailModal({
  open,
  workspaceId,
  group,
  workspaceMembers,
  onClose,
  onGroupChanged,
  onGroupDeleted,
}: GroupDetailModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<GroupDetailTab>('general');
  const [groupMembers, setGroupMembers] = useState<WorkspaceGroupMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingGroupMembers, setLoadingGroupMembers] = useState(false);
  const [addingUid, setAddingUid] = useState<string | null>(null);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;

    let cancelled = false;

    setTab('general');
    setMemberSearch('');
    setLoadingGroupMembers(true);

    void (async () => {
      try {
        const groupMemberResult = await WorkspaceService.getWorkspaceGroupMembers(workspaceId, group.group_id);

        if (cancelled) return;
        setGroupMembers(groupMemberResult.members || []);
      } catch (e) {
        if (!cancelled) {
          toast.error(getErrorMessage(e, t('settings.appearance.people.loadGroupMembersFailed')));
        }
      } finally {
        if (!cancelled) setLoadingGroupMembers(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [group.group_id, open, t, workspaceId]);

  const groupMemberUidSet = useMemo(() => new Set(groupMembers.map((member) => member.uid)), [groupMembers]);
  const groupMemberEmailSet = useMemo(
    () =>
      new Set(
        groupMembers
          .map((member) => member.email?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email))
      ),
    [groupMembers]
  );

  const normalizedMemberSearch = memberSearch.trim().toLowerCase();

  const addableWorkspaceMembers = useAddableWorkspaceMembers({
    workspaceMembers,
    search: memberSearch,
    excludedUids: groupMemberUidSet,
    excludedEmails: groupMemberEmailSet,
    excludedRoles: GROUP_EXCLUDED_WORKSPACE_ROLES,
    excludePending: true,
  });
  const selectedAddableMember =
    normalizedMemberSearch && addableWorkspaceMembers.length === 1 ? addableWorkspaceMembers[0] : null;

  const displayedMemberCount =
    loadingGroupMembers && groupMembers.length === 0 ? group.member_count : groupMembers.length;
  const workspaceMembersByUid = useMemo(() => {
    const result = new Map<string, WorkspaceMember>();

    for (const member of workspaceMembers) {
      const uid = getWorkspaceMemberUid(member);

      if (uid) result.set(uid, member);
    }

    return result;
  }, [workspaceMembers]);
  const workspaceMembersByEmail = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.email.trim().toLowerCase(), member])),
    [workspaceMembers]
  );

  const handleAddMember = useCallback(
    async (workspaceMember: WorkspaceMember) => {
      const uid = getWorkspaceMemberUid(workspaceMember);

      if (!uid) {
        toast.error(t('settings.appearance.people.workspaceMemberUidUnavailable'));
        return;
      }

      setAddingUid(uid);
      try {
        const addedMember = await WorkspaceService.addWorkspaceGroupMember(workspaceId, group.group_id, { uid });
        const hydratedMember: WorkspaceGroupMember = {
          uid: addedMember.uid || uid,
          email: addedMember.email ?? workspaceMember.email,
          name: addedMember.name ?? workspaceMember.name,
        };

        setGroupMembers((current) =>
          current.some((currentMember) => currentMember.uid === hydratedMember.uid)
            ? current
            : [...current, hydratedMember]
        );
        setMemberSearch('');
        toast.success(t('settings.appearance.people.addGroupMemberSuccess'));
        await onGroupChanged();
      } catch (e) {
        toast.error(getErrorMessage(e, t('settings.appearance.people.addGroupMemberFailed')));
      } finally {
        setAddingUid(null);
      }
    },
    [group.group_id, onGroupChanged, t, workspaceId]
  );

  const handleRemoveMember = useCallback(
    async (member: WorkspaceGroupMember) => {
      setRemovingUid(member.uid);
      try {
        await WorkspaceService.removeWorkspaceGroupMember(workspaceId, group.group_id, member.uid);
        setGroupMembers((current) => current.filter((currentMember) => currentMember.uid !== member.uid));
        toast.success(t('settings.appearance.people.removeGroupMemberSuccess'));
        await onGroupChanged();
      } catch (e) {
        toast.error(getErrorMessage(e, t('settings.appearance.people.removeGroupMemberFailed')));
      } finally {
        setRemovingUid(null);
      }
    },
    [group.group_id, onGroupChanged, t, workspaceId]
  );

  const handleDeleteGroup = useCallback(async () => {
    setDeletingGroup(true);
    try {
      await WorkspaceService.removeWorkspaceGroup(workspaceId, group.group_id);
      toast.success(t('settings.appearance.people.deleteGroupSuccess'));
      setDeletingGroup(false);
      onGroupDeleted();
    } catch (e) {
      setDeletingGroup(false);
      toast.error(getErrorMessage(e, t('settings.appearance.people.deleteGroupFailed')));
    }
  }, [group.group_id, onGroupDeleted, t, workspaceId]);

  return (
    <NormalModal
      open={open}
      onClose={onClose}
      title={t('settings.appearance.people.manageGroup')}
      maxWidth={false}
      PaperProps={{
        className: 'w-[720px] max-w-[calc(100vw-32px)]',
        'data-testid': 'group-detail-modal',
      }}
      cancelButtonProps={{ style: { display: 'none' } }}
      okButtonProps={{ style: { display: 'none' } }}
    >
      <div className='flex max-h-[72vh] min-h-[460px] flex-col gap-5 overflow-hidden'>
        <div className='flex items-start gap-4 px-1'>
          <div className='flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-fill-content-hover text-icon-secondary'>
            <Users className='h-9 w-9' />
          </div>
          <div className='min-w-0 pt-1'>
            <div className='truncate text-2xl font-semibold text-text-primary'>{group.name}</div>
            <div className='mt-1 text-sm text-text-secondary'>{groupMemberCountLabel(displayedMemberCount, t)}</div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as GroupDetailTab)} className='min-h-0 flex-1 gap-4'>
          <TabsList className='gap-1'>
            <TabsTrigger
              value='general'
              className='h-9 rounded-300 px-3 py-1 text-base data-[state=active]:bg-fill-content-hover data-[state=active]:after:hidden'
            >
              {t('settings.appearance.people.generalTab')}
            </TabsTrigger>
            <TabsTrigger
              value='members'
              className='h-9 rounded-300 px-3 py-1 text-base data-[state=active]:bg-fill-content-hover data-[state=active]:after:hidden'
            >
              {t('settings.appearance.people.membersTab')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value='general' className='outline-none'>
            <div className='flex items-center justify-between gap-4 rounded-400 border border-border-primary p-4'>
              <div className='min-w-0'>
                <div className='text-sm font-semibold text-text-primary'>
                  {t('settings.appearance.people.deleteGroup')}
                </div>
                <div className='mt-1 text-sm leading-6 text-text-secondary'>
                  {t('settings.appearance.people.deleteGroupDescription')}
                </div>
              </div>
              <Button
                type='button'
                variant='destructive-outline'
                disabled={deletingGroup}
                loading={deletingGroup}
                onClick={() => void handleDeleteGroup()}
              >
                {deletingGroup ? <Progress variant='inherit' /> : <Trash2 className='h-4 w-4' />}
                {t('settings.appearance.people.deleteGroup')}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value='members' className='min-h-0 flex-1 outline-none'>
            <div className='flex h-full min-h-0 flex-col gap-4'>
              <WorkspaceMemberInlineSearch
                search={memberSearch}
                onSearchChange={setMemberSearch}
                addableMembers={addableWorkspaceMembers}
                searchPlaceholder={t('settings.appearance.people.searchWorkspaceMembers')}
                addButtonLabel={t('settings.appearance.people.addUser')}
                addResultLabel={t('settings.appearance.people.notInGroup')}
                addActionLabel={t('button.add')}
                ownerBadgeLabel={t('settings.appearance.people.workspaceOwner')}
                unavailableTitle={t('settings.appearance.people.workspaceMemberUidUnavailable')}
                inputDisabled={loadingGroupMembers}
                addButtonDisabled={loadingGroupMembers || Boolean(addingUid) || !selectedAddableMember}
                addingUid={addingUid}
                maxResults={2}
                inputClassName='h-9 flex-1'
                onAddButtonClick={() => {
                  if (selectedAddableMember) void handleAddMember(selectedAddableMember);
                }}
                onInputKeyDown={(event) => {
                  if (event.key !== 'Enter' || !selectedAddableMember || addingUid) return;
                  event.preventDefault();
                  void handleAddMember(selectedAddableMember);
                }}
                onAddMember={(member) => void handleAddMember(member)}
              />

              <div className='appflowy-scroller min-h-0 flex-1 overflow-y-auto'>
                {loadingGroupMembers && groupMembers.length === 0 ? (
                  <div className='py-6 text-center text-sm text-text-secondary'>
                    <Progress />
                  </div>
                ) : groupMembers.length === 0 ? (
                  <div className='py-6 text-center text-sm text-text-secondary'>
                    {t('settings.appearance.people.noGroupMembers')}
                  </div>
                ) : (
                  groupMembers.map((member) => {
                    const workspaceMember =
                      workspaceMembersByUid.get(member.uid) ||
                      (member.email ? workspaceMembersByEmail.get(member.email.trim().toLowerCase()) : undefined);
                    const displayName =
                      member.name?.trim() || workspaceMember?.name || groupMemberDisplayName(member, t);
                    const email = member.email?.trim() || workspaceMember?.email;

                    return (
                      <div
                        key={member.uid}
                        data-testid={`group-member-row-${member.uid}`}
                        className='flex items-center justify-between gap-3 border-b border-border-primary py-3 text-sm'
                      >
                        <div className='flex min-w-0 items-center gap-3'>
                          <Avatar size='md'>
                            <AvatarImage src={workspaceMember?.avatar_url} alt={displayName} />
                            <AvatarFallback name={displayName}>{fallbackInitial(displayName)}</AvatarFallback>
                          </Avatar>
                          <div className='flex min-w-0 flex-col'>
                            <span className='truncate font-medium text-text-primary'>{displayName}</span>
                            {email && <span className='truncate text-xs text-text-secondary'>{email}</span>}
                          </div>
                        </div>
                        <Button
                          type='button'
                          size='sm'
                          variant='ghost'
                          className='text-text-action hover:text-text-action-hover'
                          disabled={removingUid === member.uid}
                          loading={removingUid === member.uid}
                          onClick={() => void handleRemoveMember(member)}
                        >
                          {t('button.remove')}
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </NormalModal>
  );
}

export default MembersPanel;
