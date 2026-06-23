import { Plus, UserPlus } from 'lucide-react';
import { type KeyboardEventHandler, useMemo, useRef } from 'react';

import { Role, WorkspaceMember } from '@/application/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';

const EMPTY_EXCLUDED_ROLES: Role[] = [];

export function getWorkspaceMemberUid(member: WorkspaceMember): string | null {
  const rawUid = (member as WorkspaceMember & { uid?: unknown }).uid;

  if (typeof rawUid === 'number' && Number.isFinite(rawUid)) return String(rawUid);
  if (typeof rawUid === 'string') {
    const trimmed = rawUid.trim();

    return trimmed ? trimmed : null;
  }

  return null;
}

export function workspaceMemberDisplayName(member: WorkspaceMember): string {
  return member.name || member.email;
}

function workspaceMemberInitial(member: WorkspaceMember): string {
  return workspaceMemberDisplayName(member).slice(0, 1).toUpperCase() || '?';
}

interface UseAddableWorkspaceMembersArgs {
  workspaceMembers: WorkspaceMember[];
  search: string;
  excludedUids: Set<string>;
  excludedEmails?: Set<string>;
  excludedRoles?: Role[];
  excludePending?: boolean;
}

export function useAddableWorkspaceMembers({
  workspaceMembers,
  search,
  excludedUids,
  excludedEmails,
  excludedRoles = EMPTY_EXCLUDED_ROLES,
  excludePending = false,
}: UseAddableWorkspaceMembersArgs): WorkspaceMember[] {
  const normalizedSearch = search.trim().toLowerCase();
  const excludedRoleSet = useMemo(() => new Set(excludedRoles), [excludedRoles]);

  return useMemo(() => {
    if (!normalizedSearch) return [];

    return workspaceMembers.filter((member) => {
      const uid = getWorkspaceMemberUid(member);
      const email = member.email.trim().toLowerCase();
      const matchesSearch =
        workspaceMemberDisplayName(member).toLowerCase().includes(normalizedSearch) || email.includes(normalizedSearch);

      if (!matchesSearch) return false;
      if (uid && excludedUids.has(uid)) return false;
      if (excludedEmails?.has(email)) return false;
      if (excludedRoleSet.has(member.role)) return false;
      if (excludePending && member.is_pending_invitation) return false;

      return true;
    });
  }, [excludePending, excludedEmails, excludedRoleSet, excludedUids, normalizedSearch, workspaceMembers]);
}

interface WorkspaceMemberInlineSearchProps {
  search: string;
  onSearchChange: (value: string) => void;
  addableMembers: WorkspaceMember[];
  searchPlaceholder: string;
  addButtonLabel: string;
  addResultLabel: string;
  addActionLabel: string;
  ownerBadgeLabel: string;
  unavailableTitle: string;
  unavailableHint?: string;
  addButtonDisabled?: boolean;
  inputDisabled?: boolean;
  addingUid?: string | null;
  maxResults?: number;
  inputClassName?: string;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onAddMember: (member: WorkspaceMember) => void;
}

export function WorkspaceMemberInlineSearch({
  search,
  onSearchChange,
  addableMembers,
  searchPlaceholder,
  addButtonLabel,
  addResultLabel,
  addActionLabel,
  ownerBadgeLabel,
  unavailableTitle,
  unavailableHint,
  addButtonDisabled = false,
  inputDisabled = false,
  addingUid = null,
  maxResults = 12,
  inputClassName = 'h-10 flex-1',
  onInputKeyDown,
  onAddMember,
}: WorkspaceMemberInlineSearchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const visibleMembers = addableMembers.slice(0, maxResults);
  const hasUnavailableMembers = visibleMembers.some((member) => !getWorkspaceMemberUid(member));

  return (
    <>
      <div className='flex items-center gap-2'>
        <SearchInput
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className={inputClassName}
          inputRef={inputRef}
          disabled={inputDisabled}
          onKeyDown={onInputKeyDown}
          data-testid='workspace-member-inline-search-input'
        />
        <Button type='button' size='lg' disabled={addButtonDisabled} onClick={() => inputRef.current?.focus()}>
          <UserPlus className='h-5 w-5' />
          {addButtonLabel}
        </Button>
      </div>

      {visibleMembers.length > 0 && (
        <div className='flex flex-col gap-2 border-t border-border-primary pt-4'>
          <div className='text-sm font-medium text-text-secondary'>{addResultLabel}</div>
          <div className='flex flex-col'>
            {visibleMembers.map((member) => {
              const uid = getWorkspaceMemberUid(member);
              const unavailable = !uid;

              return (
                <div
                  key={`${member.email}-${uid ?? 'missing-uid'}`}
                  className='flex items-center gap-3 rounded-300 px-2 py-2 hover:bg-fill-content-hover'
                  data-testid='workspace-member-inline-search-result'
                >
                  <Avatar size='md'>
                    <AvatarImage src={member.avatar_url} alt={member.name} />
                    <AvatarFallback name={workspaceMemberDisplayName(member)}>
                      {workspaceMemberInitial(member)}
                    </AvatarFallback>
                  </Avatar>
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium text-text-primary'>
                      {workspaceMemberDisplayName(member)}
                      {member.role === Role.Owner && (
                        <span className='ml-2 rounded-200 bg-fill-content-hover px-1.5 py-0.5 text-xs text-text-secondary'>
                          {ownerBadgeLabel}
                        </span>
                      )}
                    </div>
                    <div className='truncate text-xs text-text-secondary'>{member.email}</div>
                  </div>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    className='text-text-action hover:text-text-action-hover'
                    disabled={addButtonDisabled || unavailable || addingUid === uid}
                    loading={addingUid === uid}
                    onClick={() => onAddMember(member)}
                    title={unavailable ? unavailableTitle : undefined}
                    data-testid='workspace-member-inline-search-result-add'
                  >
                    {addingUid === uid ? <Progress variant='inherit' /> : <Plus className='h-4 w-4' />}
                    {addActionLabel}
                  </Button>
                </div>
              );
            })}
          </div>
          {hasUnavailableMembers && unavailableHint && (
            <div className='text-xs text-text-tertiary'>{unavailableHint}</div>
          )}
        </div>
      )}
    </>
  );
}
