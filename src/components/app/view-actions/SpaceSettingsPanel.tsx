import { Check, ChevronDown, FilePlus2, Globe2, LockKeyhole, Settings2, Shield, UserRound, Users } from 'lucide-react';
import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AccessLevel, Role, SpacePermissionSettings, SpaceSidebarEditPolicy, SpaceVisibility } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import SpaceIconButton from '@/components/app/view-actions/SpaceIconButton';
import { spaceMemberAccessLabel } from '@/components/app/view-actions/SpaceMemberAccessControl';
import { spaceVisibilityDescription, spaceVisibilityLabel } from '@/components/app/view-actions/spaceVisibilityOptions';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import type { TFunction } from 'i18next';
import type { FocusEventHandler, KeyboardEventHandler, ReactNode, Ref } from 'react';

const FALLBACK_MEMBER_ACCESS_OPTIONS: readonly AccessLevel[] = [
  AccessLevel.FullAccess,
  AccessLevel.ReadAndWrite,
  AccessLevel.ReadAndComment,
  AccessLevel.ReadOnly,
];
const PUBLIC_MEMBER_ACCESS_OPTIONS: readonly AccessLevel[] = [
  AccessLevel.FullAccess,
  AccessLevel.ReadAndWrite,
  AccessLevel.ReadOnly,
];
const CUSTOM_ACCESS_OPTIONS: readonly (AccessLevel | null)[] = [
  AccessLevel.FullAccess,
  AccessLevel.ReadAndWrite,
  AccessLevel.ReadAndComment,
  AccessLevel.ReadOnly,
  null,
];

const SIDEBAR_EDIT_POLICY_OPTIONS: readonly SpaceSidebarEditPolicy[] = [
  SpaceSidebarEditPolicy.OwnersOnly,
  SpaceSidebarEditPolicy.MembersAndOwners,
];

const MODAL_WIDTH = 680;
const CONTENT_WIDTH = 640;
/** Every button in the panel shows where keyboard focus is (the shared Button has no focus style). */
const BUTTON_FOCUS_RING =
  '[&_button:focus-visible]:outline-none [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-border-theme-thick';

export type SpaceSettingsTab = 'general' | 'members';

export interface SpaceSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  modalTestId: string;
  activeTab: SpaceSettingsTab;
  onTabChange: (value: SpaceSettingsTab) => void;
  membersTabVisible: boolean;
  membersTabDisabled?: boolean;
  membersContent?: ReactNode;
  spaceName: string;
  spaceIcon: string;
  spaceIconColor: string;
  nameInputRef?: Ref<HTMLInputElement>;
  metadataDisabled?: boolean;
  onSpaceNameChange: (value: string) => void;
  onSpaceNameBlur?: FocusEventHandler<HTMLInputElement>;
  onSpaceNameKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onSpaceIconChange: (icon: string, color: string) => void;
  permissionSettings: SpacePermissionSettings;
  visibilityOptions: readonly SpaceVisibility[];
  permissionSettingsDisabled?: boolean;
  loadingSettings?: boolean;
  showAccessDetails?: boolean;
  workspaceName: string;
  privateOwner?: {
    name?: string | null;
    email?: string | null;
    avatar?: string | null;
    workspaceRole?: Role;
  };
  onVisibilitySelect: (visibility: SpaceVisibility) => void;
  onMembersAccessChange: (value: AccessLevel | null) => void;
  onEveryoneElseAccessChange: (value: AccessLevel | null) => void;
  onSidebarEditPolicyChange: (value: SpaceSidebarEditPolicy) => void;
  showActions?: boolean;
  primaryActionText?: ReactNode;
  primaryActionLoading?: boolean;
  primaryActionDisabled?: boolean;
  onPrimaryAction?: () => void;
  notice?: ReactNode;
  overlay?: ReactNode;
}

// The same level names as the Members tab and Desktop ("Can comment"). A
// missing level is No access.
function accessLabel(accessLevel: AccessLevel | null | undefined, t: TFunction): string {
  return spaceMemberAccessLabel(accessLevel ?? null, t);
}

