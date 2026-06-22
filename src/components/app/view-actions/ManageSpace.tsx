import type { TFunction } from 'i18next';
import { ChevronDown, Globe2, LockKeyhole, Shield, UserPlus, Users } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { WorkspaceService } from '@/application/services/domains';
import {
  AccessLevel,
  Role,
  SpaceInvitePolicy,
  SpaceMember,
  SpaceMemberRole,
  SpacePermission,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
  WorkspaceMember,
} from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { useAppOperations, useAppView, useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import SpaceIconButton from '@/components/app/view-actions/SpaceIconButton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/utils/errors';

type ManageSpaceTab = 'general' | 'members';

const ACCESS_OPTIONS = [
  AccessLevel.ReadOnly,
  AccessLevel.ReadAndComment,
  AccessLevel.ReadAndWrite,
  AccessLevel.FullAccess,
];

const MUTABLE_MEMBER_SOURCES = new Set(['manual']);
const MODAL_WIDTH = 680;
const CONTENT_WIDTH = 640;
const MEMBER_GRID_COLUMNS = 'minmax(0, 1fr) 220px';

function defaultPermissionSettings(isPrivate: boolean): SpacePermissionSettings {
  return {
    visibility: isPrivate ? SpaceVisibility.Private : SpaceVisibility.Open,
    owner_access_level: AccessLevel.FullAccess,
    member_default_access_level: AccessLevel.ReadAndWrite,
    everyone_else_access_level: isPrivate ? null : AccessLevel.ReadOnly,
    invite_policy: SpaceInvitePolicy.OwnersOnly,
    sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
    invite_link_enabled: false,
    security: {
      disable_guests: false,
      disable_public_links: false,
      disable_export: false,
    },
  };
}

function normalizePermissionSettings(
  permission: SpacePermissionSettings,
  isPrivate: boolean
): SpacePermissionSettings {
  const fallback = defaultPermissionSettings(isPrivate);

  return {
    visibility: permission.visibility ?? fallback.visibility,
    owner_access_level: permission.owner_access_level ?? fallback.owner_access_level,
    member_default_access_level:
      permission.member_default_access_level ?? fallback.member_default_access_level,
    everyone_else_access_level:
      permission.everyone_else_access_level === undefined
        ? fallback.everyone_else_access_level
        : permission.everyone_else_access_level,
    invite_policy: permission.invite_policy ?? fallback.invite_policy,
    sidebar_edit_policy: permission.sidebar_edit_policy ?? fallback.sidebar_edit_policy,
    invite_link_enabled: permission.invite_link_enabled ?? fallback.invite_link_enabled,
    security: {
      ...fallback.security,
      ...permission.security,
    },
  };
}

function legacyPermissionFromVisibility(visibility: SpaceVisibility): SpacePermission {
  return visibility === SpaceVisibility.Private ? SpacePermission.Private : SpacePermission.Public;
}

function accessLabel(accessLevel: AccessLevel | null | undefined, t: TFunction): string {
  switch (accessLevel) {
    case AccessLevel.FullAccess:
      return t('shareAction.fullAccess');
    case AccessLevel.ReadAndWrite:
      return t('shareAction.canEdit');
    case AccessLevel.ReadAndComment:
      return t('shareAction.canViewAndComment');
    case AccessLevel.ReadOnly:
      return t('shareAction.canView');
    default:
      return t('space.permissionManager.noAccess');
  }
}

function roleLabel(role: SpaceMemberRole, t: TFunction): string {
  return role === SpaceMemberRole.Owner
    ? t('space.permissionManager.owner')
    : t('space.permissionManager.member');
}

function visibilityLabel(visibility: SpaceVisibility, t: TFunction): string {
  switch (visibility) {
    case SpaceVisibility.Default:
      return t('space.permissionManager.default');
    case SpaceVisibility.Closed:
      return t('space.permissionManager.closed');
    case SpaceVisibility.Private:
      return t('space.privatePermission');
    case SpaceVisibility.Open:
    default:
      return t('space.permissionManager.open');
  }
}

function visibilityDescription(visibility: SpaceVisibility, t: TFunction): string {
  switch (visibility) {
    case SpaceVisibility.Default:
      return t('space.permissionManager.defaultVisibilityDescription');
    case SpaceVisibility.Closed:
      return t('space.permissionManager.closedVisibilityDescription');
    case SpaceVisibility.Private:
      return t('space.permissionManager.privateVisibilityDescription');
    case SpaceVisibility.Open:
    default:
      return t('space.permissionManager.openVisibilityDescription');
  }
}

function getWorkspaceMemberUid(member: WorkspaceMember): string | null {
  const rawUid = (member as WorkspaceMember & { uid?: unknown }).uid;

  if (typeof rawUid === 'number' && Number.isFinite(rawUid)) return String(rawUid);
  if (typeof rawUid === 'string') {
    const trimmed = rawUid.trim();

    return trimmed ? trimmed : null;
  }

  return null;
}

function displayNameForMember(member: SpaceMember, t: TFunction): string {
  return member.name || member.email || t('space.permissionManager.userFallbackName', { uid: member.uid });
}

function memberInitial(member: SpaceMember, t: TFunction): string {
  return displayNameForMember(member, t).slice(0, 1).toUpperCase();
}

function matchesMemberSearch(member: SpaceMember, search: string, t: TFunction): boolean {
  if (!search) return true;
  const normalized = search.trim().toLowerCase();

  return (
    displayNameForMember(member, t).toLowerCase().includes(normalized) ||
    (member.email || '').toLowerCase().includes(normalized)
  );
}

function AccessDropdown({
  value,
  disabled,
  includeNoAccess = false,
  onChange,
}: {
  value: AccessLevel | null | undefined;
  disabled?: boolean;
  includeNoAccess?: boolean;
  onChange: (value: AccessLevel | null) => void;
}) {
  const { t } = useTranslation();
  const options = includeNoAccess ? [null, ...ACCESS_OPTIONS] : ACCESS_OPTIONS;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={disabled}
          className='min-w-[120px] justify-end px-2 text-text-primary'
        >
          {accessLabel(value, t)}
          <ChevronDown className='h-4 w-4 text-icon-tertiary' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {options.map((option) => (
          <DropdownMenuItem
            key={option ?? 'none'}
            onSelect={() => onChange(option)}
            className='justify-between'
          >
            {accessLabel(option, t)}
            {option === (value ?? null) && <DropdownMenuItemTick />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VisibilityDropdown({
  value,
  disabled,
  onChange,
}: {
  value: SpaceVisibility;
  disabled?: boolean;
  onChange: (value: SpaceVisibility) => void;
}) {
  const { t } = useTranslation();
  const options = [
    SpaceVisibility.Open,
    SpaceVisibility.Closed,
    SpaceVisibility.Private,
    SpaceVisibility.Default,
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className='min-w-[140px] justify-between'
        >
          {visibilityLabel(value, t)}
          <ChevronDown className='h-4 w-4 text-icon-tertiary' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[320px]'>
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onChange(option)}
            className='items-start justify-between gap-4'
          >
            <div className='flex flex-col gap-0.5'>
              <span>{visibilityLabel(option, t)}</span>
              <span className='text-xs text-text-secondary'>{visibilityDescription(option, t)}</span>
            </div>
            {option === value && <DropdownMenuItemTick />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RoleDropdown({
  value,
  disabled,
  onChange,
  onRemove,
  canRemove,
}: {
  value: SpaceMemberRole;
  disabled?: boolean;
  onChange: (value: SpaceMemberRole) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={disabled}
          className='min-w-[210px] justify-end px-2 text-text-primary'
        >
          {roleLabel(value, t)}
          <ChevronDown className='h-4 w-4 text-icon-tertiary' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[320px]'>
        <DropdownMenuItem
          onSelect={() => onChange(SpaceMemberRole.Owner)}
          className='items-start justify-between gap-4'
        >
          <div className='flex flex-col gap-1'>
            <span>{t('space.permissionManager.owner')}</span>
            <span className='text-xs leading-5 text-text-secondary'>
              {t('space.permissionManager.ownerRoleDescription')}
            </span>
          </div>
          {value === SpaceMemberRole.Owner && <DropdownMenuItemTick />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onChange(SpaceMemberRole.Member)}
          className='items-start justify-between gap-4'
        >
          <div className='flex flex-col gap-1'>
            <span>{t('space.permissionManager.member')}</span>
            <span className='text-xs leading-5 text-text-secondary'>
              {t('space.permissionManager.memberRoleDescription')}
            </span>
          </div>
          {value === SpaceMemberRole.Member && <DropdownMenuItemTick />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant='destructive'
          disabled={!canRemove}
          onSelect={onRemove}
        >
          {t('space.permissionManager.remove')}
        </DropdownMenuItem>
        {!canRemove && (
          <div className='px-2 pb-1 text-xs text-text-tertiary'>
            {t('space.permissionManager.inheritedAccessManagedFromGeneral')}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ManageSpace({ open, onClose, viewId }: { open: boolean; onClose: () => void; viewId: string }) {
  const view = useAppView(viewId);
  const workspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const { t } = useTranslation();
  const currentWorkspaceName =
    userWorkspaceInfo?.selectedWorkspace?.name || t('space.permissionManager.workspaceFallbackName');
  const [tab, setTab] = useState<ManageSpaceTab>('general');
  const [spaceName, setSpaceName] = useState<string>(view?.name || '');
  const [spaceIcon, setSpaceIcon] = useState<string>(view?.extra?.space_icon || '');
  const [spaceIconColor, setSpaceIconColor] = useState<string>(view?.extra?.space_icon_color || '');
  const [permissionSettings, setPermissionSettings] = useState<SpacePermissionSettings>(
    defaultPermissionSettings(Boolean(view?.is_private))
  );
  const [canManageSpace, setCanManageSpace] = useState(true);
  const [canManageMembers, setCanManageMembers] = useState(true);
  const [canInviteMembers, setCanInviteMembers] = useState(true);
  const [spaceMembers, setSpaceMembers] = useState<SpaceMember[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutatingMemberUid, setMutatingMemberUid] = useState<string | null>(null);
  const [addingUid, setAddingUid] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [showAddMembers, setShowAddMembers] = useState(false);
  const { updateSpace } = useAppOperations();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!view || !open) return;
    setTab('general');
    setSpaceName(view.name || '');
    setSpaceIcon(view.extra?.space_icon || '');
    setSpaceIconColor(view.extra?.space_icon_color || '');
    setPermissionSettings(defaultPermissionSettings(Boolean(view.is_private)));
    setMemberSearch('');
    setAddSearch('');
    setShowAddMembers(false);
    inputRef.current = null;
  }, [open, view, viewId]);

  const refreshSpaceMembers = useCallback(async () => {
    if (!workspaceId || !viewId) return;
    setLoadingMembers(true);
    try {
      const result = await WorkspaceService.getSpaceMembers(workspaceId, viewId);

      setSpaceMembers(result.members || []);
    } catch (error) {
      toast.error(getErrorMessage(error, t('space.permissionManager.loadSpaceMembersFailed')));
    } finally {
      setLoadingMembers(false);
    }
  }, [t, workspaceId, viewId]);

  useEffect(() => {
    if (!open || !workspaceId || !view) return;
    let cancelled = false;

    setLoadingSettings(true);
    void (async () => {
      try {
        const [permission, workspaceMemberList] = await Promise.all([
          WorkspaceService.getSpacePermission(workspaceId, viewId).catch(() => null),
          WorkspaceService.getMembers(workspaceId),
        ]);

        if (cancelled) return;
        if (permission) {
          setPermissionSettings(normalizePermissionSettings(permission.permission, Boolean(view.is_private)));
          setCanManageSpace(permission.can_manage_space);
          setCanManageMembers(permission.can_manage_members);
          setCanInviteMembers(permission.can_invite_members);
        }

        setWorkspaceMembers(workspaceMemberList);
        if (permission?.can_manage_members ?? true) {
          await refreshSpaceMembers();
        }
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error, t('space.permissionManager.loadSpaceSettingsFailed')));
      } finally {
        if (!cancelled) setLoadingSettings(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, refreshSpaceMembers, t, view, viewId, workspaceId]);

  const visibleSpaceMembers = useMemo(
    () => spaceMembers.filter((member) => matchesMemberSearch(member, memberSearch, t)),
    [memberSearch, spaceMembers, t]
  );

  const explicitMemberUids = useMemo(
    () => new Set(spaceMembers.map((member) => member.uid)),
    [spaceMembers]
  );

  const addableWorkspaceMembers = useMemo(() => {
    const normalizedSearch = addSearch.trim().toLowerCase();

    return workspaceMembers.filter((member) => {
      const uid = getWorkspaceMemberUid(member);
      const matchesSearch =
        !normalizedSearch ||
        member.name.toLowerCase().includes(normalizedSearch) ||
        member.email.toLowerCase().includes(normalizedSearch);

      return matchesSearch && (!uid || !explicitMemberUids.has(uid));
    });
  }, [addSearch, explicitMemberUids, workspaceMembers]);

  const updatePermission = useCallback((patch: Partial<SpacePermissionSettings>) => {
    setPermissionSettings((current) => ({
      ...current,
      ...patch,
      security: {
        ...current.security,
        ...(patch.security ?? {}),
      },
    }));
  }, []);

  const handleVisibilityChange = useCallback(
    (visibility: SpaceVisibility) => {
      const nextPatch: Partial<SpacePermissionSettings> = { visibility };

      if (visibility === SpaceVisibility.Private) {
        nextPatch.everyone_else_access_level = null;
      } else if (permissionSettings.everyone_else_access_level === null) {
        nextPatch.everyone_else_access_level = AccessLevel.ReadOnly;
      }

      updatePermission(nextPatch);
    },
    [permissionSettings.everyone_else_access_level, updatePermission]
  );

  const handleSave = useCallback(async () => {
    if (!updateSpace || !workspaceId) return;
    const trimmedName = spaceName.trim();

    if (!trimmedName) {
      toast.error(t('space.spaceNameCannotBeEmpty'));
      return;
    }

    setSaving(true);
    try {
      await updateSpace({
        view_id: viewId,
        name: trimmedName,
        space_icon: spaceIcon,
        space_icon_color: spaceIconColor,
        space_permission: legacyPermissionFromVisibility(permissionSettings.visibility),
      });
      const response = await WorkspaceService.updateSpacePermission(
        workspaceId,
        viewId,
        permissionSettings
      );

      setPermissionSettings(normalizePermissionSettings(response.permission, Boolean(view?.is_private)));
      toast.success(t('space.success.updateSpace'));
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, t('space.error.updateSpace')));
    } finally {
      setSaving(false);
    }
  }, [
    onClose,
    permissionSettings,
    spaceIcon,
    spaceIconColor,
    spaceName,
    t,
    updateSpace,
    view?.is_private,
    viewId,
    workspaceId,
  ]);

  const handleAddMember = useCallback(
    async (workspaceMember: WorkspaceMember) => {
      const uid = getWorkspaceMemberUid(workspaceMember);

      if (!uid || !canInviteMembers || !workspaceId) return;
      setAddingUid(uid);
      try {
        await WorkspaceService.addSpaceMember(workspaceId, viewId, {
          uid,
          role: SpaceMemberRole.Member,
          access_level: permissionSettings.member_default_access_level,
        });
        await refreshSpaceMembers();
        setShowAddMembers(false);
        setAddSearch('');
        toast.success(t('space.permissionManager.addSpaceMemberSuccess'));
      } catch (error) {
        toast.error(getErrorMessage(error, t('space.permissionManager.addSpaceMemberFailed')));
      } finally {
        setAddingUid(null);
      }
    },
    [
      canInviteMembers,
      permissionSettings.member_default_access_level,
      refreshSpaceMembers,
      t,
      viewId,
      workspaceId,
    ]
  );

  const handleUpdateMemberRole = useCallback(
    async (member: SpaceMember, role: SpaceMemberRole) => {
      if (member.role === role || !canManageMembers || !workspaceId) return;
      const accessLevel =
        role === SpaceMemberRole.Owner
          ? AccessLevel.FullAccess
          : permissionSettings.member_default_access_level;

      setMutatingMemberUid(member.uid);
      try {
        if (MUTABLE_MEMBER_SOURCES.has(member.source)) {
          await WorkspaceService.updateSpaceMember(workspaceId, viewId, member.uid, {
            role,
            access_level: accessLevel,
          });
        } else {
          await WorkspaceService.addSpaceMember(workspaceId, viewId, {
            uid: member.uid,
            role,
            access_level: accessLevel,
          });
        }

        await refreshSpaceMembers();
      } catch (error) {
        toast.error(getErrorMessage(error, t('space.permissionManager.updateSpaceMemberFailed')));
      } finally {
        setMutatingMemberUid(null);
      }
    },
    [
      canManageMembers,
      permissionSettings.member_default_access_level,
      refreshSpaceMembers,
      t,
      viewId,
      workspaceId,
    ]
  );

  const handleRemoveMember = useCallback(
    async (member: SpaceMember) => {
      if (!canManageMembers || !workspaceId) return;
      setMutatingMemberUid(member.uid);
      try {
        await WorkspaceService.removeSpaceMember(workspaceId, viewId, member.uid);
        await refreshSpaceMembers();
        toast.success(t('space.permissionManager.removeSpaceMemberSuccess'));
      } catch (error) {
        toast.error(getErrorMessage(error, t('space.permissionManager.removeSpaceMemberFailed')));
      } finally {
        setMutatingMemberUid(null);
      }
    },
    [canManageMembers, refreshSpaceMembers, t, viewId, workspaceId]
  );

  if (!view) return null;

  const settingsDisabled = loadingSettings || !canManageSpace;
  const membersDisabled = loadingMembers || !canManageMembers;

  return (
    <NormalModal
      keepMounted={false}
      okText={t('button.save')}
      cancelText={t('button.cancel')}
      open={open}
      onClose={onClose}
      title={t('space.manage')}
      classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[6%]' }}
      okLoading={saving}
      onOk={handleSave}
      overflowHidden
      PaperProps={{
        style: {
          width: MODAL_WIDTH,
          maxWidth: '92vw',
        },
      }}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ManageSpaceTab)}
        className='min-h-0 max-w-full'
        style={{ width: CONTENT_WIDTH }}
      >
        <TabsList className='border-b border-border-primary'>
          <TabsTrigger value='general'>{t('space.permissionManager.generalTab')}</TabsTrigger>
          <TabsTrigger value='members'>{t('space.permissionManager.membersTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value='general' className='min-h-0'>
          <div ref={setContainer} className='appflowy-scroller max-h-[64vh] overflow-y-auto pr-1'>
            <div className='flex flex-col gap-6 py-2'>
              <div className='flex flex-col gap-2'>
                <div className='text-sm font-medium text-text-secondary'>{t('space.spaceName')}</div>
                <div className='flex items-center gap-3'>
                  {container && (
                    <SpaceIconButton
                      container={container}
                      spaceIcon={spaceIcon}
                      spaceIconColor={spaceIconColor}
                      spaceName={spaceName}
                      onSelectSpaceIcon={setSpaceIcon}
                      onSelectSpaceIconColor={setSpaceIconColor}
                    />
                  )}

                  <Input
                    value={spaceName}
                    autoFocus
                    ref={(input) => {
                      if (!input) return;
                      if (!inputRef.current) {
                        setTimeout(() => {
                          input.setSelectionRange(0, input.value.length);
                        }, 100);
                        inputRef.current = input;
                      }
                    }}
                    disabled={settingsDisabled}
                    onChange={(e) => setSpaceName(e.target.value)}
                    size='md'
                    placeholder={t('space.spaceNamePlaceholder')}
                    className='flex-1'
                  />
                </div>
              </div>

              <section className='flex flex-col gap-3'>
                <div className='flex items-center justify-between gap-3'>
                  <div className='flex min-w-0 flex-col gap-1'>
                    <div className='text-sm font-semibold text-text-primary'>
                      {t('space.permissionManager.spaceAccess')}
                    </div>
                    <div className='text-xs text-text-secondary'>
                      {t('space.permissionManager.spaceAccessDescription')}
                    </div>
                  </div>
                  {loadingSettings && <Progress />}
                </div>

                <div className='rounded-400 border border-border-primary'>
                  <div className='flex items-center gap-3 border-b border-border-primary px-4 py-3'>
                    <div className='flex h-8 w-8 items-center justify-center rounded-full bg-fill-content-hover'>
                      {permissionSettings.visibility === SpaceVisibility.Private ? (
                        <LockKeyhole className='h-5 w-5 text-icon-primary' />
                      ) : (
                        <Globe2 className='h-5 w-5 text-icon-primary' />
                      )}
                    </div>
                    <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                      <div className='font-medium text-text-primary'>{t('space.permissionManager.default')}</div>
                      <div className='truncate text-sm text-text-secondary'>
                        {visibilityDescription(permissionSettings.visibility, t)}
                      </div>
                    </div>
                    <VisibilityDropdown
                      value={permissionSettings.visibility}
                      disabled={settingsDisabled}
                      onChange={handleVisibilityChange}
                    />
                  </div>

                  <PermissionPrincipalRow
                    icon={<Shield className='h-5 w-5 text-icon-primary' />}
                    title={t('space.permissionManager.owners')}
                    description={t('space.permissionManager.ownersDescription')}
                    trailing={<span className='text-sm text-text-secondary'>{t('shareAction.fullAccess')}</span>}
                  />

                  <PermissionPrincipalRow
                    icon={<Users className='h-5 w-5 text-icon-primary' />}
                    title={t('space.permissionManager.members')}
                    description={t('space.permissionManager.membersDescription')}
                    trailing={
                      <AccessDropdown
                        value={permissionSettings.member_default_access_level}
                        disabled={settingsDisabled}
                        onChange={(value) => {
                          if (value !== null) updatePermission({ member_default_access_level: value });
                        }}
                      />
                    }
                  />

                  <PermissionPrincipalRow
                    icon={<Globe2 className='h-5 w-5 text-icon-primary' />}
                    title={t('space.permissionManager.everyoneAtWorkspace', { workspaceName: currentWorkspaceName })}
                    description={t('space.permissionManager.everyoneDescription')}
                    trailing={
                      <AccessDropdown
                        value={permissionSettings.everyone_else_access_level}
                        disabled={settingsDisabled || permissionSettings.visibility === SpaceVisibility.Private}
                        includeNoAccess
                        onChange={(value) => updatePermission({ everyone_else_access_level: value })}
                      />
                    }
                    last
                  />
                </div>
              </section>
            </div>
          </div>
        </TabsContent>

        <TabsContent value='members' className='min-h-0'>
          <div className='appflowy-scroller max-h-[64vh] overflow-y-auto py-2 pr-1'>
            <div className='flex flex-col gap-4'>
              <div className='flex items-center gap-2'>
                <SearchInput
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder={t('space.permissionManager.searchMembers')}
                  className='h-10 flex-1'
                />
                <Button
                  type='button'
                  size='lg'
                  disabled={!canInviteMembers}
                  onClick={() => setShowAddMembers((value) => !value)}
                >
                  <UserPlus className='h-5 w-5' />
                  {t('space.permissionManager.addMembers')}
                </Button>
              </div>

              {showAddMembers && (
                <div className='flex flex-col gap-2 rounded-400 border border-border-primary p-3'>
                  <SearchInput
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder={t('space.permissionManager.searchWorkspaceMembers')}
                    className='h-9'
                  />
                  <div className='max-h-[220px] overflow-y-auto'>
                    {addableWorkspaceMembers.length === 0 ? (
                      <div className='py-4 text-center text-sm text-text-secondary'>
                        {t('space.permissionManager.noWorkspaceMembersToAdd')}
                      </div>
                    ) : (
                      addableWorkspaceMembers.slice(0, 12).map((member) => {
                        const uid = getWorkspaceMemberUid(member);
                        const unavailable = !uid;

                        return (
                          <div
                            key={`${member.email}-${uid ?? 'missing-uid'}`}
                            className='flex items-center gap-3 rounded-300 px-2 py-2 hover:bg-fill-content-hover'
                          >
                            <Avatar size='md'>
                              <AvatarImage src={member.avatar_url} alt={member.name} />
                              <AvatarFallback name={member.name}>
                                {member.name.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className='min-w-0 flex-1'>
                              <div className='truncate text-sm font-medium text-text-primary'>
                                {member.name}
                                {member.role === Role.Owner && (
                                  <span className='ml-2 rounded-200 bg-fill-content-hover px-1.5 py-0.5 text-xs text-text-secondary'>
                                    {t('space.permissionManager.workspaceOwner')}
                                  </span>
                                )}
                              </div>
                              <div className='truncate text-xs text-text-secondary'>{member.email}</div>
                            </div>
                            <Button
                              type='button'
                              size='sm'
                              variant='outline'
                              disabled={unavailable || addingUid === uid}
                              loading={addingUid === uid}
                              onClick={() => void handleAddMember(member)}
                              title={unavailable ? t('space.permissionManager.workspaceMemberUidUnavailable') : undefined}
                            >
                              {t('space.permissionManager.add')}
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {workspaceMembers.some((member) => !getWorkspaceMemberUid(member)) && (
                    <div className='text-xs text-text-tertiary'>
                      {t('space.permissionManager.workspaceMemberUidUnavailableHint')}
                    </div>
                  )}
                </div>
              )}

              <div
                className='grid items-center gap-3 border-b border-border-primary pb-2 text-sm font-medium text-text-secondary'
                style={{ gridTemplateColumns: MEMBER_GRID_COLUMNS }}
              >
                <span>{t('space.permissionManager.name')}</span>
                <span className='text-right'>{t('space.permissionManager.role')}</span>
              </div>

              {loadingMembers && spaceMembers.length === 0 ? (
                <div className='flex justify-center py-8'>
                  <Progress />
                </div>
              ) : visibleSpaceMembers.length === 0 ? (
                <div className='py-8 text-center text-sm text-text-secondary'>
                  {t('space.permissionManager.noSpaceMembersFound')}
                </div>
              ) : (
                <div className='flex flex-col'>
                  {visibleSpaceMembers.map((member) => {
                    const mutable = MUTABLE_MEMBER_SOURCES.has(member.source);

                    return (
                      <div
                        key={`${member.uid}-${member.source}`}
                        className='grid items-center gap-3 border-b border-border-primary py-3'
                        style={{ gridTemplateColumns: MEMBER_GRID_COLUMNS }}
                      >
                        <div className='flex min-w-0 items-center gap-3'>
                          <Avatar size='md'>
                            <AvatarFallback name={displayNameForMember(member, t)}>
                              {memberInitial(member, t)}
                            </AvatarFallback>
                          </Avatar>
                          <div className='min-w-0'>
                            <div className='truncate font-medium text-text-primary'>{displayNameForMember(member, t)}</div>
                            <div className='truncate text-sm text-text-secondary'>{member.email || ''}</div>
                          </div>
                        </div>

                        <div className='flex justify-end'>
                          <RoleDropdown
                            value={member.role}
                            disabled={membersDisabled || mutatingMemberUid === member.uid}
                            canRemove={mutable && canManageMembers}
                            onChange={(role) => void handleUpdateMemberRole(member, role)}
                            onRemove={() => void handleRemoveMember(member)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </NormalModal>
  );
}

function PermissionPrincipalRow({
  icon,
  title,
  description,
  trailing,
  last,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  trailing: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3',
        !last && 'border-b border-border-primary'
      )}
    >
      <div className='flex h-8 w-8 items-center justify-center rounded-300 bg-fill-content-hover'>
        {icon}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='font-medium text-text-primary'>{title}</div>
        <div className='truncate text-sm text-text-secondary'>{description}</div>
      </div>
      {trailing}
    </div>
  );
}

export default ManageSpace;
