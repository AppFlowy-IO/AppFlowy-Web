import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { Role, WorkspaceGroup, WorkspaceGroupMember, WorkspaceMember } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { WorkspaceGroupIcon } from '@/components/app/share/WorkspaceGroupIcon';
import {
  getWorkspaceMemberUid,
  useAddableWorkspaceMembers,
  WorkspaceMemberInlineSearch,
  WorkspaceMemberInlineSearchInput,
  workspaceMemberDisplayName,
} from '@/components/app/share/WorkspaceMemberInlineSearch';
import { useCurrentUser } from '@/components/main/app.hooks';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
      <div className='px-6 pb-4 pt-6'>
        <h2 className='text-2xl font-semibold leading-8 text-text-primary'>{t('settings.appearance.people.title')}</h2>
        <div className='mt-1 flex items-center gap-3 text-xs leading-[18px] text-text-secondary'>
          <span>{t('settings.appearance.people.description')}</span>
          <button
            type='button'
            className='rounded-100 text-text-action hover:text-text-action-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
          >
            {t('workspace.learnMore')}
          </button>
        </div>
      </div>

      <div className='appflowy-scroller flex-1 overflow-y-auto px-6 pb-6'>
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
              <TabsList className='gap-1.5'>
                <TabsTrigger
                  value='members'
                  className='h-8 min-w-0 items-center rounded-300 px-3 py-1.5 text-sm font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick data-[state=active]:bg-fill-content-hover data-[state=active]:text-text-primary data-[state=active]:after:hidden'
                >
                  {tabLabel(t('settings.appearance.people.membersTab'), members.length)}
                </TabsTrigger>
                <TabsTrigger
                  value='groups'
                  className='h-8 min-w-0 items-center rounded-300 px-3 py-1.5 text-sm font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick data-[state=active]:bg-fill-content-hover data-[state=active]:text-text-primary data-[state=active]:after:hidden'
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
                                  <MoreIcon aria-hidden='true' className='h-4 w-4' />
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
                            name='workspace-group-search'
                            aria-label={t('settings.appearance.people.searchGroups')}
                            autoComplete='off'
                            onChange={(e) => setGroupSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== 'Escape') return;

                              e.preventDefault();
                              setGroupSearch('');
                              setShowGroupSearch(false);
                            }}
                            placeholder={t('settings.appearance.people.searchGroupsByName')}
                            className='h-8 w-[260px] [&>svg]:h-4 [&>svg]:w-4'
                          />
                        ) : (
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-lg'
                            onClick={() => setShowGroupSearch(true)}
                            aria-label={t('settings.appearance.people.searchGroups')}
                            data-testid='people-groups-open-search-button'
                            className='focus-visible:ring-1 focus-visible:ring-border-theme-thick'
                          >
                            <SearchIcon aria-hidden='true' className='h-5 w-5' />
                          </Button>
                        ))}
                      <Button
                        type='button'
                        size='lg'
                        onClick={() => setShowCreateGroup(true)}
                        data-testid='people-create-group-button'
                        className='focus-visible:ring-1 focus-visible:ring-border-theme-thick'
                      >
                        {t('settings.appearance.people.createGroup')}
                      </Button>
                    </div>

                    <div className='flex flex-col'>
                      <div className='grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_32px_32px] gap-4 border-b border-border-primary pb-2 text-xs font-medium leading-[18px] text-text-secondary'>
                        <span>{t('settings.appearance.people.groupsTab')}</span>
                        <span>{t('settings.appearance.people.membersTab')}</span>
                        <span className='col-span-2 w-16' aria-hidden='true' />
                      </div>
                      {loadingGroups && groups.length === 0 ? (
                        <div className='py-5 text-center text-sm text-text-secondary'>
                          <Progress />
                        </div>
                      ) : visibleGroups.length === 0 ? (
                        <div className='py-5 text-center text-sm text-text-secondary'>
                          {t('settings.appearance.people.noGroups')}
                        </div>
                      ) : (
                        visibleGroups.map((group) => {
                          return (
                            <div
                              key={group.group_id}
                              data-testid={`group-row-${group.group_id}`}
                              className='grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_32px_32px] items-center gap-4 border-b border-border-primary py-3 text-sm'
                            >
                              <div className='flex min-w-0 items-center gap-3'>
                                <WorkspaceGroupIcon variant='settings-row' />
                                <span className='truncate font-medium text-text-primary'>{group.name}</span>
                              </div>
                              <span className='truncate text-text-secondary'>
                                {groupMemberCountLabel(group.member_count, t)}
                              </span>
                              <button
                                type='button'
                                data-testid={`group-edit-${group.group_id}`}
                                className='flex h-7 w-7 items-center justify-center rounded-300 text-icon-secondary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
                                aria-label={`${t('button.edit')} ${group.name}`}
                                onClick={() => setSelectedGroup(group)}
                              >
                                <EditIcon aria-hidden='true' className='h-5 w-5' />
                              </button>
                              <div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type='button'
                                      disabled={deletingGroupId === group.group_id}
                                      className='flex h-7 w-7 items-center justify-center rounded-300 text-icon-secondary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick disabled:opacity-50'
                                      aria-label={`${t('settings.appearance.people.groupActions')} ${group.name}`}
                                    >
                                      <MoreIcon aria-hidden='true' className='h-4 w-4' />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align='end' className='w-[180px] min-w-[180px]'>
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
          onDeleteRequested={() => setDeleteConfirmationGroup(selectedGroupForPanel)}
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
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) closeRenameGroup();
          }}
        >
          <DialogContent
            size='sm'
            closeLabel={t('button.close')}
            className='bg-surface-primary p-5'
            aria-busy={updatingGroupId === renamingGroup.group_id}
            onEscapeKeyDown={(event) => {
              if (updatingGroupId === renamingGroup.group_id) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (updatingGroupId === renamingGroup.group_id) event.preventDefault();
            }}
          >
            <form
              data-testid='rename-group-modal'
              onSubmit={(event) => {
                event.preventDefault();
                void handleRenameGroup(renamingGroup);
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('settings.appearance.people.renameGroup')}</DialogTitle>
                <DialogDescription className='sr-only'>
                  {t('settings.appearance.people.groupNamePlaceholder')}
                </DialogDescription>
              </DialogHeader>
              <Input
                id='people-rename-group-name-input'
                name='workspace-group-name'
                size='sm'
                value={renamingGroupName}
                onChange={(event) => setRenamingGroupName(event.target.value)}
                placeholder={t('settings.appearance.people.groupNamePlaceholder')}
                aria-label={t('settings.appearance.people.groupNamePlaceholder')}
                autoFocus
                disabled={updatingGroupId === renamingGroup.group_id}
                data-testid='people-rename-group-name-input'
              />
              <DialogFooter className='gap-3'>
                <Button
                  type='button'
                  variant='outline'
                  disabled={updatingGroupId === renamingGroup.group_id}
                  onClick={closeRenameGroup}
                  data-testid='modal-cancel'
                >
                  {t('button.cancel')}
                </Button>
                <Button
                  type='submit'
                  aria-label={t('button.confirm')}
                  disabled={
                    !renamingGroupName.trim() ||
                    renamingGroupName.trim() === renamingGroup.name ||
                    updatingGroupId === renamingGroup.group_id
                  }
                  loading={updatingGroupId === renamingGroup.group_id}
                  data-testid='people-rename-group-submit'
                >
                  {updatingGroupId === renamingGroup.group_id ? <Progress variant='inherit' /> : t('button.confirm')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {deleteConfirmationGroup && (
        <AlertDialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen && !deletingGroupId) setDeleteConfirmationGroup(null);
          }}
        >
          <AlertDialogContent
            className='w-[440px] max-w-[calc(100%-2rem)] gap-5 rounded-400 border-0 bg-surface-primary p-5'
            data-testid='delete-group-confirmation'
            aria-busy={deletingGroupId === deleteConfirmationGroup.group_id}
            showCloseButton={deletingGroupId !== deleteConfirmationGroup.group_id}
            closeLabel={t('button.close')}
          >
            <AlertDialogHeader className='gap-3 pr-8 text-left'>
              <AlertDialogTitle className='text-base font-bold leading-[22px] text-text-primary'>
                {t('settings.appearance.people.deleteGroupQuestion')}
              </AlertDialogTitle>
              <AlertDialogDescription className='text-sm leading-5 text-text-primary'>
                {t('settings.appearance.people.deleteGroupDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className='gap-3'>
              <Button
                type='button'
                variant='outline'
                disabled={deletingGroupId === deleteConfirmationGroup.group_id}
                onClick={() => setDeleteConfirmationGroup(null)}
                data-testid='modal-cancel'
              >
                {t('button.cancel')}
              </Button>
              <Button
                type='button'
                variant='destructive'
                disabled={deletingGroupId === deleteConfirmationGroup.group_id}
                loading={deletingGroupId === deleteConfirmationGroup.group_id}
                onClick={() => void handleDeleteGroup(deleteConfirmationGroup)}
                data-testid='people-delete-group-confirm'
              >
                {deletingGroupId === deleteConfirmationGroup.group_id && <Progress variant='inherit' />}
                {t('button.delete')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
  onDeleteRequested: () => void;
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
        className='rounded-300 bg-fill-content px-2 py-1 focus-within:ring-1 focus-within:ring-border-theme-thick'
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
                className='flex h-6 w-6 items-center justify-center rounded-300 text-icon-secondary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick disabled:opacity-50'
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveMember(member);
                }}
                disabled={disabled}
                aria-label={removeMemberLabel}
              >
                <CloseIcon aria-hidden='true' className='h-4 w-4' />
              </button>
            </div>
          );
        })}
        <input
          id='create-group-member-search-input'
          ref={inputRef}
          name='workspace-group-member-search'
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
          aria-label={searchPlaceholder}
          autoComplete='off'
          className='h-10 w-full bg-transparent px-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed'
          data-testid='create-group-member-search-input'
        />
      </div>

      {hasSearch && (
        <div
          className='mt-2 max-h-[240px] overflow-y-auto overscroll-contain rounded-400 border border-border-primary bg-surface-primary p-2 shadow-dialog'
          aria-live='polite'
        >
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
                  className='flex w-full items-center gap-3 rounded-300 px-3 py-2 text-left hover:bg-fill-content-hover focus-visible:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick disabled:cursor-not-allowed disabled:opacity-50'
                  onClick={() => onAddMember(member)}
                  disabled={disabled || !uid}
                  title={!uid ? unavailableTitle : undefined}
                  data-testid='create-group-member-search-result'
                >
                  <Avatar size='md'>
                    <AvatarImage src={member.avatar_url} alt={displayName} />
                    <AvatarFallback name={displayName}>{fallbackInitial(displayName)}</AvatarFallback>
                  </Avatar>
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-semibold text-text-primary'>{displayName}</div>
                    {showEmail && <div className='truncate text-xs text-text-secondary'>{member.email}</div>}
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
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !creating) onClose();
      }}
    >
      <DialogContent
        size='lg'
        closeLabel={t('button.close')}
        closeButtonClassName='right-5 top-4'
        className='h-[min(620px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] overflow-hidden bg-surface-primary p-0'
        data-testid='create-group-modal'
        aria-busy={creating}
        onEscapeKeyDown={(event) => {
          if (creating) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (creating) event.preventDefault();
        }}
      >
        <div className='flex h-full min-h-0 flex-col'>
          <div className='h-12 shrink-0' aria-hidden='true' />
          <div className='appflowy-scroller min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pb-7 pt-3'>
            <div className='flex flex-col items-center text-center'>
              <WorkspaceGroupIcon variant='hero' />
              <DialogHeader className='mb-0 mt-4 gap-2 text-center'>
                <DialogTitle className='text-2xl font-semibold leading-8 text-text-primary'>
                  {t('settings.appearance.people.createNewGroup')}
                </DialogTitle>
                <DialogDescription className='text-base leading-[22px] text-text-secondary'>
                  {t('settings.appearance.people.createGroupDescription')}
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className='mt-7 flex flex-col gap-5'>
              <section className='flex flex-col gap-2'>
                <label htmlFor='people-create-group-name-input' className='text-sm font-medium text-text-primary'>
                  {t('settings.appearance.people.iconAndName')}
                </label>
                <div className='flex items-center gap-2'>
                  <WorkspaceGroupIcon variant='name' />
                  <Input
                    id='people-create-group-name-input'
                    name='workspace-group-name'
                    size='md'
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
                  <Button
                    type='button'
                    size='lg'
                    aria-label={t('settings.appearance.people.createGroupAction')}
                    disabled={!groupName.trim() || creating}
                    loading={creating}
                    onClick={() => void handleCreateGroup()}
                    data-testid='people-create-group-submit'
                    className='h-12 w-[120px] text-base font-semibold focus-visible:ring-1 focus-visible:ring-border-theme-thick'
                  >
                    {creating ? <Progress variant='inherit' /> : t('settings.appearance.people.createGroupAction')}
                  </Button>
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupDetailModal({
  open,
  workspaceId,
  group,
  workspaceMembers,
  onClose,
  onGroupChanged,
  onDeleteRequested,
}: GroupDetailModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<GroupDetailTab>('general');
  const [groupMembers, setGroupMembers] = useState<WorkspaceGroupMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingGroupMembers, setLoadingGroupMembers] = useState(false);
  const [addingUid, setAddingUid] = useState<string | null>(null);
  const [removingUid, setRemovingUid] = useState<string | null>(null);

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

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        size='lg'
        closeLabel={t('button.close')}
        closeButtonClassName='right-5 top-5'
        className='h-[min(560px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] overflow-hidden bg-surface-primary p-0'
        data-testid='group-detail-modal'
      >
        <div className='flex h-full min-h-0 flex-col p-5'>
          <div className='relative flex h-8 shrink-0 items-center justify-center'>
            <DialogTitle className='text-base font-semibold text-text-primary'>
              {t('settings.appearance.people.manageGroup')}
            </DialogTitle>
          </div>
          <DialogDescription className='sr-only'>{groupMemberCountLabel(displayedMemberCount, t)}</DialogDescription>

          <div className='mt-5 flex items-start gap-4 px-1'>
            <WorkspaceGroupIcon variant='detail' />
            <div className='min-w-0 pt-1'>
              <div className='truncate text-2xl font-semibold leading-8 text-text-primary'>{group.name}</div>
              <div className='mt-1 text-sm text-text-secondary'>{groupMemberCountLabel(displayedMemberCount, t)}</div>
            </div>
          </div>

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as GroupDetailTab)}
            className='mt-5 min-h-0 flex-1 gap-4'
          >
            <TabsList className='gap-1'>
              <TabsTrigger
                value='general'
                className='h-8 min-w-0 items-center rounded-300 px-3 py-1.5 text-sm font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick data-[state=active]:bg-fill-content-hover data-[state=active]:text-text-primary data-[state=active]:after:hidden'
              >
                {t('settings.appearance.people.generalTab')}
              </TabsTrigger>
              <TabsTrigger
                value='members'
                className='h-8 min-w-0 items-center rounded-300 px-3 py-1.5 text-sm font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick data-[state=active]:bg-fill-content-hover data-[state=active]:text-text-primary data-[state=active]:after:hidden'
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
                  <div className='mt-1 text-sm leading-5 text-text-secondary'>
                    {t('settings.appearance.people.deleteGroupDescription')}
                  </div>
                </div>
                <Button
                  type='button'
                  variant='destructive-outline'
                  data-testid='group-detail-delete-button'
                  onClick={onDeleteRequested}
                  className='px-4 focus-visible:ring-1 focus-visible:ring-border-error-thick'
                >
                  <DeleteIcon aria-hidden='true' className='h-4 w-4' />
                  {t('settings.appearance.people.deleteGroup')}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value='members' className='min-h-0 flex-1 outline-none'>
              <div className='flex h-full min-h-0 flex-col gap-3'>
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
                  noResultsLabel={t('settings.appearance.people.noWorkspaceMembersToAdd')}
                  formatRole={(role) => roleLabel(role, t)}
                  inputDisabled={loadingGroupMembers}
                  addButtonDisabled={loadingGroupMembers || Boolean(addingUid) || !selectedAddableMember}
                  addingUid={addingUid}
                  maxResults={2}
                  compact
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

                <div className='appflowy-scroller min-h-0 flex-1 overflow-y-auto overscroll-contain'>
                  {loadingGroupMembers && groupMembers.length === 0 ? (
                    <div className='py-6 text-center text-sm text-text-secondary'>
                      <Progress />
                    </div>
                  ) : groupMembers.length === 0 ? (
                    <div className='py-6 text-center text-sm text-text-secondary'>
                      {t('settings.appearance.people.noGroupMembers')}
                    </div>
                  ) : (
                    <div className='divide-y divide-border-primary'>
                      {groupMembers.map((member) => {
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
                            className='flex items-center justify-between gap-3 py-3 text-sm'
                          >
                            <div className='flex min-w-0 items-center gap-3'>
                              <Avatar size='md'>
                                <AvatarImage src={workspaceMember?.avatar_url} alt={displayName} />
                                <AvatarFallback name={displayName}>{fallbackInitial(displayName)}</AvatarFallback>
                              </Avatar>
                              <div className='flex min-w-0 flex-col'>
                                <span className='truncate font-medium text-text-primary'>{displayName}</span>
                                {email && (
                                  <span className='truncate text-xs leading-[18px] text-text-secondary'>{email}</span>
                                )}
                              </div>
                            </div>
                            <Button
                              type='button'
                              size='sm'
                              variant='ghost'
                              className='text-text-action hover:text-text-action-hover focus-visible:ring-1 focus-visible:ring-border-theme-thick'
                              disabled={removingUid === member.uid}
                              loading={removingUid === member.uid}
                              onClick={() => void handleRemoveMember(member)}
                            >
                              {t('button.remove')}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MembersPanel;
