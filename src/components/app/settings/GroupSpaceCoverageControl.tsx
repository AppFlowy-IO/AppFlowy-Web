import { ChevronDown } from 'lucide-react';
import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
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
import { createCoalescedRefresh } from '@/utils/coalesced-refresh';
import { getErrorMessage } from '@/utils/errors';

import type { TFunction } from 'i18next';

/** React already escapes text; i18next escaping would show `&amp;` in names such as "R&D". */
const RAW = { interpolation: { escapeValue: false } };
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
  group: WorkspaceGroup;
  /** False once the account/workspace scope that opened the dialog is gone. */
  isCurrent?: () => boolean;
  /** Reloads the owning group list after a confirmed change. */
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
  // A confirmed save is shown until the group list delivers a different server value.
  const [saved, setSaved] = useState<{ basis: GroupSpaceCoverageLevel | undefined; level: GroupSpaceCoverageLevel }>();
  const [pending, setPending] = useState<{ level: GroupSpaceCoverageLevel }>();
  const [confirming, setConfirming] = useState<{ level: GroupSpaceCoverageLevel }>();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const confirmed = saved && saved.basis === serverLevel ? saved.level : serverLevel;
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
    const basis = serverLevel;
    const stillCurrent = () => isCurrent?.() ?? true;

    setPending({ level });
    try {
      const result = await setGroupSpaceCoverage(workspaceId, group.group_id, level, stillCurrent);

      if (alive.current) setSaved({ basis, level: result.access_level });
      toast.success(t('groupSpaceAccess.updated'));
      void Promise.resolve(onChanged?.()).catch(() => undefined);
    } catch (error) {
      // A switched account/workspace already discarded this dialog; its error is not actionable.
      if (stillCurrent()) toast.error(getErrorMessage(error, t('groupSpaceAccess.invalidResponse')));
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

type SummaryState = { groups?: WorkspaceGroup[]; error?: unknown; loading: boolean; denied: boolean };

/**
 * Read-only "Access to all spaces" summary for the Permissions panel. Coverage is configured per
 * group in People > Groups; this section only lists it and links there.
 */
export function GroupSpaceCoverageSummary({
  workspaceId,
  onOpenGroups,
}: {
  workspaceId: string;
  onOpenGroups?: () => void;
}) {
  const { t } = useTranslation();
  const emitter = useContext(AppEventEmitterContext);
  const [state, setState] = useState<SummaryState>({ loading: true, denied: false });
  const alive = useRef(true);
  const sequence = useRef(0);
  const [queueRefresh] = useState(() => createCoalescedRefresh<void>());

  const refresh = useCallback(() => {
    const request = ++sequence.current;
    const isCurrent = () => alive.current && request === sequence.current;

    // Keep the last list on screen while it revalidates.
    setState((previous) => ({ ...previous, loading: true }));
    return queueRefresh(async () => {
      if (!isCurrent()) return;
      try {
        const result = await WorkspaceService.getWorkspaceGroups(workspaceId);

        if (!isCurrent()) return;
        if (!Array.isArray(result?.groups)) throw new Error('Invalid group directory');
        setState({ groups: result.groups, loading: false, denied: false });
      } catch (error) {
        if (!isCurrent()) return;
        // Losing access is not a connectivity problem: the section simply disappears.
        const denied = isPermissionDenied(error);

        setState((previous) => ({ groups: denied ? undefined : previous.groups, error, loading: false, denied }));
      }
    });
  }, [queueRefresh, workspaceId]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const revalidate = () => {
      void refresh();
    };

    const visible = () => {
      if (document.visibilityState === 'visible') revalidate();
    };

    emitter?.on(APP_EVENTS.PERMISSION_CHANGED, revalidate);
    window.addEventListener('focus', revalidate);
    window.addEventListener('online', revalidate);
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive.current = false;
      sequence.current += 1;
      emitter?.off(APP_EVENTS.PERMISSION_CHANGED, revalidate);
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('online', revalidate);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [emitter, refresh]);

  if (state.denied) return null;
  const groups = state.groups;
  // Coverage support is server-wide; an empty directory cannot tell either way.
  const supported = !groups || groups.length === 0 || groups.some((group) => group.space_coverage_supported === true);
  const covered = (groups ?? [])
    .filter(
      (group) =>
        group.space_coverage_access_level === AccessLevel.ReadOnly ||
        group.space_coverage_access_level === AccessLevel.ReadAndWrite
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const location = `${t('settings.appearance.people.label')} > ${t('settings.appearance.people.groupsTab')}`;

  return (
    <SettingsSection title={t('groupSpaceAccess.title')}>
      {supported && (
        <p className='text-sm text-text-secondary'>{t('groupSpaceAccess.summaryDescription', { location, ...RAW })}</p>
      )}
      {!groups && state.loading && (
        <div role='status' aria-label={t('loading')} className='flex'>
          <Progress />
        </div>
      )}
      {!groups && !state.loading && state.error !== undefined && (
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
