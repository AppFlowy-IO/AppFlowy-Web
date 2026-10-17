import { ChevronDown } from 'lucide-react';
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import {
  isGroupSpaceCoverageLevel,
  setGroupSpaceCoverage,
} from '@/application/services/js-services/http/group-space-coverage-api';
import { AccessLevel, GroupSpaceCoverageLevel, WorkspaceGroup } from '@/application/types';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { SettingsSection } from '@/components/app/settings/billing/SettingsPanelShell';
import { WorkspaceGroupIcon } from '@/components/app/share/WorkspaceGroupIcon';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { changeFailureReason, RAW } from '@/utils/change-failure';
import { createCoalescedRefresh } from '@/utils/coalesced-refresh';

import type { TFunction } from 'i18next';

const COVERAGE_OPTIONS: readonly GroupSpaceCoverageLevel[] = [null, AccessLevel.ReadOnly, AccessLevel.ReadAndWrite];

function coverageRank(level: GroupSpaceCoverageLevel): number {
  if (level === AccessLevel.ReadAndWrite) return 2;
  if (level === AccessLevel.ReadOnly) return 1;
  return 0;
}

function coverageKey(level: GroupSpaceCoverageLevel): string {
  return level === null ? 'off' : String(level);
}

export function coverageLabel(level: GroupSpaceCoverageLevel | undefined, t: TFunction): string {
  if (level === AccessLevel.ReadAndWrite) return t('groupSpaceAccess.canEdit');
  if (level === AccessLevel.ReadOnly) return t('groupSpaceAccess.canView');
  if (level === null) return t('groupSpaceAccess.off');
  return t('groupSpaceAccess.unknown');
}

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; httpStatus?: unknown };

  return candidate.httpStatus === 403 || candidate.code === ERROR_CODE.NOT_HAS_PERMISSION;
}

interface GroupSpaceCoverageCardProps {
  workspaceId: string;
  /** Keep the same object until the list delivers a new copy: any new copy replaces a confirmed save. */
  group: WorkspaceGroup;
  /** False once the account/workspace scope that opened the dialog is gone. */
  isCurrent?: () => boolean;
  /**
   * Reloads the owning group list after a confirmed change. The host must drop list reads already
   * in flight when this is called, so an older copy can't replace the save (MembersPanel does).
   */
  onChanged?: () => Promise<void> | void;
}

/**
 * "Access to all spaces" for one group (People > Groups > group > General). Changes apply
 * immediately; granting or raising access asks for confirmation first.
 */
