import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Role, type Workspace } from '@/application/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import { isGuestWorkspace } from './consentModel';

import type { TFunction } from 'i18next';

/** "Owner" or "Member", which tells apart workspaces with the same name; guests get their own hint. */
function roleLabel(role: Workspace['role'], t: TFunction): string | undefined {
  switch (role) {
    case Role.Owner:
      return t('settings.appearance.members.owner');
    case Role.Member:
      return t('settings.appearance.members.member');
    default:
      // Guests see why they cannot choose the workspace; older servers send no role.
      return undefined;
  }
}

export interface McpConsentWorkspacePickerProps {
  workspaces: readonly Workspace[];
  selectedId?: string;
  onSelect: (workspaceId: string) => void;
  disabled?: boolean;
}

/** One radio per workspace; guest workspaces are listed but cannot be chosen. */
export function McpConsentWorkspacePicker({
  workspaces,
  selectedId,
  onSelect,
  disabled,
}: McpConsentWorkspacePickerProps) {
  const { t } = useTranslation();
  const groupId = useId();

  return (
    <fieldset className='flex min-w-0 flex-col gap-2' disabled={disabled}>
      <legend className='mb-2 text-sm font-medium text-text-primary'>{t('mcp.consent.workspace')}</legend>
      {workspaces.map((workspace) => {
        const guest = isGuestWorkspace(workspace);
        const checked = workspace.id === selectedId;
        const hintId = `${groupId}-${workspace.id}`;
        const role = roleLabel(workspace.role, t);

        return (
          <label
            key={workspace.id}
            className={cn(
              'flex min-w-0 items-center gap-3 rounded-300 border px-4 py-3 transition-colors',
              checked ? 'border-border-theme-thick' : 'border-border-primary',
              guest || disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              !checked && !guest && !disabled && 'hover:border-border-primary-hover'
            )}
          >
            <input
              type='radio'
              name={groupId}
              value={workspace.id}
              checked={checked}
              disabled={guest}
              onChange={() => onSelect(workspace.id)}
              aria-describedby={guest ? hintId : undefined}
              className='m-[3px] h-3.5 w-3.5 shrink-0 cursor-[inherit] appearance-none rounded-full border-[1.25px] border-border-primary bg-fill-content transition-colors checked:border-4 checked:border-fill-theme-thick checked:bg-icon-on-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-theme-thick enabled:hover:border-border-primary-hover enabled:checked:hover:border-fill-theme-thick-hover disabled:checked:opacity-40 [&:disabled:not(:checked)]:bg-fill-content-hover'
              data-testid={`mcp-consent-workspace-option-${workspace.id}`}
            />
            <Avatar shape='square' size='md' className={cn('shrink-0', guest && 'opacity-40')}>
              <AvatarFallback name={workspace.name}>
                {workspace.icon ? <span className='text-base'>{workspace.icon}</span> : workspace.name}
              </AvatarFallback>
            </Avatar>
            <span className='flex min-w-0 flex-col'>
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  guest || disabled ? 'text-text-tertiary' : 'text-text-primary'
                )}
                title={workspace.name}
              >
                {workspace.name}
              </span>
              {guest ? (
                <span id={hintId} className='text-xs leading-[18px] text-text-tertiary'>
                  {t('mcp.consent.guestWorkspace')}
                </span>
              ) : (
                role && (
                  <span
                    className={cn('text-xs leading-[18px]', disabled ? 'text-text-tertiary' : 'text-text-secondary')}
                    data-testid={`mcp-consent-workspace-role-${workspace.id}`}
                  >
                    {role}
                  </span>
                )
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export default McpConsentWorkspacePicker;
