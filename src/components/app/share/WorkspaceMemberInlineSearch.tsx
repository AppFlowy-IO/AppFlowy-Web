import { Plus, UserPlus } from 'lucide-react';
import { type KeyboardEventHandler, type ReactNode, useMemo, useRef } from 'react';

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
  compact?: boolean;
  noResultsLabel?: string;
  formatRole?: (role: Role) => string;
  inputClassName?: string;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onAddButtonClick?: () => void;
  onAddMember: (member: WorkspaceMember) => void;
}

interface WorkspaceMemberInlineSearchInputProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  addButtonLabel: string;
  addButtonDisabled?: boolean;
  addButtonLoading?: boolean;
  addButtonIcon?: ReactNode;
  inputDisabled?: boolean;
  inputClassName?: string;
  compact?: boolean;
  inputTestId?: string;
  addButtonTestId?: string;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onAddButtonClick?: () => void;
}

export function WorkspaceMemberInlineSearchInput({
  search,
  onSearchChange,
  searchPlaceholder,
  addButtonLabel,
  addButtonDisabled = false,
  addButtonLoading = false,
  addButtonIcon,
  inputDisabled = false,
  inputClassName,
  compact = false,
  inputTestId = 'workspace-member-inline-search-input',
  addButtonTestId,
  onInputKeyDown,
  onAddButtonClick,
}: WorkspaceMemberInlineSearchInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resolvedInputClassName = inputClassName ?? (compact ? 'h-8 flex-1 [&>svg]:h-4 [&>svg]:w-4' : 'h-10 flex-1');
  const ButtonIcon =
    addButtonIcon === undefined ? (
      <UserPlus aria-hidden='true' className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
    ) : (
      addButtonIcon
    );

  return (
    <div className={compact ? 'flex items-center gap-1.5' : 'flex items-center gap-2'}>
      <SearchInput
        name='workspace-member-search'
        aria-label={searchPlaceholder}
        autoComplete='off'
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        className={resolvedInputClassName}
        inputRef={inputRef}
        disabled={inputDisabled}
        onKeyDown={onInputKeyDown}
        data-testid={inputTestId}
      />
      <Button
        type='button'
        size={compact ? 'default' : 'lg'}
        disabled={addButtonDisabled}
        loading={addButtonLoading}
        onClick={() => {
          if (onAddButtonClick) {
            onAddButtonClick();
            return;
          }

          inputRef.current?.focus();
        }}
        data-testid={addButtonTestId}
      >
        {ButtonIcon}
        {addButtonLabel}
      </Button>
    </div>
  );
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
  inputClassName,
  compact = false,
  noResultsLabel,
  formatRole,
  onInputKeyDown,
  onAddButtonClick,
  onAddMember,
}: WorkspaceMemberInlineSearchProps) {
  const visibleMembers = addableMembers.slice(0, maxResults);
  const hasUnavailableMembers = visibleMembers.some((member) => !getWorkspaceMemberUid(member));

  return (
    <>
      <WorkspaceMemberInlineSearchInput
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        addButtonLabel={addButtonLabel}
        addButtonDisabled={addButtonDisabled}
        inputDisabled={inputDisabled}
        inputClassName={inputClassName}
        compact={compact}
        onInputKeyDown={onInputKeyDown}
        onAddButtonClick={onAddButtonClick}
      />

      {search.trim() && visibleMembers.length === 0 && noResultsLabel && (
        <div className='border-t border-border-primary py-3 text-center text-sm text-text-secondary'>
          {noResultsLabel}
        </div>
      )}

      {visibleMembers.length > 0 && (
        <div
          className={
            compact
              ? 'flex flex-col gap-1 border-t border-border-primary pt-2'
              : 'flex flex-col gap-2 border-t border-border-primary pt-4'
          }
        >
          <div
            className={
              compact
                ? 'text-xs font-medium leading-[18px] text-text-secondary'
                : 'text-sm font-medium text-text-secondary'
            }
          >
            {addResultLabel}
          </div>
          <div className='flex flex-col'>
            {visibleMembers.map((member) => {
              const uid = getWorkspaceMemberUid(member);
              const unavailable = !uid;

              return (
                <div
                  key={`${member.email}-${uid ?? 'missing-uid'}`}
                  className={
                    compact
                      ? 'flex items-center gap-1.5 px-0 py-1'
                      : 'flex items-center gap-3 rounded-300 px-2 py-2 hover:bg-fill-content-hover'
                  }
                  data-testid='workspace-member-inline-search-result'
                >
                  <Avatar size={compact ? 'sm' : 'md'}>
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
                  {compact && formatRole && (
                    <span className='shrink-0 text-xs leading-[18px] text-text-secondary'>
                      {formatRole(member.role)}
                    </span>
                  )}
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    aria-label={`${addActionLabel} ${workspaceMemberDisplayName(member)}`}
                    className='text-text-action hover:text-text-action-hover focus-visible:ring-1 focus-visible:ring-border-theme-thick'
                    disabled={addButtonDisabled || unavailable || addingUid === uid}
                    loading={addingUid === uid}
                    onClick={() => onAddMember(member)}
                    title={unavailable ? unavailableTitle : undefined}
                    data-testid='workspace-member-inline-search-result-add'
                  >
                    {addingUid === uid ? (
                      <Progress variant='inherit' />
                    ) : compact ? (
                      `+ ${addActionLabel}`
                    ) : (
                      <>
                        <Plus aria-hidden='true' className='h-4 w-4' />
                        {addActionLabel}
                      </>
                    )}
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
