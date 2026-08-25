import { ChevronDown, Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import {
  AccessLevel,
  legacySpacePermission,
  normalizeKnownLegacySpaceVisibility,
  Role,
  SpaceMember,
  SpaceMemberRole,
  SpacePermissionSettings,
  SpaceVisibility,
  WorkspaceGroup,
  WorkspaceGroupSpacePermission,
  WorkspaceMember,
} from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import {
  useAppOperations,
  useAppView,
  useCurrentWorkspaceId,
  useEventEmitter,
  useUserWorkspaceInfo,
} from '@/components/app/app.hooks';
import {
  getWorkspaceMemberUid,
  useAddableWorkspaceMembers,
  WorkspaceMemberInlineSearch,
} from '@/components/app/share/WorkspaceMemberInlineSearch';
import SpaceSettingsPanel, { SpaceSettingsTab } from '@/components/app/view-actions/SpaceSettingsPanel';
import {
  defaultEveryoneElseAccessLevel,
  defaultSpacePermissionSettings,
  isPrivateSpaceVisibility,
  LEGACY_SPACE_VISIBILITIES,
  SELECTABLE_SPACE_VISIBILITIES,
} from '@/components/app/view-actions/spaceVisibilityOptions';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
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
import { Progress } from '@/components/ui/progress';
import { getErrorMessage, isUnsupportedRouteError } from '@/utils/errors';

import type { TFunction } from 'i18next';
import type { KeyboardEvent } from 'react';

type ManageSpaceTab = SpaceSettingsTab;

type SpaceMetadata = {
  name: string;
  space_icon: string;
  space_icon_color: string;
};

type SpaceMetadataFieldVersions = Record<keyof SpaceMetadata, number>;

type SpaceMetadataMutationCoordinator = {
  confirmed: SpaceMetadata;
  tail: Promise<void>;
};

// A dialog closes by unmounting. Keep each space's write tail outside the
// component so reopening cannot let a newer PATCH overtake an older request
// that is still in flight.
const spaceMetadataMutationCoordinators = new Map<string, SpaceMetadataMutationCoordinator>();

function metadataMutationKey(workspaceId: string, viewId: string): string {
  return JSON.stringify([workspaceId, viewId]);
}

function getMetadataMutationCoordinator(
  key: string,
  confirmed: SpaceMetadata
): SpaceMetadataMutationCoordinator {
  const existing = spaceMetadataMutationCoordinators.get(key);

  if (existing) return existing;
  const coordinator = { confirmed, tail: Promise.resolve() };

  spaceMetadataMutationCoordinators.set(key, coordinator);
  return coordinator;
}

// Compatibility controls for a visibility value this client does not yet understand.
const INHERITED_MEMBER_SOURCES = new Set(['workspace_default', 'page_share']);
const LAST_EXPLICIT_OWNER_ERROR = 'space must keep at least one explicit owner';
const MEMBER_GRID_COLUMNS = 'minmax(0, 1fr) 220px';
const MAX_ADDABLE_GROUP_RESULTS = 8;

type FullAccessAudience = 'space-members' | 'everyone-else' | 'workspace-members';

type PendingConfirmation =
  | { kind: 'visibility'; target: SpaceVisibility }
  | { kind: 'full-access'; audience: FullAccessAudience }
  | { kind: 'group-owner'; group: WorkspaceGroupSpacePermission };

// The outline only carries the binary `is_private` marker, so a space whose
// structured settings have not loaded yet is seeded as Public or Private.
function defaultPermissionSettings(isPrivate: boolean): SpacePermissionSettings {
  return defaultSpacePermissionSettings(isPrivate ? SpaceVisibility.Private : SpaceVisibility.Public);
}

function normalizePermissionSettings(permission: SpacePermissionSettings, isPrivate: boolean): SpacePermissionSettings {
  const fallback = defaultPermissionSettings(isPrivate);
  // Collapse the retired default/open/closed aliases (an older server still
  // emits them) so the matching card highlights, but keep any other value this
  // client does not know yet, so a save never rewrites it behind the user.
  const visibility = normalizeKnownLegacySpaceVisibility(permission.visibility ?? fallback.visibility);

  return {
    visibility,
    owner_access_level: permission.owner_access_level ?? fallback.owner_access_level,
    // `null` is a real value here (No access on custom spaces); only a missing
    // field falls back to the default.
    member_default_access_level:
      permission.member_default_access_level === undefined
        ? fallback.member_default_access_level
        : permission.member_default_access_level,
    // Only custom spaces carry an everyone-else audience. Older servers omit
    // the field, in which case a custom space gets the server default.
    everyone_else_access_level:
      visibility === SpaceVisibility.Custom
        ? permission.everyone_else_access_level === undefined
          ? defaultEveryoneElseAccessLevel(visibility)
          : permission.everyone_else_access_level
        : null,
    invite_policy: permission.invite_policy ?? fallback.invite_policy,
    sidebar_edit_policy: permission.sidebar_edit_policy ?? fallback.sidebar_edit_policy,
    invite_link_enabled: permission.invite_link_enabled ?? fallback.invite_link_enabled,
    security: {
      ...fallback.security,
      ...permission.security,
    },
  };
}

/**
 * Move a pending draft to `target`, seeding the collective levels the new type
 * needs: a space that becomes custom opens everyone else with Can view (or the
 * level the server already holds when the space is custom), and a space that
 * stops being custom cannot keep members at No access.
 */
function applyVisibility(
  current: SpacePermissionSettings,
  loaded: SpacePermissionSettings | null,
  target: SpaceVisibility
): SpacePermissionSettings {
  if (target === SpaceVisibility.Custom) {
    const loadedCustom = loaded?.visibility === SpaceVisibility.Custom ? loaded : null;

    return {
      ...current,
      visibility: target,
      // Public/Private cannot represent No access and temporarily coerce it to
      // Can edit. Returning to the loaded Custom type must restore the server
      // draft, including an intentional null, rather than preserve that
      // compatibility coercion.
      member_default_access_level: loadedCustom
        ? loadedCustom.member_default_access_level
        : current.member_default_access_level ?? AccessLevel.ReadAndWrite,
      everyone_else_access_level: loadedCustom
        ? loadedCustom.everyone_else_access_level ?? null
        : defaultEveryoneElseAccessLevel(target),
    };
  }

  return {
    ...current,
    visibility: target,
    member_default_access_level: current.member_default_access_level ?? AccessLevel.ReadAndWrite,
    everyone_else_access_level: null,
  };
}

// The server replaces the whole settings object, so send exactly the shape it
// will keep: everyone else only exists on custom spaces.
function permissionSettingsForSave(settings: SpacePermissionSettings): SpacePermissionSettings {
  return {
    ...settings,
    everyone_else_access_level:
      settings.visibility === SpaceVisibility.Custom ? settings.everyone_else_access_level ?? null : null,
  };
}

function roleLabel(role: SpaceMemberRole, t: TFunction): string {
  return role === SpaceMemberRole.Owner ? t('space.permissionManager.owner') : t('space.permissionManager.member');
}

function workspaceRoleLabel(role: Role | undefined, t: TFunction): string | null {
  switch (role) {
    case Role.Owner:
      return t('space.permissionManager.workspaceOwner');
    case Role.Member:
      return t('space.permissionManager.workspaceMember');
    case Role.Guest:
      return t('space.permissionManager.workspaceGuest');
    default:
      return null;
  }
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

// "Workspace owner · annie@acme.com": the workspace role the PRD asks for,
// plus the email so people with the same name stay distinguishable. When the
// name line already shows the email, it is not repeated.
function memberSubtitle(member: SpaceMember, t: TFunction): string {
  const email = member.email && member.email !== displayNameForMember(member, t) ? member.email : null;

  return [workspaceRoleLabel(member.workspace_role, t), email]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

function matchesMemberSearch(member: SpaceMember, normalizedSearch: string, t: TFunction): boolean {
  if (!normalizedSearch) return true;

  return (
    displayNameForMember(member, t).toLowerCase().includes(normalizedSearch) ||
    (member.email || '').toLowerCase().includes(normalizedSearch)
  );
}

function matchesGroupSearch(group: { name: string }, normalizedSearch: string): boolean {
  return !normalizedSearch || group.name.toLowerCase().includes(normalizedSearch);
}

function isMutableSpaceMember(member: SpaceMember): boolean {
  return !INHERITED_MEMBER_SOURCES.has(member.source);
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

function ManageSpaceConfirmModal({
  open,
  title,
  description,
  confirmText,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <NormalModal
      open={open}
      keepMounted={false}
      disableRestoreFocus
      danger={danger}
      title={<div className='flex w-full items-center text-left font-semibold'>{title}</div>}
      okText={confirmText}
      cancelText={t('button.cancel')}
      onOk={onConfirm}
      onCancel={onClose}
      onClose={onClose}
      PaperProps={{
        sx: { width: 500, maxWidth: 'calc(100% - 32px)' },
        'data-testid': 'manage-space-confirm-dialog',
      }}
      okButtonProps={{ 'data-testid': 'manage-space-confirm-ok' }}
    >
      <div className='font-normal text-text-secondary' data-testid='manage-space-confirm-description'>
        {description}
      </div>
    </NormalModal>
  );
}

function ManageSpace({ open, onClose, viewId }: { open: boolean; onClose: () => void; viewId: string }) {
  const view = useAppView(viewId);
  const { updateSpace: updateLegacySpace } = useAppOperations();
  const workspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUserOptional();
  const eventEmitter = useEventEmitter();
  const { t } = useTranslation();
  const [tab, setTab] = useState<ManageSpaceTab>('general');
  const [spaceName, setSpaceName] = useState<string>(view?.name || '');
  const [spaceIcon, setSpaceIcon] = useState<string>(view?.extra?.space_icon || '');
  const [spaceIconColor, setSpaceIconColor] = useState<string>(view?.extra?.space_icon_color || '');
  const [permissionSettings, setPermissionSettings] = useState<SpacePermissionSettings>(() =>
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
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceGroup[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [spaceMembersLoaded, setSpaceMembersLoaded] = useState(false);
  const [permissionLoaded, setPermissionLoaded] = useState(false);
  const [permissionLoadFailed, setPermissionLoadFailed] = useState(false);
  const [legacyPermissionMode, setLegacyPermissionMode] = useState(false);
  const [permissionRefreshRevision, setPermissionRefreshRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [mutatingMemberUids, setMutatingMemberUids] = useState<Set<string>>(() => new Set());
  const [mutatingGroupIds, setMutatingGroupIds] = useState<Set<string>>(() => new Set());
  const [addingUid, setAddingUid] = useState<string | null>(null);
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settingsRequestSequenceRef = useRef(0);
  const permissionMutationSequenceRef = useRef(0);
  const metadataMutationGenerationRef = useRef(0);
  const metadataFieldVersionsRef = useRef<SpaceMetadataFieldVersions>({
    name: 0,
    space_icon: 0,
    space_icon_color: 0,
  });
  const mutatingMemberUidsRef = useRef<Set<string>>(new Set());
  const savingRef = useRef(false);
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

    return () => {
      settingsRequestSequenceRef.current += 1;
      permissionMutationSequenceRef.current += 1;
      savingRef.current = false;
      const latestRequestScope = spaceRequestRef.current;

      spaceRequestRef.current = {
        ...latestRequestScope,
        generation: latestRequestScope.generation + 1,
        memberRequestSequence: latestRequestScope.memberRequestSequence + 1,
        open: false,
      };
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
    setWorkspaceGroups([]);
  }, []);

  // Always hold the latest view without making it an effect dependency: `view`
  // is recomputed whenever the outline changes identity (realtime sync, a
  // sibling rename, expand/collapse), and we must not reset the form mid-edit.
  const viewRef = useRef(view);
  const loadedSpaceMetadataRef = useRef<SpaceMetadata>({
    name: view?.name || '',
    space_icon: view?.extra?.space_icon || '',
    space_icon_color: view?.extra?.space_icon_color || '',
  });
  // Keep server-confirmed metadata separate from the latest optimistic form
  // value. Concurrent edits must never use another unconfirmed edit as their
  // rollback baseline.
  const confirmedSpaceMetadataRef = useRef<SpaceMetadata>(loadedSpaceMetadataRef.current);

  useEffect(() => {
    viewRef.current = view;
  });

  // Seed the form only when the modal opens or the target space changes — both
  // primitives — reading the current view snapshot from the ref.
  useEffect(() => {
    metadataMutationGenerationRef.current += 1;
    if (!open) return;
    const currentView = viewRef.current;

    if (!currentView) return;
    const loadedMetadata = {
      name: currentView.name || '',
      space_icon: currentView.extra?.space_icon || '',
      space_icon_color: currentView.extra?.space_icon_color || '',
    };

    loadedSpaceMetadataRef.current = loadedMetadata;
    confirmedSpaceMetadataRef.current = loadedMetadata;
    metadataFieldVersionsRef.current = {
      name: 0,
      space_icon: 0,
      space_icon_color: 0,
    };
    permissionMutationSequenceRef.current += 1;
    savingRef.current = false;
    mutatingMemberUidsRef.current = new Set();
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
    setWorkspaceGroups([]);
    setMutatingMemberUids(new Set());
    setMutatingGroupIds(new Set());
    setAddingUid(null);
    setAddingGroupId(null);
    setMemberSearch('');
    setPendingConfirmation(null);
    setSaving(false);
    inputRef.current = null;

    return () => {
      // Detach local UI completion from a closed modal or newly selected space;
      // the per-space coordinator still preserves server request ordering.
      metadataMutationGenerationRef.current += 1;
    };
  }, [open, viewId, workspaceId]);

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
      // The event starts an authoritative server refresh. Supersede any older
      // optimistic permission request so a late rejection cannot roll fresh
      // settings back (and a late completion cannot leave the dialog saving).
      permissionMutationSequenceRef.current += 1;
      savingRef.current = false;
      setSaving(false);
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
      let shouldLoadWorkspacePrincipals = false;
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
        // Public rosters follow the workspace and are read-only, so there is
        // nothing to add there.
        const hasEditableRoster = !isPrivateSpaceVisibility(normalizedPermission.visibility);

        shouldLoadWorkspacePrincipals =
          hasEditableRoster &&
          normalizedPermission.visibility !== SpaceVisibility.Public &&
          (permission.can_manage_members || permission.can_invite_members);
        shouldLoadSpaceMembers = hasEditableRoster && permission.can_manage_members;
      } catch (error) {
        if (isCurrentSettingsRequest()) {
          // The structured capability response is the authority for this
          // dialog. An unavailable/unsupported route must never manufacture
          // management rights from the legacy binary space model.
          setCanManageSpace(false);
          setCanEditSidebar(false);
          setCanManageMembers(false);
          setCanInviteMembers(false);
          setLoadedPermissionSettings(null);
          setPermissionLoaded(false);
          setPermissionLoadFailed(true);
          setLegacyPermissionMode(false);
          setSpaceMembersLoaded(false);
          setSpaceMembers([]);
          setSpaceGroups([]);
          setWorkspaceMembers([]);
          setWorkspaceGroups([]);
          toast.error(getErrorMessage(error, t('space.permissionManager.loadSpaceSettingsFailed')));
        }
      } finally {
        if (isCurrentSettingsRequest()) setLoadingSettings(false);
      }

      const loadWorkspaceMembers = async () => {
        if (!shouldLoadWorkspacePrincipals) return;
        try {
          const workspaceMemberList = await WorkspaceService.getMembers(workspaceId);

          if (isCurrentSettingsRequest()) setWorkspaceMembers(workspaceMemberList);
        } catch (error) {
          if (isCurrentSettingsRequest()) {
            toast.error(getErrorMessage(error, t('space.permissionManager.loadSpaceMembersFailed')));
          }
        }
      };

      const loadWorkspaceGroups = async () => {
        if (!shouldLoadWorkspacePrincipals) return;
        try {
          const groups = await WorkspaceService.getWorkspaceGroups(workspaceId);

          if (isCurrentSettingsRequest()) setWorkspaceGroups(groups.groups || []);
        } catch (error) {
          // Groups are an optional add target; people can still be added when
          // the group listing is unavailable (e.g. an older server).
          if (isCurrentSettingsRequest() && !isUnsupportedRouteError(error)) {
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

      await Promise.all([loadWorkspaceMembers(), loadWorkspaceGroups(), loadSpaceMembers()]);
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
  const spaceGroupIds = useMemo(() => new Set(spaceGroups.map((group) => group.group_id)), [spaceGroups]);

  const addableWorkspaceMembers = useAddableWorkspaceMembers({
    workspaceMembers,
    search: memberSearch,
    excludedUids: explicitMemberUids,
    excludedEmails: explicitMemberEmails,
    excludePending: true,
  });
  // Like people, groups only surface once the user types: the roster below
  // stays the primary content of the tab.
  const addableWorkspaceGroups = useMemo(() => {
    if (!normalizedMemberSearch) return [];

    return workspaceGroups
      .filter((group) => !spaceGroupIds.has(group.group_id) && matchesGroupSearch(group, normalizedMemberSearch))
      .slice(0, MAX_ADDABLE_GROUP_RESULTS);
  }, [normalizedMemberSearch, spaceGroupIds, workspaceGroups]);
  const showCurrentSpaceMemberList =
    !normalizedMemberSearch ||
    visibleSpaceMembers.length > 0 ||
    visibleSpaceGroups.length > 0 ||
    (addableWorkspaceMembers.length === 0 && addableWorkspaceGroups.length === 0);

  const persistMetadata = useCallback(
    async (patch: Partial<{ name: string; space_icon: string; space_icon_color: string }>) => {
      if (
        !workspaceId ||
        !permissionLoaded ||
        permissionLoadFailed ||
        !canEditSidebar ||
        (legacyPermissionMode && !updateLegacySpace)
      ) {
        return;
      }

      const previousDesired = loadedSpaceMetadataRef.current;
      const nextDesired = { ...previousDesired, ...patch };
      const changed = Object.entries(patch).some(
        ([key, value]) => previousDesired[key as keyof SpaceMetadata] !== value
      );

      if (!changed) return;
      loadedSpaceMetadataRef.current = nextDesired;
      const mutationGeneration = metadataMutationGenerationRef.current;
      const fieldVersions = metadataFieldVersionsRef.current;
      const ownedFieldVersions: Partial<SpaceMetadataFieldVersions> = {};

      for (const field of Object.keys(patch) as Array<keyof SpaceMetadata>) {
        if (patch[field] === undefined) continue;
        const version = fieldVersions[field] + 1;

        fieldVersions[field] = version;
        ownedFieldVersions[field] = version;
      }

      const coordinatorKey = metadataMutationKey(workspaceId, viewId);
      const coordinator = getMetadataMutationCoordinator(coordinatorKey, confirmedSpaceMetadataRef.current);
      const mutation = coordinator.tail
        .catch(() => undefined)
        .then(async () => {
          const requestMetadata = { ...coordinator.confirmed, ...patch };

          try {
            if (legacyPermissionMode) {
              await updateLegacySpace?.({
                view_id: viewId,
                ...requestMetadata,
                space_permission: legacySpacePermission(permissionSettings.visibility),
              });
            } else {
              await WorkspaceService.updateStructuredSpace(workspaceId, viewId, patch);
            }

            // The coordinator remains authoritative even when this modal was
            // closed while the request was in flight; a reopened modal queues
            // behind it and must use the actual server-confirmed baseline.
            coordinator.confirmed = requestMetadata;
            if (metadataMutationGenerationRef.current !== mutationGeneration) return;
            confirmedSpaceMetadataRef.current = coordinator.confirmed;
          } catch (error) {
            if (metadataMutationGenerationRef.current !== mutationGeneration) return;

            // Roll back only fields this failed request still owns, and always
            // use server-confirmed data rather than an earlier optimistic edit.
            const currentDesired = loadedSpaceMetadataRef.current;
            const confirmed = coordinator.confirmed;
            const rolledBack = { ...currentDesired };

            confirmedSpaceMetadataRef.current = confirmed;

            if (patch.name !== undefined && metadataFieldVersionsRef.current.name === ownedFieldVersions.name) {
              rolledBack.name = confirmed.name;
              setSpaceName(confirmed.name);
            }

            if (
              patch.space_icon !== undefined &&
              metadataFieldVersionsRef.current.space_icon === ownedFieldVersions.space_icon
            ) {
              rolledBack.space_icon = confirmed.space_icon;
              setSpaceIcon(confirmed.space_icon);
            }

            if (
              patch.space_icon_color !== undefined &&
              metadataFieldVersionsRef.current.space_icon_color === ownedFieldVersions.space_icon_color
            ) {
              rolledBack.space_icon_color = confirmed.space_icon_color;
              setSpaceIconColor(confirmed.space_icon_color);
            }

            loadedSpaceMetadataRef.current = rolledBack;
            toast.error(getErrorMessage(error, t('space.error.updateSpace')));
          }
        });

      coordinator.tail = mutation;
      const releaseCoordinator = () => {
        if (spaceMetadataMutationCoordinators.get(coordinatorKey)?.tail === mutation) {
          spaceMetadataMutationCoordinators.delete(coordinatorKey);
        }
      };

      void mutation.then(releaseCoordinator, releaseCoordinator);
      await mutation;
    },
    [
      canEditSidebar,
      legacyPermissionMode,
      permissionLoaded,
      permissionLoadFailed,
      permissionSettings.visibility,
      t,
      updateLegacySpace,
      viewId,
      workspaceId,
    ]
  );

  const setMemberMutationPending = useCallback((uid: string, pending: boolean): boolean => {
    const current = mutatingMemberUidsRef.current;

    if (pending && current.has(uid)) return false;
    const next = new Set(current);

    if (pending) {
      next.add(uid);
    } else {
      next.delete(uid);
    }

    mutatingMemberUidsRef.current = next;
    setMutatingMemberUids(next);
    return true;
  }, []);

  const persistPermission = useCallback(
    async (nextPermission: SpacePermissionSettings): Promise<boolean> => {
      if (
        !workspaceId ||
        savingRef.current ||
        loadingSettings ||
        !permissionLoaded ||
        permissionLoadFailed ||
        !canManageSpace ||
        (legacyPermissionMode && !updateLegacySpace)
      ) {
        if (permissionLoadFailed) toast.error(t('space.permissionManager.loadSpaceSettingsFailed'));
        return false;
      }

      const previousPermission = loadedPermissionSettings ?? permissionSettings;
      const visibilityChanged = previousPermission.visibility !== nextPermission.visibility;
      const mutationSequence = permissionMutationSequenceRef.current + 1;
      const requestGeneration = spaceRequestRef.current.generation;
      const isCurrentMutation = () =>
        permissionMutationSequenceRef.current === mutationSequence &&
        spaceRequestRef.current.generation === requestGeneration;

      permissionMutationSequenceRef.current = mutationSequence;
      savingRef.current = true;
      setSaving(true);
      // Access selections are explicit actions. Reflect them immediately and
      // let a failed request restore the last server-confirmed settings.
      setPermissionSettings(nextPermission);

      try {
        if (legacyPermissionMode) {
          const metadata = loadedSpaceMetadataRef.current;

          await updateLegacySpace?.({
            view_id: viewId,
            ...metadata,
            space_permission: legacySpacePermission(nextPermission.visibility),
          });
        } else {
          await WorkspaceService.updateStructuredSpace(workspaceId, viewId, {
            permission: permissionSettingsForSave(nextPermission),
          });
        }

        if (!isCurrentMutation()) return false;
        setLoadedPermissionSettings(nextPermission);
        toast.success(t('space.success.updateSpace'));

        if (visibilityChanged && !legacyPermissionMode) {
          // A type transition changes the materialized roster and whether the
          // workspace directory is needed. Reload only this dialog's data;
          // sidebar permission notifications are handled independently.
          beginPermissionRefresh();
          setPermissionRefreshRevision((revision) => revision + 1);
        }

        return true;
      } catch (error) {
        if (isCurrentMutation()) {
          setPermissionSettings(previousPermission);
          toast.error(getErrorMessage(error, t('space.error.updateSpace')));
        }

        return false;
      } finally {
        if (isCurrentMutation()) {
          savingRef.current = false;
          setSaving(false);
        }
      }
    },
    [
      beginPermissionRefresh,
      canManageSpace,
      legacyPermissionMode,
      loadedPermissionSettings,
      loadingSettings,
      permissionLoaded,
      permissionLoadFailed,
      permissionSettings,
      t,
      updateLegacySpace,
      viewId,
      workspaceId,
    ]
  );

  const persistPermissionPatch = useCallback(
    (patch: Partial<SpacePermissionSettings>) => {
      const nextPermission = {
        ...permissionSettings,
        ...patch,
        security: {
          ...permissionSettings.security,
          ...(patch.security ?? {}),
        },
      };

      void persistPermission(nextPermission);
    },
    [permissionSettings, persistPermission]
  );

  // Every type selection is confirmed first; confirmation is also the commit
  // action, so there is no permission draft waiting for a footer Save.
  const requestVisibilityChange = useCallback(
    (target: SpaceVisibility) => {
      if (target === permissionSettings.visibility) return;
      setPendingConfirmation({ kind: 'visibility', target });
    },
    [permissionSettings.visibility]
  );

  // Full access carries space-management rights, so granting it to a whole
  // audience keeps its existing safety confirmation. Other access selections
  // are persisted as soon as the user chooses them.
  const requestCollectiveAccessChange = useCallback(
    (field: 'member_default_access_level' | 'everyone_else_access_level', value: AccessLevel | null) => {
      if (permissionSettings[field] === value) return;
      if (value === AccessLevel.FullAccess) {
        const audience: FullAccessAudience =
          field === 'everyone_else_access_level'
            ? 'everyone-else'
            : permissionSettings.visibility === SpaceVisibility.Public
            ? 'workspace-members'
            : 'space-members';

        setPendingConfirmation({ kind: 'full-access', audience });
        return;
      }

      persistPermissionPatch({ [field]: value });
    },
    [permissionSettings, persistPermissionPatch]
  );

  const handleTabChange = useCallback((value: ManageSpaceTab) => setTab(value), []);
  const handleMembersAccessChange = useCallback(
    (value: AccessLevel | null) => requestCollectiveAccessChange('member_default_access_level', value),
    [requestCollectiveAccessChange]
  );
  const handleEveryoneElseAccessChange = useCallback(
    (value: AccessLevel | null) => requestCollectiveAccessChange('everyone_else_access_level', value),
    [requestCollectiveAccessChange]
  );

  // A public space makes every workspace member an implicit space member, so
  // its roster is informational only. Gate on the loaded (server) visibility,
  // not the unsaved draft, and on Public specifically: a custom space lists
  // explicit people and groups that managers add and remove freely.
  const membersReadOnly = loadedPermissionSettings?.visibility === SpaceVisibility.Public;
  // Explicit members receive the collective member level; the per-member value
  // only matters on servers that still honour it.
  const explicitMemberAccessLevel = permissionSettings.member_default_access_level ?? AccessLevel.ReadOnly;

  const handleAddMember = useCallback(
    async (workspaceMember: WorkspaceMember) => {
      const uid = getWorkspaceMemberUid(workspaceMember);

      if (!uid || membersReadOnly || !permissionLoaded || permissionLoadFailed || !canInviteMembers || !workspaceId) {
        return;
      }

      const requestGeneration = spaceRequestRef.current.generation;

      setAddingUid(uid);
      try {
        await WorkspaceService.addSpaceMember(workspaceId, viewId, {
          uid,
          role: SpaceMemberRole.Member,
          access_level: explicitMemberAccessLevel,
        });
        if (spaceRequestRef.current.generation !== requestGeneration) return;
        if (canManageMembers) await refreshSpaceMembers();
        if (spaceRequestRef.current.generation !== requestGeneration) return;
        toast.success(t('space.permissionManager.addSpaceMemberSuccess'));
      } catch (error) {
        if (spaceRequestRef.current.generation === requestGeneration) {
          toast.error(getErrorMessage(error, t('space.permissionManager.addSpaceMemberFailed')));
        }
      } finally {
        if (spaceRequestRef.current.generation === requestGeneration) setAddingUid(null);
      }
    },
    [
      canInviteMembers,
      canManageMembers,
      explicitMemberAccessLevel,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
      refreshSpaceMembers,
      t,
      viewId,
      workspaceId,
    ]
  );

  const handleAddGroup = useCallback(
    async (group: WorkspaceGroup) => {
      if (membersReadOnly || !permissionLoaded || permissionLoadFailed || !canManageMembers || !workspaceId) return;
      const requestGeneration = spaceRequestRef.current.generation;

      setAddingGroupId(group.group_id);
      try {
        const granted = await WorkspaceService.addSpaceGroupPermission(workspaceId, viewId, group.group_id, {
          role: SpaceMemberRole.Member,
          access_level: explicitMemberAccessLevel,
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
          current.some((currentGroup) => currentGroup.group_id === granted.group_id)
            ? current.map((currentGroup) => (currentGroup.group_id === granted.group_id ? granted : currentGroup))
            : [...current, granted]
        );
        await refreshSpaceMembers();
        toast.success(t('space.permissionManager.addSpaceGroupSuccess'));
      } catch (error) {
        if (spaceRequestRef.current.generation === requestGeneration) {
          toast.error(getErrorMessage(error, t('space.permissionManager.addSpaceGroupFailed')));
        }
      } finally {
        if (spaceRequestRef.current.generation === requestGeneration) setAddingGroupId(null);
      }
    },
    [
      canManageMembers,
      explicitMemberAccessLevel,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
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

      const accessLevel = role === SpaceMemberRole.Owner ? AccessLevel.FullAccess : explicitMemberAccessLevel;
      const requestGeneration = spaceRequestRef.current.generation;

      if (!setMemberMutationPending(member.uid, true)) return;
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

        if (spaceRequestRef.current.generation !== requestGeneration) return;
        await refreshSpaceMembers();
      } catch (error) {
        if (spaceRequestRef.current.generation === requestGeneration) {
          toast.error(manageSpaceErrorMessage(error, t('space.permissionManager.updateSpaceMemberFailed'), t));
        }
      } finally {
        if (spaceRequestRef.current.generation === requestGeneration) {
          setMemberMutationPending(member.uid, false);
        }
      }
    },
    [
      canManageMembers,
      explicitMemberAccessLevel,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
      refreshSpaceMembers,
      setMemberMutationPending,
      t,
      viewId,
      workspaceId,
    ]
  );

  const handleRemoveMember = useCallback(
    async (member: SpaceMember) => {
      if (
        !isMutableSpaceMember(member) ||
        membersReadOnly ||
        !permissionLoaded ||
        permissionLoadFailed ||
        !canManageMembers ||
        !workspaceId
      ) {
        return;
      }

      const requestGeneration = spaceRequestRef.current.generation;

      if (!setMemberMutationPending(member.uid, true)) return;
      try {
        await WorkspaceService.removeSpaceMember(workspaceId, viewId, member.uid);
        if (spaceRequestRef.current.generation !== requestGeneration) return;
        await refreshSpaceMembers();
        if (spaceRequestRef.current.generation !== requestGeneration) return;
        toast.success(t('space.permissionManager.removeSpaceMemberSuccess'));
      } catch (error) {
        if (spaceRequestRef.current.generation === requestGeneration) {
          toast.error(manageSpaceErrorMessage(error, t('space.permissionManager.removeSpaceMemberFailed'), t));
        }
      } finally {
        if (spaceRequestRef.current.generation === requestGeneration) {
          setMemberMutationPending(member.uid, false);
        }
      }
    },
    [
      canManageMembers,
      membersReadOnly,
      permissionLoadFailed,
      permissionLoaded,
      refreshSpaceMembers,
      setMemberMutationPending,
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

  const commitGroupRole = useCallback(
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
      const accessLevel = role === SpaceMemberRole.Owner ? AccessLevel.FullAccess : explicitMemberAccessLevel;

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
      explicitMemberAccessLevel,
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

  // Making a whole group Space owners hands everyone in it management rights,
  // so it is confirmed first.
  const handleUpdateGroupRole = useCallback(
    (group: WorkspaceGroupSpacePermission, role: SpaceMemberRole) => {
      if (group.role === role) return;
      if (role === SpaceMemberRole.Owner) {
        setPendingConfirmation({ kind: 'group-owner', group });
        return;
      }

      void commitGroupRole(group, role);
    },
    [commitGroupRole]
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

  const closeConfirmation = useCallback(() => setPendingConfirmation(null), []);

  const confirmPending = useCallback(() => {
    if (!pendingConfirmation) return;
    setPendingConfirmation(null);
    switch (pendingConfirmation.kind) {
      case 'visibility': {
        const nextPermission = applyVisibility(permissionSettings, loadedPermissionSettings, pendingConfirmation.target);

        void persistPermission(nextPermission);
        break;
      }

      case 'full-access':
        persistPermissionPatch(
          pendingConfirmation.audience === 'everyone-else'
            ? { everyone_else_access_level: AccessLevel.FullAccess }
            : { member_default_access_level: AccessLevel.FullAccess }
        );
        break;
      case 'group-owner':
        void commitGroupRole(pendingConfirmation.group, SpaceMemberRole.Owner);
        break;
    }
  }, [
    commitGroupRole,
    loadedPermissionSettings,
    pendingConfirmation,
    permissionSettings,
    persistPermission,
    persistPermissionPatch,
  ]);

  const handleSpaceNameBlur = useCallback(() => {
    const trimmedName = spaceName.trim();

    if (!trimmedName) {
      toast.error(t('space.spaceNameCannotBeEmpty'));
      setSpaceName(loadedSpaceMetadataRef.current.name);
      return;
    }

    setSpaceName(trimmedName);
    void persistMetadata({ name: trimmedName });
  }, [persistMetadata, spaceName, t]);

  const handleSpaceNameKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  }, []);

  const handleSpaceIconChange = useCallback(
    (icon: string, color: string) => {
      setSpaceIcon(icon);
      setSpaceIconColor(color);
      void persistMetadata({ space_icon: icon, space_icon_color: color });
    },
    [persistMetadata]
  );

  const handleSpaceNameInputRef = useCallback((input: HTMLInputElement | null) => {
    if (!input || inputRef.current) return;
    setTimeout(() => {
      input.setSelectionRange(0, input.value.length);
    }, 100);
    inputRef.current = input;
  }, []);

  const currentWorkspace = useMemo(() => {
    const workspaces = userWorkspaceInfo?.workspaces ?? [];

    return workspaces.find((workspace) => workspace.id === workspaceId) ?? userWorkspaceInfo?.selectedWorkspace;
  }, [userWorkspaceInfo, workspaceId]);
  const workspaceName = currentWorkspace?.name?.trim() || '';
  const privateOwner = useMemo(
    () => ({
      name: currentUser?.name,
      email: currentUser?.email,
      avatar: currentUser?.avatar,
      workspaceRole: currentWorkspace?.role,
    }),
    [currentUser?.avatar, currentUser?.email, currentUser?.name, currentWorkspace?.role]
  );

  if (!view) return null;

  const metadataDisabled = loadingSettings || !permissionLoaded || permissionLoadFailed || !canEditSidebar;
  const permissionSettingsDisabled =
    saving || loadingSettings || !permissionLoaded || permissionLoadFailed || !canManageSpace;
  const membersDisabled =
    membersReadOnly ||
    loadingMembers ||
    !permissionLoaded ||
    permissionLoadFailed ||
    !spaceMembersLoaded ||
    !canManageMembers;
  const addMembersDisabled = membersReadOnly || !permissionLoaded || permissionLoadFailed || !canInviteMembers;
  const addGroupsDisabled = membersReadOnly || !permissionLoaded || permissionLoadFailed || !canManageMembers;
  const draftVisibility = permissionSettings.visibility;
  const draftIsPrivate = isPrivateSpaceVisibility(draftVisibility);
  const activeTab: ManageSpaceTab = tab;
  const confirmationCopy = pendingConfirmation ? confirmationTexts(pendingConfirmation, permissionSettings, t) : null;
  const membersHaveNoAccess =
    loadedPermissionSettings?.visibility === SpaceVisibility.Custom &&
    loadedPermissionSettings.member_default_access_level === null;

  return (
    <SpaceSettingsPanel
      open={open}
      onClose={onClose}
      title={t('space.manage')}
      modalTestId='manage-space-modal'
      activeTab={activeTab}
      onTabChange={handleTabChange}
      membersTabVisible={draftIsPrivate || !legacyPermissionMode}
      membersTabDisabled={saving}
      spaceName={spaceName}
      spaceIcon={spaceIcon}
      spaceIconColor={spaceIconColor}
      nameInputRef={handleSpaceNameInputRef}
      metadataDisabled={metadataDisabled}
      onSpaceNameChange={setSpaceName}
      onSpaceNameBlur={handleSpaceNameBlur}
      onSpaceNameKeyDown={handleSpaceNameKeyDown}
      onSpaceIconChange={handleSpaceIconChange}
      permissionSettings={permissionSettings}
      visibilityOptions={legacyPermissionMode ? LEGACY_SPACE_VISIBILITIES : SELECTABLE_SPACE_VISIBILITIES}
      permissionSettingsDisabled={permissionSettingsDisabled}
      loadingSettings={loadingSettings}
      showAccessDetails={draftIsPrivate || !legacyPermissionMode}
      workspaceName={workspaceName}
      privateOwner={privateOwner}
      onVisibilitySelect={requestVisibilityChange}
      onMembersAccessChange={handleMembersAccessChange}
      onEveryoneElseAccessChange={handleEveryoneElseAccessChange}
      showActions={false}
      membersContent={
        <div className='appflowy-scroller max-h-[64vh] overflow-y-auto py-2 pr-1'>
          <div className='flex flex-col gap-4'>
            {!membersReadOnly && (
              <>
                <WorkspaceMemberInlineSearch
                  search={memberSearch}
                  onSearchChange={setMemberSearch}
                  addableMembers={addableWorkspaceMembers}
                  searchPlaceholder={t('space.permissionManager.searchPeopleOrGroups')}
                  addButtonLabel={t('space.permissionManager.addPeopleOrGroups')}
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

                {addableWorkspaceGroups.length > 0 && (
                  <div className='flex flex-col gap-2 border-t border-border-primary pt-4'>
                    <div className='text-sm font-medium text-text-secondary'>
                      {t('space.permissionManager.groupsNotInSpace')}
                    </div>
                    <div className='flex flex-col'>
                      {addableWorkspaceGroups.map((group) => (
                        <div
                          key={group.group_id}
                          className='flex items-center gap-3 rounded-300 px-2 py-2 hover:bg-fill-content-hover'
                          data-testid={`space-group-inline-search-result-${group.group_id}`}
                        >
                          <Avatar size='md'>
                            <AvatarFallback name={group.name}>{group.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className='min-w-0 flex-1'>
                            <div className='truncate text-sm font-medium text-text-primary'>{group.name}</div>
                            <div className='truncate text-xs text-text-secondary'>
                              {t('space.permissionManager.groupInfo', { count: group.member_count })}
                            </div>
                          </div>
                          <Button
                            type='button'
                            size='sm'
                            variant='ghost'
                            aria-label={`${t('space.permissionManager.add')} ${group.name}`}
                            className='text-text-action hover:text-text-action-hover'
                            disabled={addGroupsDisabled || Boolean(addingGroupId)}
                            loading={addingGroupId === group.group_id}
                            onClick={() => void handleAddGroup(group)}
                            data-testid='space-group-inline-search-result-add'
                          >
                            <Plus aria-hidden='true' className='h-4 w-4' />
                            {t('space.permissionManager.add')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
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

                {membersHaveNoAccess && (
                  <div
                    className='rounded-300 bg-fill-content-hover px-3 py-2 text-xs text-text-secondary'
                    data-testid='manage-space-members-no-access-hint'
                  >
                    {t('space.permissionManager.noAccessMembersHint')}
                  </div>
                )}

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
                    {visibleSpaceMembers.map((member) => (
                      <SpaceMemberRowItem
                        key={`${member.uid}-${member.source}`}
                        member={member}
                        readOnly={membersReadOnly}
                        disabled={membersDisabled || mutatingMemberUids.has(member.uid)}
                        canRemove={!membersReadOnly && canManageMembers && isMutableSpaceMember(member)}
                        onChangeRole={handleUpdateMemberRole}
                        onRemove={handleRemoveMember}
                      />
                    ))}
                    {visibleSpaceGroups.map((group) => (
                      <SpaceGroupRowItem
                        key={`group:${group.group_id}`}
                        group={group}
                        readOnly={membersReadOnly}
                        disabled={membersDisabled || mutatingGroupIds.has(group.group_id)}
                        canRemove={!membersReadOnly && canManageMembers}
                        onChangeRole={handleUpdateGroupRole}
                        onRemove={handleRemoveGroup}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      }
      overlay={
        confirmationCopy ? (
          <ManageSpaceConfirmModal
            open
            title={confirmationCopy.title}
            description={confirmationCopy.description}
            confirmText={confirmationCopy.confirmText}
            danger={confirmationCopy.danger}
            onConfirm={confirmPending}
            onClose={closeConfirmation}
          />
        ) : null
      }
    />
  );
}

function confirmationTexts(
  confirmation: PendingConfirmation,
  current: SpacePermissionSettings,
  t: TFunction
): { title: string; description: string; confirmText: string; danger: boolean } {
  switch (confirmation.kind) {
    case 'visibility':
      switch (confirmation.target) {
        case SpaceVisibility.Custom:
          return current.visibility === SpaceVisibility.Private
            ? {
                title: t('space.permissionManager.confirmToCustomTitle'),
                description: t('space.permissionManager.confirmPrivateToCustomDescription'),
                confirmText: t('space.permissionManager.confirmPrivateToCustomAction'),
                danger: false,
              }
            : {
                title: t('space.permissionManager.confirmToCustomTitle'),
                description: t('space.permissionManager.confirmPublicToCustomDescription'),
                confirmText: t('space.permissionManager.confirmPublicToCustomAction'),
                danger: false,
              };
        case SpaceVisibility.Private:
          return {
            title: t('space.permissionManager.confirmToPrivateTitle'),
            description: t('space.permissionManager.confirmToPrivateDescription'),
            confirmText: t('space.permissionManager.confirmToPrivateAction'),
            danger: true,
          };
        case SpaceVisibility.Public:
        default:
          return {
            title: t('space.permissionManager.confirmToPublicTitle'),
            description: t('space.permissionManager.confirmToPublicDescription'),
            confirmText: t('space.permissionManager.confirmToPublicAction'),
            danger: false,
          };
      }

    case 'full-access':
      switch (confirmation.audience) {
        case 'everyone-else':
          return {
            title: t('space.permissionManager.fullAccessEveryoneElseTitle'),
            description: t('space.permissionManager.fullAccessEveryoneElseDescription'),
            confirmText: t('space.permissionManager.grantFullAccess'),
            danger: true,
          };
        case 'workspace-members':
          return {
            title: t('space.permissionManager.fullAccessWorkspaceMembersTitle'),
            description: t('space.permissionManager.fullAccessWorkspaceMembersDescription'),
            confirmText: t('space.permissionManager.grantFullAccess'),
            danger: true,
          };
        case 'space-members':
        default:
          return {
            title: t('space.permissionManager.fullAccessMembersTitle'),
            description: t('space.permissionManager.fullAccessMembersDescription'),
            confirmText: t('space.permissionManager.grantFullAccess'),
            danger: true,
          };
      }

    case 'group-owner':
    default:
      return {
        title: t('space.permissionManager.groupOwnerTitle'),
        description: t('space.permissionManager.groupOwnerDescription'),
        confirmText: t('space.permissionManager.groupOwnerAction'),
        danger: true,
      };
  }
}

const SpaceMemberRowItem = memo(function SpaceMemberRowItem({
  member,
  readOnly,
  disabled,
  canRemove,
  onChangeRole,
  onRemove,
}: {
  member: SpaceMember;
  readOnly: boolean;
  disabled: boolean;
  canRemove: boolean;
  onChangeRole: (member: SpaceMember, role: SpaceMemberRole) => Promise<void>;
  onRemove: (member: SpaceMember) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-testid={`space-member-row-${member.uid}`}
      className='grid items-center gap-3 border-b border-border-primary py-3'
      style={{ gridTemplateColumns: MEMBER_GRID_COLUMNS }}
    >
      <div className='flex min-w-0 items-center gap-3'>
        <Avatar size='md'>
          <AvatarFallback name={displayNameForMember(member, t)}>{memberInitial(member, t)}</AvatarFallback>
        </Avatar>
        <div className='min-w-0'>
          <div className='truncate font-medium text-text-primary'>{displayNameForMember(member, t)}</div>
          <div className='truncate text-sm text-text-secondary' data-testid='space-member-subtitle'>
            {memberSubtitle(member, t)}
          </div>
        </div>
      </div>

      <div className='flex justify-end'>
        <RoleDropdown
          value={member.role}
          readOnly={readOnly}
          disabled={disabled}
          canRemove={canRemove}
          onChange={(role) => void onChangeRole(member, role)}
          onRemove={() => void onRemove(member)}
        />
      </div>
    </div>
  );
});

const SpaceGroupRowItem = memo(function SpaceGroupRowItem({
  group,
  readOnly,
  disabled,
  canRemove,
  onChangeRole,
  onRemove,
}: {
  group: WorkspaceGroupSpacePermission;
  readOnly: boolean;
  disabled: boolean;
  canRemove: boolean;
  onChangeRole: (group: WorkspaceGroupSpacePermission, role: SpaceMemberRole) => void;
  onRemove: (group: WorkspaceGroupSpacePermission) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-testid={`space-group-row-${group.group_id}`}
      className='grid items-center gap-3 border-b border-border-primary py-3'
      style={{ gridTemplateColumns: MEMBER_GRID_COLUMNS }}
    >
      <div className='flex min-w-0 items-center gap-3'>
        <Avatar size='md'>
          <AvatarFallback name={group.name}>{group.name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className='min-w-0'>
          <div className='truncate font-medium text-text-primary'>{group.name}</div>
          <div className='truncate text-sm text-text-secondary' data-testid='space-group-subtitle'>
            {t('space.permissionManager.groupInfo', { count: group.member_count })}
          </div>
        </div>
      </div>

      <div className='flex justify-end'>
        <RoleDropdown
          value={group.role}
          readOnly={readOnly}
          disabled={disabled}
          canRemove={canRemove}
          onChange={(role) => onChangeRole(group, role)}
          onRemove={() => void onRemove(group)}
        />
      </div>
    </div>
  );
});

export default ManageSpace;
