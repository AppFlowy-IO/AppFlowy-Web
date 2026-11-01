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
              'flex min-w-0 items-center gap-3 rounded-400 border px-3 py-2 transition-colors',
              checked ? 'border-border-theme-thick bg-fill-theme-select' : 'border-border-primary',
              guest || disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-fill-content-hover',
              guest && 'opacity-60'
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
              className='h-4 w-4 shrink-0 accent-fill-theme-thick'
              data-testid={`mcp-consent-workspace-option-${workspace.id}`}
            />
            <Avatar shape='square' size='sm' className='shrink-0'>
              <AvatarFallback name={workspace.name}>
                {workspace.icon ? <span className='text-base'>{workspace.icon}</span> : workspace.name}
              </AvatarFallback>
            </Avatar>
            <span className='flex min-w-0 flex-col'>
              <span className='truncate text-sm text-text-primary' title={workspace.name}>
                {workspace.name}
              </span>
              {guest ? (
                <span id={hintId} className='text-xs text-text-secondary'>
                  {t('mcp.consent.guestWorkspace')}
                </span>
              ) : (
                role && (
                  <span
                    className='text-xs text-text-secondary'
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