/**
 * The server lets space owners add pages and, with "members and owners", space members who can
 * edit. Space members are the people and groups added to a Custom space, and every workspace
 * member (not guests) in a Public space. Private spaces have no setting: only the owner adds pages.
 */
function sidebarEditPolicyLabel(policy: SpaceSidebarEditPolicy, visibility: SpaceVisibility, t: TFunction): string {
  switch (policy) {
    case SpaceSidebarEditPolicy.OwnersOnly:
      return t('workspacePermissions.sidebarOwners');
    case SpaceSidebarEditPolicy.MembersAndOwners:
      return t(
        visibility === SpaceVisibility.Public
          ? 'workspacePermissions.sidebarWorkspaceMembers'
          : 'workspacePermissions.sidebarMembers'
      );
    default:
      // A policy from a newer server is shown neutrally and kept as received.
      return t('workspacePermissions.sidebarUnknown');
  }
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
  labelledBy,
  onChange,
}: {
  value: AccessLevel | null | undefined;
  options: readonly (AccessLevel | null)[];
  disabled?: boolean;
  testId: string;
  /** The row title, so the button says whose access it sets ("Space members, Can edit"). */
  labelledBy: string;
  onChange: (value: AccessLevel | null) => void;
}) {
  const { t } = useTranslation();
  const valueId = useId();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={disabled}
          aria-labelledby={`${labelledBy} ${valueId}`}
          className='min-w-[120px] justify-end px-2 text-text-primary'
          data-testid={testId}
        >
          <span id={valueId}>{accessLabel(value, t)}</span>
          <ChevronDown aria-hidden className='h-4 w-4 text-icon-tertiary' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {options.map((option) => (
          <DropdownMenuItem
            key={option ?? 'none'}
            onSelect={() => onChange(option)}
            className='justify-between'
            data-testid={`${testId}-option-${option ?? 'none'}`}
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

function PermissionPrincipalRow({
  icon,
  title,
  titleId,
  description,
  wrapDescription,
  trailing,
  last,
  testId,
}: {
  icon: ReactNode;
  title: string;
  titleId?: string;
  description: string;
  /** Let a sentence-long description wrap instead of truncating it. */
  wrapDescription?: boolean;
  trailing: ReactNode;
  last?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cn('flex items-center gap-3 px-4 py-3', !last && 'border-b border-border-primary')}
      data-testid={testId}
    >
      <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-300 bg-fill-content-hover'>{icon}</div>
      <div className='min-w-0 flex-1'>
        <div id={titleId} className='font-medium text-text-primary'>
          {title}
        </div>
        <div className={cn('text-sm text-text-secondary', wrapDescription ? 'break-words' : 'truncate')}>
          {description}
        </div>
      </div>
      {trailing}
    </div>
  );
}

/**
 * P: who may add pages directly to the space. Shared by Create and Manage
 * Space; only an actual change of the selected policy is reported.
 */
const SidebarEditPolicyRow = memo(function SidebarEditPolicyRow({
  value,
  visibility,
  disabled,
  onChange,
}: {
  value: SpaceSidebarEditPolicy;
  visibility: SpaceVisibility;
  disabled: boolean;
  onChange: (value: SpaceSidebarEditPolicy) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const valueId = useId();

  return (
    <section className='rounded-400 border border-border-primary' data-testid='space-sidebar-policy-row'>
      <PermissionPrincipalRow
        icon={<FilePlus2 className='h-5 w-5 text-icon-primary' />}
        title={t('workspacePermissions.sidebarPolicy')}
        titleId={titleId}
        description={t('workspacePermissions.sidebarExplanation')}
        wrapDescription
        last
        trailing={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={disabled}
                aria-labelledby={`${titleId} ${valueId}`}
                className='min-w-0 max-w-[50%] justify-end px-2 text-text-primary'
                data-testid='space-sidebar-policy'
              >
                <span id={valueId} className='truncate'>
                  {sidebarEditPolicyLabel(value, visibility, t)}
                </span>
                <ChevronDown aria-hidden className='h-4 w-4 text-icon-tertiary' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {SIDEBAR_EDIT_POLICY_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onSelect={() => {
                    if (option !== value) onChange(option);
                  }}
                  className='justify-between'
                  data-testid={`space-sidebar-policy-option-${option}`}
                >
                  {sidebarEditPolicyLabel(option, visibility, t)}
                  {option === value && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    </section>
  );
});

const PublicAccessCard = memo(function PublicAccessCard({
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
  const membersTitleId = useId();

  return (
    <section className='flex flex-col gap-3' data-testid='manage-space-public-access-card'>
      <div className='rounded-400 border border-border-primary'>
        <div className='flex flex-col gap-1 border-b border-border-primary px-4 py-3'>
          <div className='font-medium text-text-primary'>{t('space.permissionManager.publicAccessTitle')}</div>
          <div className='text-sm text-text-secondary'>{t('space.permissionManager.publicAccessDescription')}</div>
        </div>
        <PermissionPrincipalRow
          icon={<Shield className='h-5 w-5 text-icon-primary' />}
          title={t('space.permissionManager.workspaceOwners')}
          description={t('space.permissionManager.workspaceOwnersDescription')}
          testId='manage-space-workspace-owners-row'
          trailing={<FixedAccess label={accessLabel(AccessLevel.FullAccess, t)} />}
        />
        <PermissionPrincipalRow
          icon={<Users className='h-5 w-5 text-icon-primary' />}
          title={t('space.permissionManager.workspaceMembers')}
          titleId={membersTitleId}
          description={t('space.permissionManager.workspaceMembersDescription')}
          testId='manage-space-workspace-members-row'
          trailing={
            <AccessDropdown
              value={membersAccessLevel}
              options={PUBLIC_MEMBER_ACCESS_OPTIONS}
              disabled={disabled}
              testId='manage-space-workspace-members-access'
              labelledBy={membersTitleId}
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
});

const CustomPermissionsCard = memo(function CustomPermissionsCard({
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
  const membersTitleId = useId();
  const everyoneElseTitleId = useId();

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
        trailing={<FixedAccess label={accessLabel(AccessLevel.FullAccess, t)} />}
      />
      <PermissionPrincipalRow
        icon={<Users className='h-5 w-5 text-icon-primary' />}
        title={t('space.permissionManager.members')}
        titleId={membersTitleId}
        description={t('space.permissionManager.customMembersDescription')}
        testId='manage-space-custom-members-row'
        trailing={
          <AccessDropdown
            value={membersAccessLevel}
            options={CUSTOM_ACCESS_OPTIONS}
            disabled={disabled}
            testId='manage-space-custom-members-access'
            labelledBy={membersTitleId}
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
        titleId={everyoneElseTitleId}
        description={t('space.permissionManager.everyoneElseDescription')}
        testId='manage-space-everyone-else-row'
        trailing={
          <AccessDropdown
            value={everyoneElseAccessLevel}
            options={CUSTOM_ACCESS_OPTIONS}
            disabled={disabled}
            testId='manage-space-everyone-else-access'
            labelledBy={everyoneElseTitleId}
            onChange={onEveryoneElseAccessChange}
          />
        }
        last
      />
    </section>
  );
});

const PrivateAccessCard = memo(function PrivateAccessCard() {
  const { t } = useTranslation();

  return (
    <section className='rounded-400 border border-border-primary' data-testid='manage-space-private-access-card'>
      <div className='flex flex-col gap-1 border-b border-border-primary px-4 py-3'>
        <div className='font-medium text-text-primary'>{t('space.permissionManager.privateAccessTitle')}</div>
        <div className='text-sm text-text-secondary'>{t('space.permissionManager.privateAccessDescription')}</div>
      </div>
      <PermissionPrincipalRow
        icon={<Shield className='h-5 w-5 text-icon-primary' />}
        title={t('space.permissionManager.owner')}
        description={t('space.permissionManager.privateOwnerDescription')}
        testId='manage-space-private-owner-row'
        trailing={<FixedAccess label={accessLabel(AccessLevel.FullAccess, t)} />}
        last
      />
    </section>
  );
});

const PrivateMembersContent = memo(function PrivateMembersContent({
  owner,
}: {
  owner?: SpaceSettingsPanelProps['privateOwner'];
}) {
  const { t } = useTranslation();
  const displayName = owner?.name?.trim() || owner?.email?.trim() || t('space.permissionManager.you');
  const workspaceRole = (() => {
    switch (owner?.workspaceRole) {
      case Role.Owner:
        return t('space.permissionManager.workspaceOwner');
      case Role.Member:
        return t('space.permissionManager.workspaceMember');
      case Role.Guest:
        return t('space.permissionManager.workspaceGuest');
      default:
        return null;
    }
  })();
  const ownerDetails = [workspaceRole, owner?.email && owner.email !== displayName ? owner.email : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className='appflowy-scroller flex max-h-[64vh] flex-col gap-4 overflow-y-auto py-2 pr-1'
      data-testid='private-space-members-content'
    >
      <div
        className='rounded-300 bg-fill-content-hover px-3 py-2 text-sm text-text-secondary'
        data-testid='private-space-members-info'
      >
        {t('space.permissionManager.privateMembersDescription')}
      </div>
      <div
        className='grid items-center gap-3 border-b border-border-primary pb-2 text-sm font-medium text-text-secondary'
        style={{ gridTemplateColumns: 'minmax(0, 1fr) 220px' }}
      >
        <span>{t('space.permissionManager.name')}</span>
        <span className='text-right'>{t('space.permissionManager.role')}</span>
      </div>
      <div className='flex items-center gap-3 border-b border-border-primary py-3' data-testid='private-space-owner-row'>
        <Avatar size='md'>
          <AvatarImage src={owner?.avatar ?? undefined} alt={displayName} />
          <AvatarFallback name={displayName}>{displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1'>
          <div className='truncate font-medium text-text-primary'>{displayName}</div>
          {ownerDetails && <div className='truncate text-sm text-text-secondary'>{ownerDetails}</div>}
        </div>
        <div
          className='flex min-w-[120px] items-center justify-end gap-2 px-2 text-sm text-text-secondary'
          data-testid='private-space-owner-locked-role'
          aria-label={t('space.permissionManager.owner')}
        >
          <LockKeyhole className='h-4 w-4' aria-hidden />
          <span>{t('space.permissionManager.owner')}</span>
        </div>
      </div>
    </div>
  );
});

/** A natively disabled control, which browsers take keyboard focus away from. */
function isDisabledControl(element: Element): boolean {
  return (element as HTMLButtonElement).disabled === true;
}

/**
 * Saving or rechecking access briefly disables the General tab's controls, and a browser then
 * moves keyboard focus from the disabled control to the page. Keep focus in the tab while the
 * controls are paused, and return to the control the keyboard was on once it is available again,
 * also when a menu or a confirmation (`overlay`) closed without giving focus back to it. Focus the
 * user moved is left alone: to another control, to the tab itself (Tab, or a click on blank space
 * in it), or out of the controls with a click elsewhere in the dialog. `stateKey` changes whenever
 * any of that happens.
 */
function useKeyboardPlace(container: HTMLElement | null, stateKey: string) {
  const lastControl = useRef<HTMLElement | null>(null);
  // The user put focus where it is now (around the controls or nowhere), not a pause or a menu.
  const placedByUser = useRef(false);
  const parking = useRef(false);

  useEffect(() => {
    if (!container) return;
    const doc = container.ownerDocument;
    const panel = container.closest<HTMLElement>('[role="tabpanel"]');
    let pointerDown = false;
    const press = () => {
      pointerDown = true;
    };

    const release = () => {
      pointerDown = false;
    };

    const focusIn = (event: FocusEvent) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) return;
      if (target !== container && container.contains(target)) {
        lastControl.current = target;
        placedByUser.current = false;
      } else if (target.contains(container) && !parking.current) {
        // Only the user focuses the tab itself; the dialog takes focus from a click or after a loss.
        placedByUser.current = target === panel || pointerDown;
      }
    };

    const focusOut = (event: FocusEvent) => {
      // A click on something that takes no focus leaves focus on the page (no element gets it).
      if (pointerDown && !(event.relatedTarget instanceof Element)) placedByUser.current = true;
    };

    const active = doc.activeElement;

    // The field the dialog opened on was focused before this listener existed.
    if (active instanceof HTMLElement && active !== container && container.contains(active)) {
      lastControl.current = active;
    }

    doc.addEventListener('pointerdown', press, true);
    doc.addEventListener('pointerup', release, true);
    doc.addEventListener('pointercancel', release, true);
    doc.addEventListener('focusin', focusIn, true);
    doc.addEventListener('focusout', focusOut, true);
    return () => {
      doc.removeEventListener('pointerdown', press, true);
      doc.removeEventListener('pointerup', release, true);
      doc.removeEventListener('pointercancel', release, true);
      doc.removeEventListener('focusin', focusIn, true);
      doc.removeEventListener('focusout', focusOut, true);
    };
  }, [container]);

  // Before paint, so the browser never gets to drop focus from the disabled control.
  useLayoutEffect(() => {
    if (!container) return;
    const panel = container.closest<HTMLElement>('[role="tabpanel"]') ?? container;
    const active = document.activeElement;

    if (
      active instanceof HTMLElement &&
      active !== container &&
      container.contains(active) &&
      isDisabledControl(active)
    ) {
      parking.current = true;
      panel.focus({ preventScroll: true });
      parking.current = false;
      placedByUser.current = false;
      return;
    }

    const control = lastControl.current;

    if (!control?.isConnected || !container.contains(control) || isDisabledControl(control)) return;
    // Parked in the tab, or lost to the dialog or the page: an element around the tab has focus.
    if ((!active || active.contains(container)) && !placedByUser.current) control.focus({ preventScroll: true });
  }, [container, stateKey]);
}

/**
 * Shared Space settings presentation. Creation and management deliberately
 * keep their own controllers: this component owns layout only and never calls
 * a persistence API.
 */
function SpaceSettingsPanel({
  open,
  onClose,
  title,
  modalTestId,
  activeTab,
  onTabChange,
  membersTabVisible,
  membersTabDisabled = false,
  membersContent,
  spaceName,
  spaceIcon,
  spaceIconColor,
  nameInputRef,
  metadataDisabled = false,
  onSpaceNameChange,
  onSpaceNameBlur,
  onSpaceNameKeyDown,
  onSpaceIconChange,
  permissionSettings,
  visibilityOptions,
  permissionSettingsDisabled = false,
  loadingSettings = false,
  showAccessDetails = true,
  workspaceName,
  privateOwner,
  onVisibilitySelect,
  onMembersAccessChange,
  onEveryoneElseAccessChange,
  onSidebarEditPolicyChange,
  showActions = false,
  primaryActionText,
  primaryActionLoading = false,
  primaryActionDisabled = false,
  onPrimaryAction,
  notice,
  overlay,
}: SpaceSettingsPanelProps) {
  const { t } = useTranslation();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const draftVisibility = permissionSettings.visibility;
  const draftIsPublic = draftVisibility === SpaceVisibility.Public;
  const draftIsCustom = draftVisibility === SpaceVisibility.Custom;
  const draftIsPrivate = draftVisibility === SpaceVisibility.Private;
  const fallbackMembersTitleId = useId();

  useKeyboardPlace(
    container,
    `${metadataDisabled}:${permissionSettingsDisabled}:${loadingSettings}:${primaryActionLoading}:${Boolean(overlay)}`
  );

  return (
    <NormalModal
      keepMounted={false}
      open={open}
      onClose={onClose}
      onCancel={onClose}
      onOk={onPrimaryAction}
      okText={primaryActionText}
      cancelText={t('button.cancel')}
      okLoading={primaryActionLoading}
      okButtonProps={{ disabled: primaryActionDisabled, 'data-testid': 'create-space-submit' }}
      title={title}
      classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[6%]' }}
      showActions={showActions}
      overflowHidden
      PaperProps={{
        // Covers the notice, both tabs and the footer buttons.
        className: BUTTON_FOCUS_RING,
        style: {
          width: MODAL_WIDTH,
          maxWidth: '92vw',
        },
        'data-testid': modalTestId,
      }}
    >
      {notice}
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as SpaceSettingsTab)}
        aria-busy={primaryActionLoading || undefined}
        className='min-h-0 max-w-full'
        style={{ width: CONTENT_WIDTH }}
        data-testid='space-settings-panel'
      >
        <TabsList>
          <TabsTrigger value='general' disabled={primaryActionLoading}>
            {t('space.permissionManager.generalTab')}
          </TabsTrigger>
          {membersTabVisible && (
            <TabsTrigger value='members' disabled={membersTabDisabled || primaryActionLoading}>
              {t('space.permissionManager.membersTab')}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value='general' className='min-h-0' data-testid='space-settings-general'>
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
                      onChange={onSpaceIconChange}
                      disabled={metadataDisabled}
                    />
                  )}

                  <Input
                    data-testid='space-name-input'
                    value={spaceName}
                    autoFocus
                    ref={nameInputRef}
                    disabled={metadataDisabled}
                    onChange={(event) => onSpaceNameChange(event.target.value)}
                    onBlur={onSpaceNameBlur}
                    onKeyDown={onSpaceNameKeyDown}
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
                  options={visibilityOptions}
                  disabled={permissionSettingsDisabled}
                  onSelect={onVisibilitySelect}
                />
              </section>

              {showAccessDetails && draftIsPublic && (
                <PublicAccessCard
                  membersAccessLevel={permissionSettings.member_default_access_level}
                  disabled={permissionSettingsDisabled}
                  onMembersAccessChange={onMembersAccessChange}
                  onSwitchToCustom={() => onVisibilitySelect(SpaceVisibility.Custom)}
                />
              )}

              {showAccessDetails && draftIsCustom && (
                <CustomPermissionsCard
                  workspaceName={workspaceName}
                  membersAccessLevel={permissionSettings.member_default_access_level}
                  everyoneElseAccessLevel={permissionSettings.everyone_else_access_level ?? null}
                  disabled={permissionSettingsDisabled}
                  onMembersAccessChange={onMembersAccessChange}
                  onEveryoneElseAccessChange={onEveryoneElseAccessChange}
                />
              )}

              {showAccessDetails && draftIsPrivate && <PrivateAccessCard />}

              {showAccessDetails && !draftIsPublic && !draftIsCustom && !draftIsPrivate && (
                <div
                  className='rounded-400 border border-border-primary'
                  data-testid='manage-space-fallback-access-card'
                >
                  <PermissionPrincipalRow
                    icon={<Shield className='h-5 w-5 text-icon-primary' />}
                    title={t('space.permissionManager.owners')}
                    description={t('space.permissionManager.ownersDescription')}
                    trailing={<FixedAccess label={accessLabel(AccessLevel.FullAccess, t)} />}
                  />

                  <PermissionPrincipalRow
                    icon={<Users className='h-5 w-5 text-icon-primary' />}
                    title={t('space.permissionManager.members')}
                    titleId={fallbackMembersTitleId}
                    description={t('space.permissionManager.membersDescription')}
                    testId='manage-space-members-default-access-row'
                    trailing={
                      <AccessDropdown
                        value={permissionSettings.member_default_access_level}
                        options={FALLBACK_MEMBER_ACCESS_OPTIONS}
                        disabled={permissionSettingsDisabled}
                        testId='manage-space-members-default-access'
                        labelledBy={fallbackMembersTitleId}
                        onChange={(value) => {
                          if (value !== null) onMembersAccessChange(value);
                        }}
                      />
                    }
                    last
                  />
                </div>
              )}

              {showAccessDetails && !draftIsPrivate && (
                <SidebarEditPolicyRow
                  value={permissionSettings.sidebar_edit_policy}
                  visibility={draftVisibility}
                  disabled={permissionSettingsDisabled || loadingSettings}
                  onChange={onSidebarEditPolicyChange}
                />
              )}
            </div>
          </div>
        </TabsContent>

        {membersTabVisible && (
          <TabsContent value='members' className='min-h-0'>
            {draftIsPrivate ? <PrivateMembersContent owner={privateOwner} /> : membersContent}
          </TabsContent>
        )}
      </Tabs>
      {overlay}
    </NormalModal>
  );
}

export default memo(SpaceSettingsPanel);