export function GroupSpaceCoverageCard({ workspaceId, group, isCurrent, onChanged }: GroupSpaceCoverageCardProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const levelId = useId();
  const serverLevel = group.space_coverage_access_level;
  // A confirmed save is shown until the list delivers any newer copy of the group. Comparing levels
  // instead would bring the save back when another owner restores the old level.
  const [saved, setSaved] = useState<{ source: WorkspaceGroup; level: GroupSpaceCoverageLevel }>();
  const [pending, setPending] = useState<{ level: GroupSpaceCoverageLevel }>();
  const [confirming, setConfirming] = useState<{ level: GroupSpaceCoverageLevel }>();
  const alive = useRef(true);
  const shownGroup = useRef(group);

  useLayoutEffect(() => {
    shownGroup.current = group;
  }, [group]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const confirmed = saved?.source === group ? saved.level : serverLevel;
  const known = isGroupSpaceCoverageLevel(confirmed);
  const canManage = group.can_manage_space_coverage === true;
  const shown = pending ? pending.level : confirmed;
  const disabled = !canManage || !known || pending !== undefined;
  const reason = !canManage
    ? t('groupSpaceAccess.ownerRequired')
    : !known
    ? t('groupSpaceAccess.unknownHint')
    : undefined;

  const save = async (level: GroupSpaceCoverageLevel) => {
    const stillCurrent = () => isCurrent?.() ?? true;

    setPending({ level });
    try {
      const result = await setGroupSpaceCoverage(workspaceId, group.group_id, level, stillCurrent);

      // Tie the save to the copy on screen now (it may have arrived while saving, from an older read).
      if (alive.current) setSaved({ source: shownGroup.current, level: result.access_level });
      toast.success(t('groupSpaceAccess.updated'));
      void Promise.resolve(onChanged?.()).catch(() => undefined);
    } catch (error) {
      // A switched account/workspace already discarded this dialog; its error is not actionable.
      // The toast names the change and keeps the confirmed level on screen.
      if (stillCurrent()) {
        toast.error(t('groupSpaceAccess.updateFailed', { group: group.name, reason: changeFailureReason(error, t), ...RAW }));
      }
    } finally {
      if (alive.current) setPending(undefined);
    }
  };

  const choose = (level: GroupSpaceCoverageLevel) => {
    if (disabled || !known || level === confirmed) return;
    if (coverageRank(level) > coverageRank(confirmed)) {
      setConfirming({ level });
      return;
    }

    void save(level);
  };

  return (
    <section
      aria-labelledby={titleId}
      className='flex items-start justify-between gap-4 rounded-400 border border-border-primary p-4'
      data-testid='group-space-coverage-card'
    >
      <div className='min-w-0'>
        <div id={titleId} className='text-sm font-semibold text-text-primary'>
          {t('groupSpaceAccess.title')}
        </div>
        <div className='mt-1 text-sm leading-5 text-text-secondary'>{t('groupSpaceAccess.description')}</div>
        {reason && (
          <div className='mt-2 text-xs text-text-tertiary' data-testid='group-space-coverage-reason'>
            {reason}
          </div>
        )}
      </div>
      <DropdownMenu>
        {/* Radix owns the trigger id: the open menu refers to it. */}
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={disabled}
            loading={pending !== undefined}
            aria-labelledby={`${titleId} ${levelId}`}
            className='min-w-[120px] shrink-0 justify-end px-2 text-text-primary'
            data-testid='group-space-coverage-trigger'
          >
            {pending && <Progress variant='inherit' />}
            <span id={levelId}>{coverageLabel(shown, t)}</span>
            <ChevronDown aria-hidden='true' className='h-4 w-4 text-icon-tertiary' />
          </Button>
        </DropdownMenuTrigger>
        {/* The menu lists the levels of this setting, so it is named by the setting, not the current level. */}
        <DropdownMenuContent align='end' aria-labelledby={titleId}>
          {COVERAGE_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={coverageKey(option)}
              onSelect={() => choose(option)}
              className='justify-between'
              data-testid={`group-space-coverage-option-${coverageKey(option)}`}
            >
              {coverageLabel(option, t)}
              {option === confirmed && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(undefined);
          }}
        >
          <AlertDialogContent
            className='w-[440px] max-w-[calc(100%-2rem)] gap-5 rounded-400 border-0 bg-surface-primary p-5'
            data-testid='group-space-coverage-confirmation'
            showCloseButton
            closeLabel={t('button.close')}
          >
            <AlertDialogHeader className='gap-3 pr-8 text-left'>
              <AlertDialogTitle className='text-base font-bold leading-[22px] text-text-primary'>
                {t('groupSpaceAccess.confirmTitle', { group: group.name, ...RAW })}
              </AlertDialogTitle>
              <AlertDialogDescription className='text-sm leading-5 text-text-primary'>
                {t(
                  confirming.level === AccessLevel.ReadAndWrite
                    ? 'groupSpaceAccess.confirmEdit'
                    : 'groupSpaceAccess.confirmView',
                  { group: group.name, ...RAW }
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className='gap-3'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setConfirming(undefined)}
                data-testid='group-space-coverage-cancel'
              >
                {t('button.cancel')}
              </Button>
              <Button
                type='button'
                onClick={() => {
                  const { level } = confirming;

                  setConfirming(undefined);
                  void save(level);
                }}
                data-testid='group-space-coverage-confirm'
              >
                {t('groupSpaceAccess.giveAccess')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}

/** A background check this soon after a read that succeeded joins it instead of reading again. */
const BACKGROUND_READ_JOIN_MS = 2_000;

/** One read of the workspace group list, as a background check sees it. */
export type GroupListRead = {
  request: number;
  settled: boolean;
  /** When a read that succeeded was sent. */
  freshAsOf?: number;
};

/**
 * Returning to the tab fires visibilitychange and focus back to back, and reconnecting fires online
 * and then socket open. Such a background check joins the latest read while it is queued or in
 * flight, or moments after it succeeded, instead of dropping it for a second one. A change (a
 * permission hint, a save) must still replace that read: it may have been sent before the change.
 */
export function joinsGroupListRead(read: GroupListRead | undefined, latestRequest: number): boolean {
  // A read that was replaced, or dropped when its reader went away, can't be joined.
  if (read?.request !== latestRequest) return false;
  if (!read.settled) return true;
  // Only a read that succeeded counts, and a clock set back never makes it look fresher.
  const age = Date.now() - (read.freshAsOf ?? -Infinity);

  return age >= 0 && age < BACKGROUND_READ_JOIN_MS;
}

type GroupListState = { groups?: WorkspaceGroup[]; error?: unknown; loading: boolean; denied: boolean };

const INITIAL_GROUP_LIST: GroupListState = { loading: true, denied: false };

export type WorkspaceGroupList = GroupListState & {
  /** Reads again and drops any read already in flight, which may predate a change. */
  refresh: () => Promise<void>;
};

/**
 * The workspace group list, revalidated in the background with the last list kept on screen. A
 * panel reads it once and passes it down, so all of its sections show the same copy.
 */
export function useWorkspaceGroupList(workspaceId: string, enabled = true): WorkspaceGroupList {
  const emitter = useContext(AppEventEmitterContext);
  const [state, setState] = useState<GroupListState>(INITIAL_GROUP_LIST);
  const active = useRef(false);
  const sequence = useRef(0);
  const latestRead = useRef<GroupListRead>();
  const [queueRefresh] = useState(() => createCoalescedRefresh<void>());

  const refresh = useCallback(() => {
    const request = ++sequence.current;
    const isCurrent = () => active.current && request === sequence.current;
    const read: GroupListRead = { request, settled: false };

    latestRead.current = read;
    // Keep the last list on screen while it revalidates.
    setState((previous) => ({ ...previous, loading: true }));
    return queueRefresh(async () => {
      try {
        if (!isCurrent()) return;
        const sentAt = Date.now();
        const result = await WorkspaceService.getWorkspaceGroups(workspaceId);

        if (!isCurrent()) return;
        if (!Array.isArray(result?.groups)) throw new Error('Invalid group directory');
        read.freshAsOf = sentAt;
        setState({ groups: result.groups, loading: false, denied: false });
      } catch (error) {
        if (!isCurrent()) return;
        // Losing access is not a connectivity problem: the section simply disappears.
        const denied = isPermissionDenied(error);

        setState((previous) => ({ groups: denied ? undefined : previous.groups, error, loading: false, denied }));
      } finally {
        read.settled = true;
      }
    });
  }, [queueRefresh, workspaceId]);

  useEffect(() => {
    if (!enabled) return;
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
      sequence.current += 1;
      // Another workspace's list, or one this viewer may no longer read, is never shown again.
      setState(INITIAL_GROUP_LIST);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const revalidate = () => {
      void refresh();
    };

    const revalidateInBackground = () => {
      if (!joinsGroupListRead(latestRead.current, sequence.current)) revalidate();
    };

    const visible = () => {
      if (document.visibilityState === 'visible') revalidateInBackground();
    };

    const socket = (readyState: unknown) => {
      if (readyState === WebSocket.OPEN) revalidateInBackground();
    };

    emitter?.on(APP_EVENTS.PERMISSION_CHANGED, revalidate);
    emitter?.on(APP_EVENTS.WEBSOCKET_STATUS, socket);
    window.addEventListener('focus', revalidateInBackground);
    window.addEventListener('online', revalidateInBackground);
    document.addEventListener('visibilitychange', visible);
    return () => {
      emitter?.off(APP_EVENTS.PERMISSION_CHANGED, revalidate);
      emitter?.off(APP_EVENTS.WEBSOCKET_STATUS, socket);
      window.removeEventListener('focus', revalidateInBackground);
      window.removeEventListener('online', revalidateInBackground);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [emitter, enabled, refresh]);

  return useMemo(() => ({ ...state, refresh }), [refresh, state]);
}

/**
 * Read-only "Access to all spaces" summary for the Permissions panel. Coverage is configured per
 * group in People > Groups; this section only lists it and links there.
 */
export function GroupSpaceCoverageSummary({
  workspaceId,
  onOpenGroups,
  groupList,
}: {
  workspaceId: string;
  onOpenGroups?: () => void;
  /** The panel's own group list, shared with its other sections; without it the summary reads one. */
  groupList?: WorkspaceGroupList;
}) {
  const { t } = useTranslation();
  const ownList = useWorkspaceGroupList(workspaceId, !groupList);
  const { groups, error, loading, denied, refresh } = groupList ?? ownList;

  if (denied) return null;
  // Coverage support is server-wide; an empty directory cannot tell either way.
  const supported = !groups || groups.length === 0 || groups.some((group) => group.space_coverage_supported === true);
  const covered = (groups ?? [])
    .filter(
      (group) =>
        group.space_coverage_access_level === AccessLevel.ReadOnly ||
        group.space_coverage_access_level === AccessLevel.ReadAndWrite
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return (
    <SettingsSection title={t('groupSpaceAccess.title')}>
      {supported && (
        <p className='text-sm text-text-secondary'>{t('groupSpaceAccess.summaryDescription')}</p>
      )}
      {!groups && loading && (
        <div role='status' aria-label={t('loading')} className='flex'>
          <Progress />
        </div>
      )}
      {!groups && !loading && error !== undefined && (
        <div role='alert' className='flex flex-wrap items-center gap-3 text-sm text-text-secondary'>
          {t('groupSpaceAccess.loadFailed')}
          <Button variant='outline' size='sm' onClick={() => void refresh()}>
            {t('button.retry')}
          </Button>
        </div>
      )}
      {groups && !supported && (
        <p role='status' className='text-sm text-text-secondary'>
          {t('groupSpaceAccess.unsupported')}
        </p>
      )}
      {groups &&
        supported &&
        (covered.length === 0 ? (
          <p className='text-sm text-text-secondary'>{t('groupSpaceAccess.summaryEmpty')}</p>
        ) : (
          <ul
            aria-label={t('groupSpaceAccess.title')}
            className='flex flex-col rounded-400 border border-border-primary'
            data-testid='group-space-coverage-summary'
          >
            {covered.map((group) => (
              <li
                key={group.group_id}
                className='flex items-center gap-3 border-b border-border-primary px-4 py-3 last:border-b-0'
                data-testid={`group-space-coverage-summary-${group.group_id}`}
              >
                <WorkspaceGroupIcon variant='settings-row' />
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm font-medium text-text-primary'>{group.name}</div>
                  <div className='truncate text-xs text-text-secondary'>
                    {t('workspacePermissions.groupMembers', { count: group.member_count })}
                  </div>
                </div>
                <span className='shrink-0 text-sm text-text-secondary'>
                  {coverageLabel(group.space_coverage_access_level, t)}
                </span>
              </li>
            ))}
          </ul>
        ))}
      {groups && supported && onOpenGroups && (
        <Button
          type='button'
          variant='outline'
          className='self-start'
          onClick={onOpenGroups}
          data-testid='group-space-coverage-manage'
        >
          {t('groupSpaceAccess.manageGroups')}
        </Button>
      )}
    </SettingsSection>
  );
}
