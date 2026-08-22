import { Check, ChevronDown, Globe2, LockKeyhole, Plus, Settings2, Shield, UserRound, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import {
  AccessLevel,
  legacySpacePermission,
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
import SpaceIconButton from '@/components/app/view-actions/SpaceIconButton';
import {
  defaultEveryoneElseAccessLevel,
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

import type { TFunction } from 'i18next';
import type { KeyboardEvent, ReactNode } from 'react';

type ManageSpaceTab = 'general' | 'members';

// Collective access for the explicit members of a private space.
const PRIVATE_MEMBER_ACCESS_OPTIONS: readonly AccessLevel[] = [
  AccessLevel.FullAccess,
  AccessLevel.ReadAndWrite,
  AccessLevel.ReadAndComment,
  AccessLevel.ReadOnly,
];
// Public access card: what every other workspace member can do.
const PUBLIC_MEMBER_ACCESS_OPTIONS: readonly AccessLevel[] = [
  AccessLevel.FullAccess,
  AccessLevel.ReadAndWrite,
  AccessLevel.ReadOnly,
];
// Custom permissions card: both audiences may also be locked out entirely.
const CUSTOM_ACCESS_OPTIONS: readonly (AccessLevel | null)[] = [
  AccessLevel.FullAccess,
  AccessLevel.ReadAndWrite,
  AccessLevel.ReadOnly,
  null,
];

const INHERITED_MEMBER_SOURCES = new Set(['workspace_default', 'page_share']);
const LAST_EXPLICIT_OWNER_ERROR = 'space must keep at least one explicit owner';
const MODAL_WIDTH = 680;
const CONTENT_WIDTH = 640;
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
  // Keep whatever visibility the server returned, including values this
  // client does not know yet, so a save never rewrites it behind the user.
  const visibility = permission.visibility ?? fallback.visibility;

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

function equalPermissionSettings(left: SpacePermissionSettings, right: SpacePermissionSettings): boolean {
  return (
    left.visibility === right.visibility &&
    left.owner_access_level === right.owner_access_level &&
    left.member_default_access_level === right.member_default_access_level &&
    (left.everyone_else_access_level ?? null) === (right.everyone_else_access_level ?? null) &&
    left.invite_policy === right.invite_policy &&
    left.sidebar_edit_policy === right.sidebar_edit_policy &&
    left.invite_link_enabled === right.invite_link_enabled &&
    left.security.disable_guests === right.security.disable_guests &&
    left.security.disable_public_links === right.security.disable_public_links &&
    left.security.disable_export === right.security.disable_export
  );
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
    return {
      ...current,
      visibility: target,
      member_default_access_level: current.member_default_access_level ?? AccessLevel.ReadAndWrite,
      everyone_else_access_level:
        loaded?.visibility === SpaceVisibility.Custom
          ? (current.everyone_else_access_level ?? loaded.everyone_else_access_level ?? null)
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
      settings.visibility === SpaceVisibility.Custom ? (settings.everyone_else_access_level ?? null) : null,
  };
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

function VisibilityIcon({ visibility, className }: { visibility: SpaceVisibility; className?: string }) {
  const resolvedClassName = cn('h-5 w-5 text-icon-primary', className);

  switch (visibility) {
    case SpaceVisibility.Private:
      return <LockKeyhole className={resolvedClassName} />;
    case SpaceVisibility.Custom:
      return <Settings2 className={resolvedClassName} />;
    case SpaceVisibility.Public:
    default:
      return <Globe2 className={resolvedClassName} />;
  }
}

function AccessDropdown({
  value,
  options,
  disabled,
  testId,
  onChange,
}: {
  value: AccessLevel | null | undefined;
  options: readonly (AccessLevel | null)[];
  disabled?: boolean;
  testId?: string;
  onChange: (value: AccessLevel | null) => void;
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
          className='min-w-[120px] justify-end px-2 text-text-primary'
          data-testid={testId}
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
            data-testid={testId ? `${testId}-option-${option ?? 'none'}` : undefined}
          >
            {accessLabel(option, t)}
            {option === (value ?? null) && <DropdownMenuItemTick />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FixedAccess({ label }: { label: string }) {
  return (
    <div className='flex min-w-[120px] items-center justify-end gap-2 px-2'>
      <span className='text-sm text-text-secondary'>{label}</span>
      <ChevronDown className='h-4 w-4 opacity-0' aria-hidden />
    </div>
  );
}

function VisibilityCards({
  value,
  options,
  disabled,
  onSelect,
}: {
  value: SpaceVisibility;
  options: readonly SpaceVisibility[];
  disabled?: boolean;
  onSelect: (value: SpaceVisibility) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role='group'
      aria-label={t('space.permissionManager.spaceAccess')}
      className='grid gap-3'
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      data-testid='manage-space-visibility-options'
    >
      {options.map((option) => {
        const selected = option === value;

        // The selected card (the current type, or the pending one before Save)
        // is unmistakable: accent border, tinted background and a check mark.
        return (
          <button
            key={option}
            type='button'
            aria-pressed={selected}
            disabled={disabled}
            data-testid={`manage-space-visibility-option-${option}`}
            data-selected={selected ? 'true' : 'false'}
            onClick={() => onSelect(option)}
            className={cn(
              'relative flex min-h-[96px] flex-col items-start gap-2 rounded-400 border px-3 py-3 pr-8 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-theme-thick',
              'disabled:cursor-not-allowed disabled:opacity-60',
              selected
                ? 'border-border-theme-thick bg-fill-theme-select ring-1 ring-border-theme-thick hover:bg-fill-theme-select'
                : 'border-border-primary hover:bg-fill-content-hover'
            )}
          >
            {selected && (
              <span
                className='absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-fill-theme-thick text-text-on-fill'
                data-testid='manage-space-visibility-selected-check'
              >
                <Check className='h-3.5 w-3.5' aria-hidden />
              </span>
            )}
            <div className='flex w-full items-center gap-2'>
              <VisibilityIcon visibility={option} className='h-4 w-4' />
              <span className='font-medium text-text-primary'>{spaceVisibilityLabel(option, t)}</span>
            </div>
            <span className='text-xs leading-4 text-text-secondary'>{spaceVisibilityDescription(option, t)}</span>
          </button>
        );
      })}
    </div>
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
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceGroup[]>([]);
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
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
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
    setWorkspaceGroups([]);
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
    setWorkspaceGroups([]);
    setMutatingGroupIds(new Set());
    setMemberSearch('');
    setPendingConfirmation(null);
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
        shouldLoadWorkspacePrincipals =
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
          setWorkspaceGroups([]);
          if (!useLegacyManagement) {
            toast.error(getErrorMessage(error, t('space.permissionManager.loadSpaceSettingsFailed')));
          }
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

  const commitVisibility = useCallback(
    (target: SpaceVisibility) => {
      setPermissionSettings((current) => applyVisibility(current, loadedPermissionSettings, target));
    },
    [loadedPermissionSettings]
  );

  // Switching the space type is confirmed up front (PRD: every permission
  // impacting switch asks first); the draft only changes after the user
  // agrees, and nothing is persisted until Save. Going back to the type the
  // server already holds just restores the draft without asking.
  const requestVisibilityChange = useCallback(
    (target: SpaceVisibility) => {
      if (target === permissionSettings.visibility) return;
      if (loadedPermissionSettings && target === loadedPermissionSettings.visibility) {
        commitVisibility(target);
        return;
      }

      setPendingConfirmation({ kind: 'visibility', target });
    },
    [commitVisibility, loadedPermissionSettings, permissionSettings.visibility]
  );

  // Full access carries space-management rights, so granting it to a whole
  // audience is confirmed before it lands in the draft.
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

      updatePermission({ [field]: value });
    },
    [permissionSettings, updatePermission]
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
        // The structured update is the single source of truth: the server
        // keeps the legacy public/private marker in step and applies the
        // roster transition (materialize / tombstone) that the type switch
        // implies, so no compatibility write precedes it.
        const permissionChanged =
          canManageSpace &&
          loadedPermissionSettings !== null &&
          !equalPermissionSettings(permissionSettings, loadedPermissionSettings);

        await WorkspaceService.updateStructuredSpace(workspaceId, viewId, {
          name: trimmedName,
          space_icon: spaceIcon,
          space_icon_color: spaceIconColor,
          ...(permissionChanged ? { permission: permissionSettingsForSave(permissionSettings) } : {}),
        });
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
  // not the unsaved draft, and on Public specifically: a custom space lists
  // explicit people and groups that managers add and remove freely.
  const membersReadOnly = loadedPermissionSettings?.visibility === SpaceVisibility.Public;
  const implicitMembersRemovable = loadedPermissionSettings?.visibility === SpaceVisibility.Custom;
  // Explicit members receive the collective member level; the per-member value
  // only matters on servers that still honour it.
  const explicitMemberAccessLevel = permissionSettings.member_default_access_level ?? AccessLevel.ReadOnly;

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
          access_level: explicitMemberAccessLevel,
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
      case 'visibility':
        commitVisibility(pendingConfirmation.target);
        break;
      case 'full-access':
        updatePermission(
          pendingConfirmation.audience === 'everyone-else'
            ? { everyone_else_access_level: AccessLevel.FullAccess }
            : { member_default_access_level: AccessLevel.FullAccess }
        );
        break;
      case 'group-owner':
        void commitGroupRole(pendingConfirmation.group, SpaceMemberRole.Owner);
        break;
    }
  }, [commitGroupRole, commitVisibility, pendingConfirmation, updatePermission]);

  const workspaceName = useMemo(() => {
    const workspaces = userWorkspaceInfo?.workspaces ?? [];
    const current = workspaces.find((workspace) => workspace.id === workspaceId) ?? userWorkspaceInfo?.selectedWorkspace;

    return current?.name?.trim() || '';
  }, [userWorkspaceInfo, workspaceId]);

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
  const addGroupsDisabled = membersReadOnly || !permissionLoaded || permissionLoadFailed || !canManageMembers;
  const draftVisibility = permissionSettings.visibility;
  const draftIsCustom = draftVisibility === SpaceVisibility.Custom;
  const draftIsPublic = draftVisibility === SpaceVisibility.Public;
  const draftIsPrivate = isPrivateSpaceVisibility(draftVisibility);
  const confirmationCopy = pendingConfirmation ? confirmationTexts(pendingConfirmation, loadedPermissionSettings, t) : null;
  const membersHaveNoAccess =
    loadedPermissionSettings?.visibility === SpaceVisibility.Custom &&
    loadedPermissionSettings.member_default_access_level === null;

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
      okButtonProps={{ disabled: metadataDisabled || saving, 'data-testid': 'manage-space-save' }}
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

                <VisibilityCards
                  value={draftVisibility}
                  // The legacy editor can only persist the binary marker, so
                  // it must not offer a visibility that would be downgraded.
                  options={legacyPermissionMode ? LEGACY_SPACE_VISIBILITIES : SELECTABLE_SPACE_VISIBILITIES}
                  disabled={permissionSettingsDisabled}
                  onSelect={requestVisibilityChange}
                />
              </section>

              {!legacyPermissionMode && draftIsPublic && (
                <PublicAccessCard
                  membersAccessLevel={permissionSettings.member_default_access_level}
                  disabled={permissionSettingsDisabled}
                  onMembersAccessChange={(value) => requestCollectiveAccessChange('member_default_access_level', value)}
                  onSwitchToCustom={() => requestVisibilityChange(SpaceVisibility.Custom)}
                />
              )}

              {!legacyPermissionMode && draftIsCustom && (
                <CustomPermissionsCard
                  workspaceName={workspaceName}
                  membersAccessLevel={permissionSettings.member_default_access_level}
                  everyoneElseAccessLevel={permissionSettings.everyone_else_access_level ?? null}
                  disabled={permissionSettingsDisabled}
                  onMembersAccessChange={(value) => requestCollectiveAccessChange('member_default_access_level', value)}
                  onEveryoneElseAccessChange={(value) =>
                    requestCollectiveAccessChange('everyone_else_access_level', value)
                  }
                />
              )}

              {!legacyPermissionMode && !draftIsPublic && !draftIsCustom && (
                <div className='rounded-400 border border-border-primary' data-testid='manage-space-private-access-card'>
                  <PermissionPrincipalRow
                    icon={<Shield className='h-5 w-5 text-icon-primary' />}
                    title={t('space.permissionManager.owners')}
                    description={t('space.permissionManager.ownersDescription')}
                    trailing={<FixedAccess label={t('shareAction.fullAccess')} />}
                  />

                  <PermissionPrincipalRow
                    icon={<Users className='h-5 w-5 text-icon-primary' />}
                    title={t('space.permissionManager.members')}
                    description={
                      draftIsPrivate
                        ? t('space.permissionManager.membersDescription')
                        : t('space.permissionManager.publicMembersDescription')
                    }
                    testId='manage-space-members-default-access-row'
                    trailing={
                      <AccessDropdown
                        value={permissionSettings.member_default_access_level}
                        options={PRIVATE_MEMBER_ACCESS_OPTIONS}
                        disabled={permissionSettingsDisabled}
                        testId='manage-space-members-default-access'
                        onChange={(value) => {
                          if (value !== null) requestCollectiveAccessChange('member_default_access_level', value);
                        }}
                      />
                    }
                    last
                  />
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {!legacyPermissionMode && (
          <TabsContent value='members' className='min-h-0'>
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
                                  <div
                                    className='truncate text-sm text-text-secondary'
                                    data-testid='space-member-subtitle'
                                  >
                                    {memberSubtitle(member, t)}
                                  </div>
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
                                <div className='truncate font-medium text-text-primary'>{group.name}</div>
                                <div className='truncate text-sm text-text-secondary' data-testid='space-group-subtitle'>
                                  {t('space.permissionManager.groupInfo', { count: group.member_count })}
                                </div>
                              </div>
                            </div>

                            <div className='flex justify-end'>
                              <RoleDropdown
                                value={group.role}
                                readOnly={membersReadOnly}
                                disabled={membersDisabled || mutatingGroupIds.has(group.group_id)}
                                canRemove={!membersReadOnly && canManageMembers}
                                onChange={(role) => handleUpdateGroupRole(group, role)}
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

      {confirmationCopy && (
        <ManageSpaceConfirmModal
          open
          title={confirmationCopy.title}
          description={confirmationCopy.description}
          confirmText={confirmationCopy.confirmText}
          danger={confirmationCopy.danger}
          onConfirm={confirmPending}
          onClose={closeConfirmation}
        />
      )}
    </NormalModal>
  );
}

function confirmationTexts(
  confirmation: PendingConfirmation,
  loaded: SpacePermissionSettings | null,
  t: TFunction
): { title: string; description: string; confirmText: string; danger: boolean } {
  switch (confirmation.kind) {
    case 'visibility':
      switch (confirmation.target) {
        case SpaceVisibility.Custom:
          return loaded?.visibility === SpaceVisibility.Private
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

function PublicAccessCard({
  membersAccessLevel,
  disabled,
  onMembersAccessChange,
  onSwitchToCustom,
}: {
  membersAccessLevel: AccessLevel | null;
  disabled: boolean;
  onMembersAccessChange: (value: AccessLevel | null) => void;
  onSwitchToCustom: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className='flex flex-col gap-3' data-testid='manage-space-public-access-card'>
      <div className='rounded-400 border border-border-primary'>
        <div className='flex flex-col gap-1 border-b border-border-primary px-4 py-3'>
          <div className='font-medium text-text-primary'>{t('space.permissionManager.publicAccessTitle')}</div>
          <div className='text-sm text-text-secondary'>{t('space.permissionManager.publicAccessDescription')}</div>
        </div>
        <div
          className='grid items-center gap-3 border-b border-border-primary px-4 py-2 text-xs font-medium text-text-tertiary'
          style={{ gridTemplateColumns: 'minmax(0, 1fr) 160px' }}
        >
          <span>{t('space.permissionManager.who')}</span>
          <span className='text-right'>{t('space.permissionManager.access')}</span>
        </div>
        <PermissionPrincipalRow
          icon={<Shield className='h-5 w-5 text-icon-primary' />}
          title={t('space.permissionManager.workspaceOwners')}
          description={t('space.permissionManager.workspaceOwnersDescription')}
          testId='manage-space-workspace-owners-row'
          trailing={<FixedAccess label={t('shareAction.fullAccess')} />}
        />
        <PermissionPrincipalRow
          icon={<Users className='h-5 w-5 text-icon-primary' />}
          title={t('space.permissionManager.workspaceMembers')}
          description={t('space.permissionManager.workspaceMembersDescription')}
          testId='manage-space-workspace-members-row'
          trailing={
            <AccessDropdown
              value={membersAccessLevel}
              options={PUBLIC_MEMBER_ACCESS_OPTIONS}
              disabled={disabled}
              testId='manage-space-workspace-members-access'
              onChange={onMembersAccessChange}
            />
          }
          last
        />
      </div>

      <div
        className='flex flex-wrap items-center justify-between gap-3 rounded-400 bg-fill-content-hover px-4 py-3'
        data-testid='manage-space-switch-to-custom-banner'
      >
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <div className='text-sm font-medium text-text-primary'>{t('space.permissionManager.switchToCustomTitle')}</div>
          <div className='text-xs text-text-secondary'>{t('space.permissionManager.switchToCustomDescription')}</div>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          onClick={onSwitchToCustom}
          data-testid='manage-space-switch-to-custom'
        >
          {t('space.permissionManager.switchToCustom')}
        </Button>
      </div>
    </section>
  );
}

function CustomPermissionsCard({
  workspaceName,
  membersAccessLevel,
  everyoneElseAccessLevel,
  disabled,
  onMembersAccessChange,
  onEveryoneElseAccessChange,
}: {
  workspaceName: string;
  membersAccessLevel: AccessLevel | null;
  everyoneElseAccessLevel: AccessLevel | null;
  disabled: boolean;
  onMembersAccessChange: (value: AccessLevel | null) => void;
  onEveryoneElseAccessChange: (value: AccessLevel | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className='rounded-400 border border-border-primary' data-testid='manage-space-custom-permissions-card'>
      <div className='flex flex-col gap-1 border-b border-border-primary px-4 py-3'>
        <div className='font-medium text-text-primary'>{t('space.permissionManager.customPermissionsTitle')}</div>
        <div className='text-sm text-text-secondary'>{t('space.permissionManager.customPermissionsDescription')}</div>
      </div>
      <PermissionPrincipalRow
        icon={<Shield className='h-5 w-5 text-icon-primary' />}
        title={t('space.permissionManager.owners')}
        description={t('space.permissionManager.ownersDescription')}
        testId='manage-space-custom-owners-row'
        trailing={<FixedAccess label={t('shareAction.fullAccess')} />}
      />
      <PermissionPrincipalRow
        icon={<Users className='h-5 w-5 text-icon-primary' />}
        title={t('space.permissionManager.members')}
        description={t('space.permissionManager.customMembersDescription')}
        testId='manage-space-custom-members-row'
        trailing={
          <AccessDropdown
            value={membersAccessLevel}
            options={CUSTOM_ACCESS_OPTIONS}
            disabled={disabled}
            testId='manage-space-custom-members-access'
            onChange={onMembersAccessChange}
          />
        }
      />
      <PermissionPrincipalRow
        icon={<UserRound className='h-5 w-5 text-icon-primary' />}
        title={
          workspaceName
            ? t('space.permissionManager.everyoneElse', { workspace: workspaceName })
            : t('space.permissionManager.everyoneElseFallback')
        }
        description={t('space.permissionManager.everyoneElseDescription')}
        testId='manage-space-everyone-else-row'
        trailing={
          <AccessDropdown
            value={everyoneElseAccessLevel}
            options={CUSTOM_ACCESS_OPTIONS}
            disabled={disabled}
            testId='manage-space-everyone-else-access'
            onChange={onEveryoneElseAccessChange}
          />
        }
        last
      />
    </section>
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
  icon: ReactNode;
  title: string;
  description: string;
  trailing: ReactNode;
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
