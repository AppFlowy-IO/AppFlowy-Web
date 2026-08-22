import { ChevronDown, Globe2, LockKeyhole, Settings2, Shield, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import {
  AccessLevel,
  legacySpacePermission,
  SpaceMember,
  SpaceMemberRole,
  SpacePermission,
  SpacePermissionSettings,
  SpaceVisibility,
  WorkspaceGroupSpacePermission,
  WorkspaceMember,
} from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { useAppOperations, useAppView, useCurrentWorkspaceId, useEventEmitter } from '@/components/app/app.hooks';
import {
  getWorkspaceMemberUid,
  useAddableWorkspaceMembers,
  WorkspaceMemberInlineSearch,
} from '@/components/app/share/WorkspaceMemberInlineSearch';
import SpaceIconButton from '@/components/app/view-actions/SpaceIconButton';
import {
  defaultSpacePermissionSettings,
  isPrivateSpaceVisibility,
  LEGACY_SPACE_VISIBILITIES,
  SELECTABLE_SPACE_VISIBILITIES,
  spaceVisibilityDescription,
  spaceVisibilityLabel,
} from '@/components/app/view-actions/spaceVisibilityOptions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getErrorMessage, isUnsupportedRouteError } from '@/utils/errors';
import { Log } from '@/utils/log';

import type { TFunction } from 'i18next';
import type { KeyboardEvent } from 'react';

type ManageSpaceTab = 'general' | 'members';

const ACCESS_OPTIONS = [
  AccessLevel.ReadOnly,
  AccessLevel.ReadAndComment,
  AccessLevel.ReadAndWrite,
  AccessLevel.FullAccess,
];

const INHERITED_MEMBER_SOURCES = new Set(['workspace_default', 'page_share']);
const LAST_EXPLICIT_OWNER_ERROR = 'space must keep at least one explicit owner';
const MODAL_WIDTH = 680;
const CONTENT_WIDTH = 640;
const MEMBER_GRID_COLUMNS = 'minmax(0, 1fr) 220px';

// The outline only carries the binary `is_private` marker, so a space whose
// structured settings have not loaded yet is seeded as Public or Private.
function defaultPermissionSettings(isPrivate: boolean): SpacePermissionSettings {
  return defaultSpacePermissionSettings(isPrivate ? SpaceVisibility.Private : SpaceVisibility.Public);
}

function normalizePermissionSettings(permission: SpacePermissionSettings, isPrivate: boolean): SpacePermissionSettings {
  const fallback = defaultPermissionSettings(isPrivate);

  return {
    // Keep whatever visibility the server returned, including values this
    // client does not know yet, so a save never rewrites it behind the user.
    visibility: permission.visibility ?? fallback.visibility,
    owner_access_level: permission.owner_access_level ?? fallback.owner_access_level,
    member_default_access_level: permission.member_default_access_level ?? fallback.member_default_access_level,
    invite_policy: permission.invite_policy ?? fallback.invite_policy,
    sidebar_edit_policy: permission.sidebar_edit_policy ?? fallback.sidebar_edit_policy,
    invite_link_enabled: permission.invite_link_enabled ?? fallback.invite_link_enabled,
    security: {
      ...fallback.security,
      ...permission.security,
    },
  };
}

function equalPermissionSettings(left: SpacePermissionSettings, right: SpacePermissionSettings): boolean {
  return (
    left.visibility === right.visibility &&
    left.owner_access_level === right.owner_access_level &&
    left.member_default_access_level === right.member_default_access_level &&
    left.invite_policy === right.invite_policy &&
    left.sidebar_edit_policy === right.sidebar_edit_policy &&
    left.invite_link_enabled === right.invite_link_enabled &&
    left.security.disable_guests === right.security.disable_guests &&
    left.security.disable_public_links === right.security.disable_public_links &&
    left.security.disable_export === right.security.disable_export
  );
}

function isKnownSpaceVisibility(visibility: SpaceVisibility): boolean {
  return (SELECTABLE_SPACE_VISIBILITIES as readonly SpaceVisibility[]).includes(visibility);
}

// Crossing the private/non-private boundary (Private <-> Public, Private <->
// Custom) is first applied through the binary compatibility endpoint, which
// keeps the legacy marker in step. Public <-> Custom are both non-private, and
// any transition involving a value this client does not know goes straight to
// the structured update.
function legacyVisibilityBridgeSteps(current: SpaceVisibility, requested: SpaceVisibility): readonly SpacePermission[] {
  if (!isKnownSpaceVisibility(current) || !isKnownSpaceVisibility(requested)) return [];
  if (isPrivateSpaceVisibility(current) === isPrivateSpaceVisibility(requested)) return [];

  return [legacySpacePermission(requested)];
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
  return role === SpaceMemberRole.Owner ? t('space.permissionManager.owner') : t('space.permissionManager.member');
}

function manageSpaceErrorMessage(error: unknown, fallback: string, t: TFunction): string {
  const message = getErrorMessage(error, fallback);

  return message.toLowerCase().includes(LAST_EXPLICIT_OWNER_ERROR)
    ? t('space.permissionManager.lastOwnerRequired')
    : message;
}

function displayNameForMember(member: SpaceMember, t: TFunction): string {
  return member.name || member.email || t('space.permissionManager.userFallbackName', { uid: member.uid });
}

function memberInitial(member: SpaceMember, t: TFunction): string {
  return displayNameForMember(member, t).slice(0, 1).toUpperCase();
}

function matchesMemberSearch(member: SpaceMember, normalizedSearch: string, t: TFunction): boolean {
  if (!normalizedSearch) return true;

  return (
    displayNameForMember(member, t).toLowerCase().includes(normalizedSearch) ||
    (member.email || '').toLowerCase().includes(normalizedSearch)
  );
}

function matchesGroupSearch(group: WorkspaceGroupSpacePermission, normalizedSearch: string): boolean {
  return !normalizedSearch || group.name.toLowerCase().includes(normalizedSearch);
}

function isMutableSpaceMember(member: SpaceMember): boolean {
  return !INHERITED_MEMBER_SOURCES.has(member.source);
}

function VisibilityIcon({ visibility }: { visibility: SpaceVisibility }) {
  const className = 'h-5 w-5 text-icon-primary';

  switch (visibility) {
    case SpaceVisibility.Private:
      return <LockKeyhole className={className} />;
    case SpaceVisibility.Custom:
      return <Settings2 className={className} />;
    case SpaceVisibility.Public:
    default:
      return <Globe2 className={className} />;
  }
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
          <DropdownMenuItem key={option ?? 'none'} onSelect={() => onChange(option)} className='justify-between'>
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
  options,
  disabled,
  onChange,
}: {
  value: SpaceVisibility;
  options: readonly SpaceVisibility[];
  disabled?: boolean;
  onChange: (value: SpaceVisibility) => void;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className='min-w-[140px] justify-between'
          data-testid='manage-space-visibility-trigger'
        >
          {spaceVisibilityLabel(value, t)}
          <ChevronDown className='h-4 w-4 text-icon-tertiary' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[320px]'>
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            data-testid={`manage-space-visibility-option-${option}`}
            onSelect={() => onChange(option)}
            className='items-start justify-between gap-4'
          >
            <div className='flex flex-col gap-0.5'>
              <span>{spaceVisibilityLabel(option, t)}</span>
              <span className='text-xs text-text-secondary'>{spaceVisibilityDescription(option, t)}</span>
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
  readOnly,
  onChange,
  onRemove,
  canRemove,
}: {
  value: SpaceMemberRole;
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (value: SpaceMemberRole) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useTranslation();

  if (readOnly) {
    return <span className='px-2 text-sm text-text-primary'>{roleLabel(value, t)}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={disabled}
          className='w-fit justify-end px-2 text-text-primary'
        >
          {roleLabel(value, t)}
          <ChevronDown className='h-4 w-4 text-icon-tertiary' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[320px]'>
        <DropdownMenuItem onSelect={() => onChange(SpaceMemberRole.Owner)} className='items-start justify-between gap-4'>
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
        <DropdownMenuItem variant='destructive' disabled={!canRemove} onSelect={onRemove}>
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
  const { updateSpace: updateLegacySpace } = useAppOperations();
  const workspaceId = useCurrentWorkspaceId();
  const eventEmitter = useEventEmitter();
  const { t } = useTranslation();
  const [tab, setTab] = useState<ManageSpaceTab>('general');
  const [spaceName, setSpaceName] = useState<string>(view?.name || '');
  const [spaceIcon, setSpaceIcon] = useState<string>(view?.extra?.space_icon || '');
  const [spaceIconColor, setSpaceIconColor] = useState<string>(view?.extra?.space_icon_color || '');
  const [permissionSettings, setPermissionSettings] = useState<SpacePermissionSettings>(
    defaultPermissionSettings(Boolean(view?.is_private))
  );
  const [loadedPermissionSettings, setLoadedPermissionSettings] = useState<SpacePermissionSettings | null>(null);
  const [canManageSpace, setCanManageSpace] = useState(false);
  const [canEditSidebar, setCanEditSidebar] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [canInviteMembers, setCanInviteMembers] = useState(false);
  const [spaceMembers, setSpaceMembers] = useState<SpaceMember[]>([]);
  const [spaceGroups, setSpaceGroups] = useState<WorkspaceGroupSpacePermission[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [spaceMembersLoaded, setSpaceMembersLoaded] = useState(false);
  const [permissionLoaded, setPermissionLoaded] = useState(false);
  const [permissionLoadFailed, setPermissionLoadFailed] = useState(false);
  const [legacyPermissionMode, setLegacyPermissionMode] = useState(false);
  const [permissionRefreshRevision, setPermissionRefreshRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [mutatingMemberUid, setMutatingMemberUid] = useState<string | null>(null);
  const [mutatingGroupIds, setMutatingGroupIds] = useState<Set<string>>(() => new Set());
  const [addingUid, setAddingUid] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const settingsRequestSequenceRef = useRef(0);
  const spaceRequestRef = useRef({
    generation: 0,
    memberRequestSequence: 0,
    open,
    workspaceId,
    viewId,
  });

  useEffect(() => {
    const currentRequestScope = spaceRequestRef.current;

    settingsRequestSequenceRef.current += 1;
    spaceRequestRef.current = {
      generation: currentRequestScope.generation + 1,
      memberRequestSequence: currentRequestScope.memberRequestSequence + 1,
      open,
      workspaceId,
      viewId,
    };
  }, [open, viewId, workspaceId]);

  const beginPermissionRefresh = useCallback(() => {
    setLoadingSettings(true);
    setLoadingMembers(false);
    setPermissionLoaded(false);
    setPermissionLoadFailed(false);
    setLegacyPermissionMode(false);
    setLoadedPermissionSettings(null);
    setCanManageSpace(false);
    setCanEditSidebar(false);
    setCanManageMembers(false);
    setCanInviteMembers(false);
    setSpaceMembersLoaded(false);
    setSpaceMembers([]);
    setSpaceGroups([]);
    setWorkspaceMembers([]);
  }, []);

  // Always hold the latest view without making it an effect dependency: `view`
  // is recomputed whenever the outline changes identity (realtime sync, a
  // sibling rename, expand/collapse), and we must not reset the form mid-edit.
  const viewRef = useRef(view);
  const loadedSpaceMetadataRef = useRef({
    name: view?.name || '',
    space_icon: view?.extra?.space_icon || '',
    space_icon_color: view?.extra?.space_icon_color || '',
  });

  useEffect(() => {
    viewRef.current = view;
  });

  // Seed the form only when the modal opens or the target space changes — both
  // primitives — reading the current view snapshot from the ref.
  useEffect(() => {
    if (!open) return;
    const currentView = viewRef.current;

    if (!currentView) return;
    const loadedMetadata = {
      name: currentView.name || '',
      space_icon: currentView.extra?.space_icon || '',
      space_icon_color: currentView.extra?.space_icon_color || '',
    };

    loadedSpaceMetadataRef.current = loadedMetadata;
    setTab('general');
    setSpaceName(loadedMetadata.name);
    setSpaceIcon(loadedMetadata.space_icon);
    setSpaceIconColor(loadedMetadata.space_icon_color);
    setPermissionSettings(defaultPermissionSettings(Boolean(currentView.is_private)));
    setLoadedPermissionSettings(null);
    setCanManageSpace(false);
    setCanEditSidebar(false);
    setCanManageMembers(false);
    setCanInviteMembers(false);
    setPermissionLoaded(false);
    setPermissionLoadFailed(false);
    setLegacyPermissionMode(false);
    setSpaceMembersLoaded(false);
    setLoadingMembers(false);
    setSpaceMembers([]);
    setSpaceGroups([]);
    setWorkspaceMembers([]);
    setMutatingGroupIds(new Set());
    setMemberSearch('');
    inputRef.current = null;
  }, [open, viewId]);

  const refreshSpaceMembers = useCallback(async (): Promise<boolean> => {
    if (!workspaceId || !viewId) return false;
    const requestScope = spaceRequestRef.current;

    if (!requestScope.open || requestScope.workspaceId !== workspaceId || requestScope.viewId !== viewId) return false;

    const requestSequence = requestScope.memberRequestSequence + 1;
    const requestGeneration = requestScope.generation;

    spaceRequestRef.current = {
      ...requestScope,
      memberRequestSequence: requestSequence,
    };

    const isCurrentRequest = () => {
      const current = spaceRequestRef.current;

      return (
        current.open &&
        current.workspaceId === workspaceId &&
        current.viewId === viewId &&
        current.generation === requestGeneration &&
        current.memberRequestSequence === requestSequence
      );
    };

    setLoadingMembers(true);
    try {
      const result = await WorkspaceService.getSpaceMembers(workspaceId, viewId);

      if (!isCurrentRequest()) return false;
      setSpaceMembers(result.members || []);
      setSpaceGroups(result.groups || []);
      setSpaceMembersLoaded(true);
      return true;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      // Keep an already-loaded roster interactive when only a post-mutation
      // revalidation fails. Initial loads start with this flag cleared.
      toast.error(getErrorMessage(error, t('space.permissionManager.loadSpaceMembersFailed')));
      return false;
    } finally {
      if (isCurrentRequest()) setLoadingMembers(false);
    }
  }, [t, workspaceId, viewId]);

  useEffect(() => {
    if (!open) return;

    const handlePermissionChanged = () => {
      settingsRequestSequenceRef.current += 1;
      const requestScope = spaceRequestRef.current;

      spaceRequestRef.current = {
        ...requestScope,
        memberRequestSequence: requestScope.memberRequestSequence + 1,
      };
      beginPermissionRefresh();
      setPermissionRefreshRevision((revision) => revision + 1);
    };

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    return () => {
      eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    };
  }, [beginPermissionRefresh, eventEmitter, open]);

  useEffect(() => {
    if (!open || !workspaceId || !viewRef.current) return;
    let cancelled = false;

    const settingsRequestSequence = settingsRequestSequenceRef.current + 1;
    const requestScope = spaceRequestRef.current;

    settingsRequestSequenceRef.current = settingsRequestSequence;
    spaceRequestRef.current = {
      ...requestScope,
      memberRequestSequence: requestScope.memberRequestSequence + 1,
    };
    const isCurrentSettingsRequest = () => {
      const currentScope = spaceRequestRef.current;

      return (
        !cancelled &&
        settingsRequestSequenceRef.current === settingsRequestSequence &&
        currentScope.open &&
        currentScope.workspaceId === workspaceId &&
        currentScope.viewId === viewId
      );
    };

    beginPermissionRefresh();
    void (async () => {
      let shouldLoadWorkspaceMembers = false;
      let shouldLoadSpaceMembers = false;

      try {
        const permission = await WorkspaceService.getSpacePermission(workspaceId, viewId);

        if (!isCurrentSettingsRequest()) return;
        const normalizedPermission = normalizePermissionSettings(
          permission.permission,
          Boolean(viewRef.current?.is_private)
        );

        setPermissionSettings(normalizedPermission);
        setLoadedPermissionSettings(normalizedPermission);
        setCanManageSpace(permission.can_manage_space);
        setCanEditSidebar(permission.can_edit_sidebar || permission.can_manage_space);
        setCanManageMembers(permission.can_manage_members);
        setCanInviteMembers(permission.can_invite_members);
        setLegacyPermissionMode(false);
        setPermissionLoaded(true);
        shouldLoadWorkspaceMembers =
          normalizedPermission.visibility !== SpaceVisibility.Public &&
          (permission.can_manage_members || permission.can_invite_members);
        shouldLoadSpaceMembers = permission.can_manage_members;
      } catch (error) {
        if (isCurrentSettingsRequest()) {
          const useLegacyManagement = isUnsupportedRouteError(error);
          const legacyPermission = defaultPermissionSettings(Boolean(viewRef.current?.is_private));

          setCanManageSpace(useLegacyManagement);
          setCanEditSidebar(useLegacyManagement);
          setCanManageMembers(false);
          setCanInviteMembers(false);
          setLoadedPermissionSettings(useLegacyManagement ? legacyPermission : null);
          setPermissionSettings(legacyPermission);
          setPermissionLoaded(useLegacyManagement);
          setPermissionLoadFailed(!useLegacyManagement);
          setLegacyPermissionMode(useLegacyManagement);
          setSpaceMembersLoaded(false);
          setSpaceMembers([]);
          setSpaceGroups([]);
          setWorkspaceMembers([]);
          if (!useLegacyManagement) {
            toast.error(getErrorMessage(error, t('space.permissionManager.loadSpaceSettingsFailed')));
          }
        }
      } finally {
        if (isCurrentSettingsRequest()) setLoadingSettings(false);
      }

      const loadWorkspaceMembers = async () => {
        if (!shouldLoadWorkspaceMembers) return;
        try {
          const workspaceMemberList = await WorkspaceService.getMembers(workspaceId);

          if (isCurrentSettingsRequest()) setWorkspaceMembers(workspaceMemberList);
        } catch (error) {
          if (isCurrentSettingsRequest()) {
            toast.error(getErrorMessage(error, t('space.permissionManager.loadSpaceMembersFailed')));
          }
        }
      };

      const loadSpaceMembers = async () => {
        if (shouldLoadSpaceMembers) {
          await refreshSpaceMembers();
        } else if (isCurrentSettingsRequest()) {
          setSpaceMembersLoaded(false);
          setSpaceMembers([]);
          setSpaceGroups([]);
        }
      };

      await Promise.all([loadWorkspaceMembers(), loadSpaceMembers()]);
    })();

    return () => {
      cancelled = true;
    };
  }, [beginPermissionRefresh, open, permissionRefreshRevision, refreshSpaceMembers, t, viewId, workspaceId]);

  const normalizedMemberSearch = memberSearch.trim().toLowerCase();

  const visibleSpaceMembers = useMemo(
    () => spaceMembers.filter((member) => matchesMemberSearch(member, normalizedMemberSearch, t)),
    [normalizedMemberSearch, spaceMembers, t]
  );
  const visibleSpaceGroups = useMemo(
    () => spaceGroups.filter((group) => matchesGroupSearch(group, normalizedMemberSearch)),
    [normalizedMemberSearch, spaceGroups]
  );

  const explicitMemberUids = useMemo(() => new Set(spaceMembers.map((member) => member.uid)), [spaceMembers]);
  const explicitMemberEmails = useMemo(
    () =>
      new Set(
        spaceMembers
          .map((member) => member.email?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email))
      ),
    [spaceMembers]
  );

  const addableWorkspaceMembers = useAddableWorkspaceMembers({
    workspaceMembers,
    search: memberSearch,
    excludedUids: explicitMemberUids,
    excludedEmails: explicitMemberEmails,
    excludePending: true,
  });
  const showCurrentSpaceMemberList =
    !normalizedMemberSearch ||
    visibleSpaceMembers.length > 0 ||
    visibleSpaceGroups.length > 0 ||
    addableWorkspaceMembers.length === 0;

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
    (visibility: SpaceVisibility) => updatePermission({ visibility }),
    [updatePermission]
  );

  const handleSave = useCallback(async () => {
    if (!workspaceId) return;
    if (legacyPermissionMode && !updateLegacySpace) return;
    if (loadingSettings || saving || !permissionLoaded || permissionLoadFailed || !canEditSidebar) {
      if (permissionLoadFailed) {
        toast.error(t('space.permissionManager.loadSpaceSettingsFailed'));
      }

      return;
    }

    const trimmedName = spaceName.trim();

    if (!trimmedName) {
      toast.error(t('space.spaceNameCannotBeEmpty'));
      return;
    }

    setSaving(true);
    try {
      if (legacyPermissionMode) {
        await updateLegacySpace?.({
          view_id: viewId,
          name: trimmedName,
          space_icon: spaceIcon,
          space_icon_color: spaceIconColor,
          space_permission: legacySpacePermission(permissionSettings.visibility),
        });
      } else {
        const permissionChanged =
          canManageSpace &&
          loadedPermissionSettings !== null &&
          !equalPermissionSettings(permissionSettings, loadedPermissionSettings);
        const bridgeSteps =
          permissionChanged && loadedPermissionSettings
            ? legacyVisibilityBridgeSteps(loadedPermissionSettings.visibility, permissionSettings.visibility)
            : [];
        const loadedMetadata = loadedSpaceMetadataRef.current;
        let bridgeMutationApplied = false;

        try {
          if (bridgeSteps.length > 0) {
            if (!updateLegacySpace) throw new Error(t('space.error.updateSpace'));

            // Keep the old metadata on the compatibility request so only the
            // final structured write commits the user's form edits.
            for (const spacePermission of bridgeSteps) {
              await updateLegacySpace({
                view_id: viewId,
                ...loadedMetadata,
                space_permission: spacePermission,
              });
              bridgeMutationApplied = true;
            }
          }

          await WorkspaceService.updateStructuredSpace(workspaceId, viewId, {
            name: trimmedName,
            space_icon: spaceIcon,
            space_icon_color: spaceIconColor,
            ...(permissionChanged ? { permission: permissionSettings } : {}),
          });
        } catch (error) {
          if (bridgeMutationApplied && loadedPermissionSettings) {
            // Restore the binary marker first, then the structured settings.
            if (updateLegacySpace) {
              try {
                await updateLegacySpace({
                  view_id: viewId,
                  ...loadedMetadata,
                  space_permission: legacySpacePermission(loadedPermissionSettings.visibility),
                });
              } catch (rollbackError) {
                Log.error('[ManageSpace] Failed to roll back legacy space visibility', {
                  workspaceId,
                  viewId,
                  rollbackError,
                });
              }
            }

            try {
              await WorkspaceService.updateStructuredSpace(workspaceId, viewId, {
                ...loadedMetadata,
                permission: loadedPermissionSettings,
              });
            } catch (rollbackError) {
              Log.error('[ManageSpace] Failed to restore structured space settings', {
                workspaceId,
                viewId,
                rollbackError,
              });
            }
          }

          throw error;
        }
      }

      toast.success(t('space.success.updateSpace'));
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, t('space.error.updateSpace')));
    } finally {
      setSaving(false);
    }
  }, [
    canEditSidebar,
    canManageSpace,
    legacyPermissionMode,
    loadedPermissionSettings,
    loadingSettings,
    onClose,
    permissionSettings,
    permissionLoaded,
    permissionLoadFailed,
    saving,
    spaceIcon,
    spaceIconColor,
    spaceName,
    t,
    updateLegacySpace,
    viewId,
    workspaceId,
  ]);

  // A public space makes every workspace member an implicit space member, so
  // its roster is informational only. Gate on the loaded (server) visibility,
  // not the unsaved draft, and on Public specifically: a custom space has the
  // same implicit roster but lets managers remove anyone from it, including
  // `workspace_default` rows (the server records a default-access revocation).
  const membersReadOnly = loadedPermissionSettings?.visibility === SpaceVisibility.Public;
  const implicitMembersRemovable = loadedPermissionSettings?.visibility === SpaceVisibility.Custom;

  const handleAddMember = useCallback(
    async (workspaceMember: WorkspaceMember) => {
      const uid = getWorkspaceMemberUid(workspaceMember);

      if (!uid || membersReadOnly || !permissionLoaded || permissionLoadFailed || !canInviteMembers || !workspaceId) {
        return;
      }

      setAddingUid(uid);
      try {
        await WorkspaceService.addSpaceMember(workspaceId, viewId, {
          uid,
          role: SpaceMemberRole.Member,
          access_level: permissionSettings.member_default_access_level,
        });
        if (canManageMembers) await refreshSpaceMembers();
        toast.success(t('space.permissionManager.addSpaceMemberSuccess'));
      } catch (error) {
        toast.error(getErrorMessage(error, t('space.permissionManager.addSpaceMemberFailed')));
      } finally {
        setAddingUid(null);
      }
    },
    [
      canInviteMembers,
      canManageMembers,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
      permissionSettings.member_default_access_level,
      refreshSpaceMembers,
      t,
      viewId,
      workspaceId,
    ]
  );

  const handleUpdateMemberRole = useCallback(
    async (member: SpaceMember, role: SpaceMemberRole) => {
      if (
        member.role === role ||
        membersReadOnly ||
        !permissionLoaded ||
        permissionLoadFailed ||
        !canManageMembers ||
        !workspaceId
      ) {
        return;
      }

      const accessLevel =
        role === SpaceMemberRole.Owner ? AccessLevel.FullAccess : permissionSettings.member_default_access_level;

      setMutatingMemberUid(member.uid);
      try {
        if (isMutableSpaceMember(member)) {
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
        toast.error(manageSpaceErrorMessage(error, t('space.permissionManager.updateSpaceMemberFailed'), t));
      } finally {
        setMutatingMemberUid(null);
      }
    },
    [
      canManageMembers,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
      permissionSettings.member_default_access_level,
      refreshSpaceMembers,
      t,
      viewId,
      workspaceId,
    ]
  );

  const handleRemoveMember = useCallback(
    async (member: SpaceMember) => {
      if (membersReadOnly || !permissionLoaded || permissionLoadFailed || !canManageMembers || !workspaceId) return;
      setMutatingMemberUid(member.uid);
      try {
        await WorkspaceService.removeSpaceMember(workspaceId, viewId, member.uid);
        await refreshSpaceMembers();
        toast.success(t('space.permissionManager.removeSpaceMemberSuccess'));
      } catch (error) {
        toast.error(manageSpaceErrorMessage(error, t('space.permissionManager.removeSpaceMemberFailed'), t));
      } finally {
        setMutatingMemberUid(null);
      }
    },
    [
      canManageMembers,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
      refreshSpaceMembers,
      t,
      viewId,
      workspaceId,
    ]
  );

  const setGroupMutationPending = useCallback((groupId: string, pending: boolean) => {
    setMutatingGroupIds((current) => {
      const next = new Set(current);

      if (pending) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }

      return next;
    });
  }, []);

  const handleUpdateGroupRole = useCallback(
    async (group: WorkspaceGroupSpacePermission, role: SpaceMemberRole) => {
      if (
        group.role === role ||
        membersReadOnly ||
        !permissionLoaded ||
        permissionLoadFailed ||
        !canManageMembers ||
        !workspaceId
      ) {
        return;
      }

      const requestGeneration = spaceRequestRef.current.generation;
      const accessLevel =
        role === SpaceMemberRole.Owner ? AccessLevel.FullAccess : permissionSettings.member_default_access_level;

      setGroupMutationPending(group.group_id, true);
      try {
        const updatedGroup = await WorkspaceService.updateSpaceGroupPermission(workspaceId, viewId, group.group_id, {
          role,
          access_level: accessLevel,
        });
        const currentScope = spaceRequestRef.current;

        if (
          currentScope.generation !== requestGeneration ||
          !currentScope.open ||
          currentScope.workspaceId !== workspaceId ||
          currentScope.viewId !== viewId
        ) {
          return;
        }

        setSpaceGroups((current) =>
          current.map((currentGroup) => (currentGroup.group_id === updatedGroup.group_id ? updatedGroup : currentGroup))
        );
        await refreshSpaceMembers();
      } catch (error) {
        if (spaceRequestRef.current.generation === requestGeneration) {
          toast.error(manageSpaceErrorMessage(error, t('space.permissionManager.updateSpaceMemberFailed'), t));
        }
      } finally {
        if (spaceRequestRef.current.generation === requestGeneration) {
          setGroupMutationPending(group.group_id, false);
        }
      }
    },
    [
      canManageMembers,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
      permissionSettings.member_default_access_level,
      refreshSpaceMembers,
      setGroupMutationPending,
      t,
      viewId,
      workspaceId,
    ]
  );

  const handleRemoveGroup = useCallback(
    async (group: WorkspaceGroupSpacePermission) => {
      if (membersReadOnly || !permissionLoaded || permissionLoadFailed || !canManageMembers || !workspaceId) return;
      const requestGeneration = spaceRequestRef.current.generation;

      setGroupMutationPending(group.group_id, true);
      try {
        await WorkspaceService.removeSpaceGroupPermission(workspaceId, viewId, group.group_id);
        const currentScope = spaceRequestRef.current;

        if (
          currentScope.generation !== requestGeneration ||
          !currentScope.open ||
          currentScope.workspaceId !== workspaceId ||
          currentScope.viewId !== viewId
        ) {
          return;
        }

        setSpaceGroups((current) => current.filter((currentGroup) => currentGroup.group_id !== group.group_id));
        await refreshSpaceMembers();
        toast.success(t('shareAction.removeGroupAccessSuccess', { group: group.name }));
      } catch (error) {
        if (spaceRequestRef.current.generation === requestGeneration) {
          toast.error(manageSpaceErrorMessage(error, t('shareAction.removeAccessError'), t));
        }
      } finally {
        if (spaceRequestRef.current.generation === requestGeneration) {
          setGroupMutationPending(group.group_id, false);
        }
      }
    },
    [
      canManageMembers,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
      refreshSpaceMembers,
      setGroupMutationPending,
      t,
      viewId,
      workspaceId,
    ]
  );

  const handleMemberSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.stopPropagation();
  }, []);

  if (!view) return null;

  const metadataDisabled = loadingSettings || !permissionLoaded || permissionLoadFailed || !canEditSidebar;
  const permissionSettingsDisabled = loadingSettings || !permissionLoaded || permissionLoadFailed || !canManageSpace;
  const membersDisabled =
    membersReadOnly ||
    loadingMembers ||
    !permissionLoaded ||
    permissionLoadFailed ||
    !spaceMembersLoaded ||
    !canManageMembers;
  const addMembersDisabled = membersReadOnly || !permissionLoaded || permissionLoadFailed || !canInviteMembers;

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
      okButtonProps={{ disabled: metadataDisabled || saving }}
      overflowHidden
      PaperProps={{
        style: {
          width: MODAL_WIDTH,
          maxWidth: '92vw',
        },
        'data-testid': 'manage-space-modal',
      }}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ManageSpaceTab)}
        className='min-h-0 max-w-full'
        style={{ width: CONTENT_WIDTH }}
      >
        <TabsList>
          <TabsTrigger value='general'>{t('space.permissionManager.generalTab')}</TabsTrigger>
          {!legacyPermissionMode && <TabsTrigger value='members'>{t('space.permissionManager.membersTab')}</TabsTrigger>}
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
                      disabled={metadataDisabled}
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
                    disabled={metadataDisabled}
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
                      <VisibilityIcon visibility={permissionSettings.visibility} />
                    </div>
                    <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                      <div className='font-medium text-text-primary'>
                        {spaceVisibilityLabel(permissionSettings.visibility, t)}
                      </div>
                      <div className='truncate text-sm text-text-secondary'>
                        {spaceVisibilityDescription(permissionSettings.visibility, t)}
                      </div>
                    </div>
                    <VisibilityDropdown
                      value={permissionSettings.visibility}
                      // The legacy editor can only persist the binary marker, so
                      // it must not offer a visibility that would be downgraded.
                      options={legacyPermissionMode ? LEGACY_SPACE_VISIBILITIES : SELECTABLE_SPACE_VISIBILITIES}
                      disabled={permissionSettingsDisabled}
                      onChange={handleVisibilityChange}
                    />
                  </div>

                  {!legacyPermissionMode && (
                    <>
                      <PermissionPrincipalRow
                        icon={<Shield className='h-5 w-5 text-icon-primary' />}
                        title={t('space.permissionManager.owners')}
                        description={t('space.permissionManager.ownersDescription')}
                        trailing={
                          <div className='flex min-w-[120px] items-center justify-end gap-2 px-2'>
                            <span className='text-sm text-text-secondary'>{t('shareAction.fullAccess')}</span>
                            <ChevronDown className='h-4 w-4 opacity-0' aria-hidden />
                          </div>
                        }
                      />

                      <PermissionPrincipalRow
                        icon={<Users className='h-5 w-5 text-icon-primary' />}
                        title={t('space.permissionManager.members')}
                        description={
                          isPrivateSpaceVisibility(permissionSettings.visibility)
                            ? t('space.permissionManager.membersDescription')
                            : t('space.permissionManager.publicMembersDescription')
                        }
                        testId='manage-space-members-default-access-row'
                        trailing={
                          <AccessDropdown
                            value={permissionSettings.member_default_access_level}
                            disabled={permissionSettingsDisabled}
                            onChange={(value) => {
                              if (value !== null) updatePermission({ member_default_access_level: value });
                            }}
                          />
                        }
                        last
                      />
                    </>
                  )}
                </div>
              </section>
            </div>
          </div>
        </TabsContent>

        {!legacyPermissionMode && (
          <TabsContent value='members' className='min-h-0'>
            <div className='appflowy-scroller max-h-[64vh] overflow-y-auto py-2 pr-1'>
              <div className='flex flex-col gap-4'>
                {!membersReadOnly && (
                  <WorkspaceMemberInlineSearch
                    search={memberSearch}
                    onSearchChange={setMemberSearch}
                    addableMembers={addableWorkspaceMembers}
                    searchPlaceholder={t('space.permissionManager.searchMembers')}
                    addButtonLabel={t('space.permissionManager.addMembers')}
                    addResultLabel={t('space.permissionManager.notInSpace')}
                    addActionLabel={t('space.permissionManager.add')}
                    ownerBadgeLabel={t('space.permissionManager.workspaceOwner')}
                    unavailableTitle={t('space.permissionManager.workspaceMemberUidUnavailable')}
                    unavailableHint={t('space.permissionManager.workspaceMemberUidUnavailableHint')}
                    inputDisabled={addMembersDisabled}
                    addButtonDisabled={addMembersDisabled || Boolean(addingUid)}
                    addingUid={addingUid}
                    onInputKeyDown={handleMemberSearchKeyDown}
                    onAddMember={(member) => void handleAddMember(member)}
                  />
                )}

                {canManageMembers && showCurrentSpaceMemberList && (
                  <>
                    <div
                      className='grid items-center gap-3 border-b border-border-primary pb-2 text-sm font-medium text-text-secondary'
                      style={{ gridTemplateColumns: MEMBER_GRID_COLUMNS }}
                    >
                      <span>{t('space.permissionManager.name')}</span>
                      <span className='text-right'>{t('space.permissionManager.role')}</span>
                    </div>

                    {loadingMembers && spaceMembers.length === 0 && spaceGroups.length === 0 ? (
                      <div className='flex justify-center py-8'>
                        <Progress />
                      </div>
                    ) : visibleSpaceMembers.length === 0 && visibleSpaceGroups.length === 0 ? (
                      <div className='py-8 text-center text-sm text-text-secondary'>
                        {t('space.permissionManager.noSpaceMembersFound')}
                      </div>
                    ) : (
                      <div className='flex flex-col'>
                        {visibleSpaceMembers.map((member) => {
                          const mutable = isMutableSpaceMember(member);

                          return (
                            <div
                              key={`${member.uid}-${member.source}`}
                              data-testid={`space-member-row-${member.uid}`}
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
                                  <div className='truncate font-medium text-text-primary'>
                                    {displayNameForMember(member, t)}
                                  </div>
                                  <div className='truncate text-sm text-text-secondary'>{member.email || ''}</div>
                                </div>
                              </div>

                              <div className='flex justify-end'>
                                <RoleDropdown
                                  value={member.role}
                                  readOnly={membersReadOnly}
                                  disabled={membersDisabled || mutatingMemberUid === member.uid}
                                  canRemove={
                                    !membersReadOnly && canManageMembers && (mutable || implicitMembersRemovable)
                                  }
                                  onChange={(role) => void handleUpdateMemberRole(member, role)}
                                  onRemove={() => void handleRemoveMember(member)}
                                />
                              </div>
                            </div>
                          );
                        })}
                        {visibleSpaceGroups.map((group) => (
                          <div
                            key={`group:${group.group_id}`}
                            data-testid={`space-group-row-${group.group_id}`}
                            className='grid items-center gap-3 border-b border-border-primary py-3'
                            style={{ gridTemplateColumns: MEMBER_GRID_COLUMNS }}
                          >
                            <div className='flex min-w-0 items-center gap-3'>
                              <Avatar size='md'>
                                <AvatarFallback name={group.name}>{group.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              <div className='min-w-0'>
                                <div className='flex min-w-0 items-center gap-2'>
                                  <div className='truncate font-medium text-text-primary'>{group.name}</div>
                                  <span className='rounded-full bg-fill-content-hover px-2 py-[1px] text-xs text-text-secondary'>
                                    {t('shareAction.group')}
                                  </span>
                                </div>
                                <div className='truncate text-sm text-text-secondary'>
                                  {t('shareAction.groupMembersCount', { count: group.member_count })}
                                </div>
                              </div>
                            </div>

                            <div className='flex justify-end'>
                              <RoleDropdown
                                value={group.role}
                                readOnly={membersReadOnly}
                                disabled={membersDisabled || mutatingGroupIds.has(group.group_id)}
                                canRemove={!membersReadOnly && canManageMembers}
                                onChange={(role) => void handleUpdateGroupRole(group, role)}
                                onRemove={() => void handleRemoveGroup(group)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </TabsContent>
        )}
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
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  trailing: React.ReactNode;
  last?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cn('flex items-center gap-3 px-4 py-3', !last && 'border-b border-border-primary')}
      data-testid={testId}
    >
      <div className='flex h-8 w-8 items-center justify-center rounded-300 bg-fill-content-hover'>{icon}</div>
      <div className='min-w-0 flex-1'>
        <div className='font-medium text-text-primary'>{title}</div>
        <div className='truncate text-sm text-text-secondary'>{description}</div>
      </div>
      {trailing}
    </div>
  );
}

export default ManageSpace;
