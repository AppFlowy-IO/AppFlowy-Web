import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceService } from '@/application/services/domains';
import {
  AccessLevel,
  IPeopleWithAccessType,
  WorkspaceGroupMember,
  WorkspaceGroupViewPermission,
} from '@/application/types';
import { ReactComponent as ArrowRightIcon } from '@/assets/icons/alt_arrow_right_small.svg';
import { notify } from '@/components/_shared/notify';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import { GroupAccessLevelDropdown } from './GroupAccessLevelDropdown';
import { PersonAvatar } from './PersonAvatar';
import { WorkspaceGroupIcon } from './WorkspaceGroupIcon';

interface GroupItemProps {
  group: WorkspaceGroupViewPermission;
  /** Access-details rows keyed by lower-cased email; enriches member rows with avatars and names. */
  peopleByEmail: ReadonlyMap<string, IPeopleWithAccessType>;
  /** Whether the current user may list the group's members. The server allows workspace owners only. */
  canExploreMembers?: boolean;
  /** The scrollable access list; an expanded group scrolls itself into view inside it. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  canModify: boolean;
  currentUserHasFullAccess: boolean;
  canManageFullAccess: boolean;
  onAccessLevelChange: (groupId: string, accessLevel: AccessLevel) => Promise<AccessLevel | null | undefined>;
  onRemoveAccess: (groupId: string) => Promise<AccessLevel | null | undefined>;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** A loaded group roster together with the member count it was fetched for. */
interface GroupRoster {
  members: WorkspaceGroupMember[];
  memberCount: number;
}

const loadingIndicator = (
  <div className='flex items-center justify-center py-2'>
    <Progress variant='primary' />
  </div>
);

/**
 * One workspace-group row in the share list.
 *
 * People whose only access comes from this group are not listed as separate rows; instead the
 * row expands (for users allowed to inspect group membership) to show who is inside the group.
 */
export function GroupItem({
  group,
  peopleByEmail,
  canExploreMembers = false,
  scrollContainerRef,
  canModify,
  currentUserHasFullAccess,
  canManageFullAccess,
  onAccessLevelChange,
  onRemoveAccess,
}: GroupItemProps) {
  const { t } = useTranslation();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const currentUser = useCurrentUser();
  const [expanded, setExpanded] = useState(false);
  const [roster, setRoster] = useState<GroupRoster | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const showMembers = canExploreMembers && expanded;
  // The server-side member count is part of the group projection, so a changed count is a
  // cheap signal that an already loaded roster is stale.
  const rosterStale = roster === null || roster.memberCount !== group.member_count;
  // Derived rather than stored: a fetch is in flight exactly while the row is open and the
  // roster is stale, so no extra state or render is needed to track it.
  const loading = showMembers && rosterStale && Boolean(currentWorkspaceId);
  // Resolve the message outside the effect: a string dependency stays stable across renders,
  // whereas the `t` function identity may not.
  const loadFailedMessage = t('shareAction.loadGroupMembersFailed');

  useEffect(() => {
    if (!showMembers || !rosterStale || !currentWorkspaceId) return;

    let cancelled = false;

    void (async () => {
      try {
        const result = await WorkspaceService.getWorkspaceGroupMembers(currentWorkspaceId, group.group_id);

        if (cancelled) return;
        setRoster({ members: result?.members ?? [], memberCount: group.member_count });
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        notify.error(loadFailedMessage);
        setExpanded(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, group.group_id, group.member_count, loadFailedMessage, rosterStale, showMembers]);

  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const toggleLabel = t(expanded ? 'shareAction.hideGroupMembers' : 'shareAction.showGroupMembers', {
    group: group.name,
  });

  const memberRows = useMemo(() => {
    const currentUserEmail = normalizeEmail(currentUser?.email || '');

    return (roster?.members ?? []).map((member) => {
      const email = member.email?.trim() || '';
      const person = email ? peopleByEmail.get(normalizeEmail(email)) : undefined;
      const displayName =
        member.name?.trim() ||
        person?.name ||
        email ||
        t('settings.appearance.people.userFallbackName', { uid: member.uid });

      return {
        uid: member.uid,
        email: email || person?.email || '',
        displayName,
        avatarUrl: person?.avatar_url,
        isYou: Boolean(email) && Boolean(currentUserEmail) && normalizeEmail(email) === currentUserEmail,
      };
    });
  }, [currentUser?.email, peopleByEmail, roster, t]);

  const memberRowCount = memberRows.length;

  // The access list is height-capped and scrolls. A group near the bottom expands below the
  // fold, so bring the header and its members into view once they render.
  useEffect(() => {
    if (!showMembers) return;

    const wrapper = wrapperRef.current;
    const container = scrollContainerRef?.current;

    if (!wrapper || !container) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    if (wrapperRect.bottom <= containerRect.bottom) return;

    const top = container.scrollTop + (wrapperRect.top - containerRect.top);

    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top, behavior: 'smooth' });
    } else {
      container.scrollTop = top;
    }
  }, [loading, memberRowCount, scrollContainerRef, showMembers]);

  const header = (
    <div className='flex w-full flex-1 flex-col gap-0.5 overflow-hidden'>
      <div className='flex items-center gap-2'>
        <div className='truncate text-sm text-text-primary'>{group.name}</div>
        <span className='rounded-full bg-fill-content-hover px-2 py-[1px] text-xs text-text-secondary'>
          {t('shareAction.group')}
        </span>
      </div>
      <div className='truncate whitespace-nowrap text-xs text-text-secondary'>
        {t('shareAction.groupMembersCount', { count: group.member_count })}
      </div>
    </div>
  );

  return (
    <div ref={wrapperRef} data-testid={`share-group-${group.group_id}`} className='flex w-full flex-col'>
      <div
        data-testid={`share-group-row-${group.group_id}`}
        // `group` keeps the row addressable by the same `.group` row selector as person rows.
        className={cn(
          'group group/row flex w-full items-center gap-2 rounded-300 px-2 py-1.5 hover:bg-fill-content-hover',
          showMembers && 'bg-fill-content-hover'
        )}
      >
        {canExploreMembers ? (
          <button
            type='button'
            data-testid={`share-group-toggle-${group.group_id}`}
            aria-expanded={expanded}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={toggleExpanded}
            className='flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-300 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
          >
            <span
              aria-hidden='true'
              className='flex h-8 w-8 shrink-0 items-center justify-center rounded-300 bg-fill-content-hover'
            >
              <WorkspaceGroupIcon
                variant='chip'
                className={cn('h-5 w-5', expanded ? 'hidden' : 'group-hover/row:hidden group-focus-within/row:hidden')}
              />
              <ArrowRightIcon
                className={cn(
                  'h-4 w-4 text-icon-secondary transition-transform',
                  expanded ? 'rotate-90' : 'hidden group-hover/row:block group-focus-within/row:block'
                )}
              />
            </span>
            {header}
          </button>
        ) : (
          <div className='flex w-full flex-row items-center gap-2 overflow-hidden'>
            <WorkspaceGroupIcon variant='row' />
            {header}
          </div>
        )}
        <GroupAccessLevelDropdown
          group={group}
          canModify={canModify}
          currentUserHasFullAccess={currentUserHasFullAccess}
          canManageFullAccess={canManageFullAccess}
          onAccessLevelChange={onAccessLevelChange}
          onRemoveAccess={onRemoveAccess}
        />
      </div>
      {showMembers && (
        <div data-testid={`share-group-members-${group.group_id}`} className='flex w-full flex-col'>
          {loading && roster === null ? (
            loadingIndicator
          ) : memberRows.length === 0 ? (
            <div className='py-2 pl-12 pr-2 text-xs text-text-secondary'>{t('shareAction.noGroupMembers')}</div>
          ) : (
            memberRows.map((member) => (
              <div
                key={member.uid}
                data-testid={`share-group-member-${member.uid}`}
                className='flex w-full items-center gap-2 rounded-300 py-1.5 pl-6 pr-2'
              >
                <PersonAvatar avatarUrl={member.avatarUrl} name={member.displayName} />
                <div className='flex w-full flex-1 flex-col gap-0.5 overflow-hidden'>
                  <div className='flex items-center gap-2'>
                    <div className='truncate text-sm text-text-primary'>{member.displayName}</div>
                    {member.isYou && <span className='text-xs text-text-tertiary'>({t('shareAction.you')})</span>}
                  </div>
                  {member.email ? (
                    <div className='truncate whitespace-nowrap text-xs text-text-secondary'>{member.email}</div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
