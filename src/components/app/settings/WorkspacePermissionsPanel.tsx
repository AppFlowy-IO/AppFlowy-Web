import { Check, Plus } from 'lucide-react';
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { validate as isUuid } from 'uuid';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { Role, WorkspaceGroup, WorkspaceMember } from '@/application/types';
import {
  SpaceCreatorKind,
  SpaceCreatorPrincipal,
  SpaceCreatorSelection,
  WorkspacePermissionRevision,
  WorkspaceSpaceCreationCapabilities,
  WorkspaceSpaceCreationPolicy,
} from '@/application/workspace-permissions';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { useSpaceCreationCapability } from '@/components/app/hooks/useSpaceCreationCapability';
import {
  SettingsDivider,
  SettingsPanelShell,
  SettingsSection,
} from '@/components/app/settings/billing/SettingsPanelShell';
import { GroupSpaceCoverageSummary } from '@/components/app/settings/GroupSpaceCoverageControl';
import { WorkspaceGroupIcon } from '@/components/app/share/WorkspaceGroupIcon';
import { WorkspaceMemberInlineSearchInput } from '@/components/app/share/WorkspaceMemberInlineSearch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/utils/errors';

import type { TFunction } from 'i18next';

const POLICIES: readonly WorkspaceSpaceCreationPolicy[] = [
  'members_and_owners',
  'owners_only',
  'owners_and_selected_members',
];
const SELECTED_MODE: WorkspaceSpaceCreationPolicy = 'owners_and_selected_members';
/** React already escapes text; i18next escaping would show `&amp;` in names such as "R&D". */
const RAW = { interpolation: { escapeValue: false } };
const SELECTION_PAGE_LIMIT = 200;
/** Rosters are bounded by workspace membership; the cap only stops a cursor that never ends. */
const SELECTION_PAGE_CAP = 100;
const MAX_CANDIDATES = 8;

function revisionKey(revision: WorkspacePermissionRevision): string {
  return `${revision.epoch}:${revision.counter}`;
}

function principalKey(principal: SpaceCreatorPrincipal): string {
  return `${principal.type}:${principal.id.toLowerCase()}`;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Only ordinary Members with a stable UUID can be chosen; Owners already create and Guests never can. */
function isSelectableMember(member: WorkspaceMember): member is WorkspaceMember & { user_uuid: string } {
  return (
    member.role === Role.Member &&
    !member.is_pending_invitation &&
    typeof member.user_uuid === 'string' &&
    isUuid(member.user_uuid)
  );
}

function selectionName(
  row: SpaceCreatorSelection,
  member: WorkspaceMember | undefined,
  group: WorkspaceGroup | undefined,
  t: TFunction
): string {
  if (row.principal.type === 'group') {
    return row.name?.trim() || group?.name?.trim() || t('workspacePermissions.unknownGroup');
  }

  return row.name?.trim() || member?.name?.trim() || member?.email?.trim() || t('workspacePermissions.unknownMember');
}

/** Reads every keyset page so hidden removed entries never cut the visible roster short. */
async function listAllSelections(workspaceId: string, kind: SpaceCreatorKind): Promise<SpaceCreatorSelection[]> {
  const rows: SpaceCreatorSelection[] = [];
  let after: string | undefined;

  for (let page = 0; page < SELECTION_PAGE_CAP; page += 1) {
    const result = await WorkspaceService.listWorkspaceSpaceCreators(workspaceId, {
      kind,
      after,
      limit: SELECTION_PAGE_LIMIT,
    });

    rows.push(...result.selections);
    if (!result.next_cursor || result.next_cursor === after) break;
    after = result.next_cursor;
  }

  return rows;
}

function useAlive() {
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  return alive;
}

export function WorkspacePermissionsPanel({
  workspaceId,
  onOpenGroups,
}: {
  workspaceId: string;
  /** Opens People > Groups, where access to all spaces is configured per group. */
  onOpenGroups?: () => void;
}) {
  const permission = useSpaceCreationCapability(workspaceId);
  const { t } = useTranslation();
  const { capability, status } = permission;

  return (
    <SettingsPanelShell title={t('workspacePermissions.title')} testId='workspace-permissions-panel'>
      {!capability && status === 'loading' && (
        <div role='status' className='flex items-center gap-2 text-sm text-text-secondary'>
          <Progress />
          {t('workspacePermissions.loading')}
        </div>
      )}
      {status === 'unsupported' && (
        <p role='status' className='text-sm text-text-secondary'>
          {t('workspacePermissions.unsupported')}
        </p>
      )}
      {!capability && status === 'error' && (
        <InlineAlert
          message={t(isOffline() ? 'workspacePermissions.offline' : 'workspacePermissions.loadFailed')}
          onRetry={() => void permission.refresh()}
        />
      )}
      {capability && (
        <SpaceCreationSettings
          key={permission.scopeKey}
          capability={capability}
          stale={status === 'error'}
          onRefresh={permission.refresh}
        />
      )}
      {capability?.can_manage_space_creators && (
        <>
          <SettingsDivider />
          <GroupSpaceCoverageSummary key={permission.scopeKey} workspaceId={workspaceId} onOpenGroups={onOpenGroups} />
        </>
      )}
    </SettingsPanelShell>
  );
}

function SpaceCreationSettings({
  capability,
  stale,
  onRefresh,
}: {
  capability: WorkspaceSpaceCreationCapabilities;
  /** The last refresh failed, so the shown authority may be out of date. */
  stale: boolean;
  onRefresh: () => Promise<WorkspaceSpaceCreationCapabilities | undefined>;
}) {
  const { t } = useTranslation();
  const questionId = useId();
  const alive = useAlive();
  const canManage = capability.can_manage_space_creators;
  const selectedSupported = capability.selected_creators_supported;
  const basis = revisionKey(capability.revision);
  const [saving, setSaving] = useState<WorkspaceSpaceCreationPolicy>();
  const [saved, setSaved] = useState<{ policy: WorkspaceSpaceCreationPolicy; basis: string }>();
  const savingRef = useRef(false);
  const undoPolicy = useRef<(previous: WorkspaceSpaceCreationPolicy) => Promise<void>>();
  // A confirmed save stays visible until the capability reports a newer revision.
  const policy = saving ?? (saved?.basis === basis ? saved.policy : capability.policy);
  const rosterEnabled = canManage && selectedSupported;
  const roster = useSpaceCreatorRoster(capability, rosterEnabled, rosterEnabled && policy === SELECTED_MODE);

  const choosePolicy = async (next: WorkspaceSpaceCreationPolicy, offerUndo = true) => {
    if (savingRef.current || !canManage || stale || next === policy) return;
    if (next === SELECTED_MODE && !selectedSupported) return;
    const previous = policy;
    const startBasis = basis;

    savingRef.current = true;
    setSaving(next);
    try {
      await WorkspaceService.setWorkspaceSpaceCreationPolicy(capability.workspace_id, next);
      if (alive.current) setSaved({ policy: next, basis: startBasis });
      toast.success(
        t('workspacePermissions.policyUpdated'),
        offerUndo
          ? {
              action: {
                label: t('workspacePermissions.undo'),
                onClick: () => {
                  void undoPolicy.current?.(previous);
                },
              },
            }
          : undefined
      );
      void onRefresh();
    } catch (error) {
      toast.error(getErrorMessage(error, t('workspacePermissions.saveFailed')));
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(undefined);
    }
  };

  // Undo may run after newer renders (or after leaving the panel); it always uses the latest state.
  undoPolicy.current = (previous: WorkspaceSpaceCreationPolicy) => choosePolicy(previous, false);

  return (
    <SettingsSection title={t('workspacePermissions.createSpaces')}>
      {/* Page text, not a hover tooltip, so keyboard and screen reader users get it too. */}
      <p className='text-sm text-text-secondary'>{t('workspacePermissions.explanation')}</p>
      <p role='status' className='text-sm text-text-primary'>
        {t(capability.can_create_space ? 'workspacePermissions.allowed' : 'workspacePermissions.denied')}
      </p>
      {stale && (
        <InlineAlert
          message={t(isOffline() ? 'workspacePermissions.offline' : 'workspacePermissions.refreshFailed')}
          onRetry={() => void onRefresh()}
        />
      )}
      <div className='flex flex-col gap-2'>
        <div id={questionId} className='text-sm font-medium text-text-primary'>
          {t('workspacePermissions.whoCanCreate')}
        </div>
        <PolicyCards
          labelledBy={questionId}
          value={policy}
          saving={saving}
          disabled={!canManage || stale || saving !== undefined}
          selectedSupported={selectedSupported}
          onSelect={(next) => void choosePolicy(next)}
        />
        {!canManage && <p className='text-sm text-text-secondary'>{t('workspacePermissions.ownerRequired')}</p>}
      </div>
      {rosterEnabled &&
        (policy === SELECTED_MODE ? (
          <SelectedCreators capability={capability} roster={roster} disabled={stale} />
        ) : (
          roster.rows !== undefined &&
          roster.rows.length > 0 && (
            <p className='text-sm text-text-secondary' data-testid='space-creator-saved-selections'>
              {t('workspacePermissions.savedSelections', { count: roster.rows.length })}
            </p>
          )
        ))}
    </SettingsSection>
  );
}

function PolicyCards({
  labelledBy,
  value,
  saving,
  disabled,
  selectedSupported,
  onSelect,
}: {
  labelledBy: string;
  value: WorkspaceSpaceCreationPolicy;
  saving?: WorkspaceSpaceCreationPolicy;
  disabled: boolean;
  selectedSupported: boolean;
  onSelect: (policy: WorkspaceSpaceCreationPolicy) => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();

  return (
    <div
      role='group'
      aria-labelledby={labelledBy}
      className='grid grid-cols-1 gap-3 lg:grid-cols-3'
      data-testid='space-creation-policy-options'
    >
      {POLICIES.map((option) => {
        const selected = option === value;
        const unavailable = option === SELECTED_MODE && !selectedSupported;
        const titleId = `${baseId}-${option}-title`;
        const descriptionId = `${baseId}-${option}-description`;

        return (
          <button
            key={option}
            type='button'
            aria-pressed={selected}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            disabled={disabled || unavailable}
            onClick={() => onSelect(option)}
            data-testid={`space-creation-policy-${option}`}
            className={cn(
              'relative flex flex-col items-start gap-1.5 rounded-400 border px-3 py-3 pr-8 text-left transition-colors lg:min-h-[88px]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-theme-thick',
              'disabled:cursor-not-allowed',
              !selected && 'disabled:opacity-60',
              selected
                ? 'border-border-theme-thick bg-fill-theme-select ring-1 ring-border-theme-thick'
                : 'border-border-primary hover:bg-fill-content-hover'
            )}
          >
            {saving === option ? (
              <span className='absolute right-2 top-2 flex h-5 w-5 items-center justify-center' aria-hidden='true'>
                <Progress variant='primary' />
              </span>
            ) : (
              selected && (
                <span
                  className='absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-fill-theme-thick text-text-on-fill'
                  aria-hidden='true'
                >
                  <Check className='h-3.5 w-3.5' />
                </span>
              )
            )}
            <span id={titleId} className='text-sm font-medium text-text-primary'>
              {t(`workspacePermissions.policies.${option}`)}
            </span>
            <span id={descriptionId} className='text-xs leading-4 text-text-secondary'>
              {t(
                unavailable
                  ? 'workspacePermissions.selectedUnsupported'
                  : `workspacePermissions.policyDescriptions.${option}`
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type DirectoryStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SpaceCreatorRoster {
  /** Current (not removed) selections; undefined until the first read finishes. */
  rows?: SpaceCreatorSelection[];
  loadError: unknown;
  reload: () => void;
  /** Applies a confirmed grant/removal locally and fences reads that started before it. */
  applyLocal: (update: (rows: SpaceCreatorSelection[]) => SpaceCreatorSelection[]) => void;
  members: WorkspaceMember[];
  membersByUuid: Map<string, WorkspaceMember>;
  groups: WorkspaceGroup[];
  groupsById: Map<string, WorkspaceGroup>;
  directoryStatus: DirectoryStatus;
  reloadDirectory: () => void;
}

/**
 * Selections and the people/group directory, revalidated in the background: rows stay on screen
 * while a permission change re-reads them, and nothing here is reset by a capability refresh.
 */
function useSpaceCreatorRoster(
  capability: WorkspaceSpaceCreationCapabilities,
  enabled: boolean,
  directoryEnabled: boolean
): SpaceCreatorRoster {
  const emitter = useContext(AppEventEmitterContext);
  const alive = useAlive();
  const workspaceId = capability.workspace_id;
  const includeGroups = capability.group_selection_supported;
  const revision = revisionKey(capability.revision);
  const [rows, setRows] = useState<SpaceCreatorSelection[]>();
  const [loadError, setLoadError] = useState<unknown>();
  const [reloadToken, setReloadToken] = useState(0);
  const localVersion = useRef(0);
  const [directory, setDirectory] = useState<{
    members: WorkspaceMember[];
    groups: WorkspaceGroup[];
    status: DirectoryStatus;
  }>({ members: [], groups: [], status: 'idle' });
  const [directoryToken, setDirectoryToken] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const startedAt = localVersion.current;
    const kinds: SpaceCreatorKind[] = includeGroups ? ['user', 'group'] : ['user'];

    void Promise.all(kinds.map((kind) => listAllSelections(workspaceId, kind))).then(
      (pages) => {
        if (cancelled) return;
        // A grant or removal confirmed meanwhile is newer than this read; read again.
        if (localVersion.current !== startedAt) {
          setReloadToken((value) => value + 1);
          return;
        }

        setRows(pages.flat().filter((row) => row.revoked_at === null));
        setLoadError(undefined);
      },
      (error) => {
        if (!cancelled) setLoadError(error);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, includeGroups, reloadToken, revision, workspaceId]);

  useEffect(() => {
    if (!directoryEnabled) return;
    let cancelled = false;

    setDirectory((previous) => (previous.status === 'ready' ? previous : { ...previous, status: 'loading' }));
    void Promise.all([
      WorkspaceService.getMembers(workspaceId),
      includeGroups
        ? WorkspaceService.getWorkspaceGroups(workspaceId).then((result) => result.groups ?? [])
        : Promise.resolve<WorkspaceGroup[]>([]),
    ]).then(
      ([members, groups]) => {
        if (!cancelled) setDirectory({ members, groups, status: 'ready' });
      },
      () => {
        if (!cancelled) setDirectory((previous) => ({ ...previous, status: 'error' }));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [directoryEnabled, directoryToken, includeGroups, workspaceId]);

  useEffect(() => {
    if (!directoryEnabled) return;
    const refresh = () => setDirectoryToken((value) => value + 1);

    emitter?.on(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, refresh);
    return () => {
      emitter?.off(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, refresh);
    };
  }, [directoryEnabled, emitter]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  const reloadDirectory = useCallback(() => setDirectoryToken((value) => value + 1), []);
  const applyLocal = useCallback(
    (update: (current: SpaceCreatorSelection[]) => SpaceCreatorSelection[]) => {
      localVersion.current += 1;
      if (alive.current) setRows((current) => update(current ?? []));
    },
    [alive]
  );
  const membersByUuid = useMemo(() => {
    const result = new Map<string, WorkspaceMember>();

    for (const member of directory.members) {
      if (typeof member.user_uuid === 'string') result.set(member.user_uuid.toLowerCase(), member);
    }

    return result;
  }, [directory.members]);
  const groupsById = useMemo(
    () => new Map(directory.groups.map((group) => [group.group_id.toLowerCase(), group])),
    [directory.groups]
  );

  return {
    rows,
    loadError,
    reload,
    applyLocal,
    members: directory.members,
    membersByUuid,
    groups: directory.groups,
    groupsById,
    directoryStatus: directory.status,
    reloadDirectory,
  };
}

type Candidate = {
  principal: SpaceCreatorPrincipal;
  name: string;
  subline?: string;
  avatarUrl?: string;
};

function SelectedCreators({
  capability,
  roster,
  disabled,
}: {
  capability: WorkspaceSpaceCreationCapabilities;
  roster: SpaceCreatorRoster;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const alive = useAlive();
  const workspaceId = capability.workspace_id;
  const groupsSupported = capability.group_selection_supported;
  const groupsAddable = groupsSupported && capability.can_grant_creator_groups;
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Record<string, true>>({});
  const pendingRef = useRef(new Set<string>());
  const query = search.trim().toLowerCase();
  const rows = roster.rows;
  const selectedKeys = useMemo(() => new Set((rows ?? []).map((row) => principalKey(row.principal))), [rows]);

  const candidates = useMemo<Candidate[]>(() => {
    if (!query) return [];
    const members = roster.members
      .filter(isSelectableMember)
      .filter((member) => !selectedKeys.has(principalKey({ type: 'user', id: member.user_uuid })))
      .filter(
        (member) =>
          member.name?.toLowerCase().includes(query) || member.email?.toLowerCase().includes(query)
      )
      .slice(0, MAX_CANDIDATES)
      .map<Candidate>((member) => {
        const name = member.name?.trim() || member.email;

        return {
          principal: { type: 'user', id: member.user_uuid },
          name,
          subline: member.email && member.email !== name ? member.email : undefined,
          avatarUrl: member.avatar_url,
        };
      });
    const groups = groupsAddable
      ? roster.groups
          .filter((group) => !selectedKeys.has(principalKey({ type: 'group', id: group.group_id })))
          .filter((group) => group.name.toLowerCase().includes(query))
          .slice(0, MAX_CANDIDATES)
          .map<Candidate>((group) => ({
            principal: { type: 'group', id: group.group_id },
            name: group.name,
            subline: t('workspacePermissions.groupMembers', { count: group.member_count }),
          }))
      : [];

    return [...members, ...groups];
  }, [groupsAddable, query, roster.groups, roster.members, selectedKeys, t]);

  const sortedRows = useMemo(() => {
    const named = (rows ?? []).map((row) => {
      const id = row.principal.id.toLowerCase();
      const member = row.principal.type === 'user' ? roster.membersByUuid.get(id) : undefined;
      const group = row.principal.type === 'group' ? roster.groupsById.get(id) : undefined;

      return { row, member, group, name: selectionName(row, member, group, t) };
    });

    return named.sort(
      (left, right) =>
        Number(left.row.principal.type === 'group') - Number(right.row.principal.type === 'group') ||
        left.name.localeCompare(right.name)
    );
  }, [roster.groupsById, roster.membersByUuid, rows, t]);

  const begin = (key: string) => {
    if (pendingRef.current.has(key)) return false;
    pendingRef.current.add(key);
    setPending((current) => ({ ...current, [key]: true }));
    return true;
  };

  const end = (key: string) => {
    pendingRef.current.delete(key);
    if (!alive.current) return;
    setPending((current) => {
      const next = { ...current };

      delete next[key];
      return next;
    });
  };

  const grant = async (principal: SpaceCreatorPrincipal, name: string, restored?: SpaceCreatorSelection) => {
    const key = principalKey(principal);

    if (!begin(key)) return false;
    try {
      await WorkspaceService.setWorkspaceSpaceCreator(workspaceId, principal, true);
      roster.applyLocal((current) =>
        current.some((row) => principalKey(row.principal) === key)
          ? current
          : [
              ...current,
              restored ?? {
                principal,
                name,
                granted_by: null,
                granted_at: new Date().toISOString(),
                revoked_at: null,
                eligible: true,
              },
            ]
      );
      toast.success(t('workspacePermissions.addedToast', { name, ...RAW }));
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, t('workspacePermissions.saveFailed')));
      return false;
    } finally {
      end(key);
    }
  };

  const add = async (candidate: Candidate) => {
    if (disabled) return;
    if ((await grant(candidate.principal, candidate.name)) && alive.current) setSearch('');
  };

  const remove = async (row: SpaceCreatorSelection, name: string) => {
    const key = principalKey(row.principal);

    if (disabled || !begin(key)) return;
    try {
      await WorkspaceService.setWorkspaceSpaceCreator(workspaceId, row.principal, false);
      roster.applyLocal((current) => current.filter((item) => principalKey(item.principal) !== key));
      // Undo re-grants, so offer it only when a fresh grant would be accepted.
      const undoable = row.eligible && (row.principal.type === 'user' || capability.can_grant_creator_groups);

      toast.success(
        t('workspacePermissions.removedToast', { name, ...RAW }),
        undoable
          ? {
              action: {
                label: t('workspacePermissions.undo'),
                onClick: () => {
                  void grant(row.principal, name, { ...row, revoked_at: null });
                },
              },
            }
          : undefined
      );
    } catch (error) {
      toast.error(getErrorMessage(error, t('workspacePermissions.saveFailed')));
    } finally {
      end(key);
    }
  };

  return (
    <section aria-labelledby={headingId} className='flex flex-col gap-3' data-testid='space-creator-selections'>
      <div id={headingId} className='text-sm font-medium text-text-primary'>
        {t('workspacePermissions.selectionsTitle')}
      </div>
      <WorkspaceMemberInlineSearchInput
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t(
          groupsAddable ? 'workspacePermissions.searchMembersOrGroups' : 'workspacePermissions.searchMembers'
        )}
        addButtonLabel={t(groupsAddable ? 'workspacePermissions.addMembersOrGroups' : 'workspacePermissions.addMembers')}
        inputDisabled={disabled}
        addButtonDisabled={disabled}
        inputTestId='space-creator-search-input'
        onInputKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setSearch('');
            return;
          }

          if (event.key !== 'Enter' || candidates.length !== 1) return;
          event.preventDefault();
          void add(candidates[0]);
        }}
      />
      {query && (
        <div
          className='flex flex-col gap-2 border-y border-border-primary py-3'
          aria-live='polite'
          data-testid='space-creator-candidates'
        >
          <div className='text-sm font-medium text-text-secondary'>{t('workspacePermissions.notSelected')}</div>
          {candidates.length === 0 && roster.directoryStatus === 'loading' ? (
            <div role='status' aria-label={t('loading')} className='flex justify-center py-2'>
              <Progress />
            </div>
          ) : candidates.length === 0 ? (
            <div className='py-2 text-center text-sm text-text-secondary'>{t('workspacePermissions.noMatches')}</div>
          ) : (
            candidates.map((candidate) => {
              const key = principalKey(candidate.principal);

              return (
                <div
                  key={key}
                  className='flex items-center gap-3 rounded-300 px-2 py-2 hover:bg-fill-content-hover'
                  data-testid={`space-creator-candidate-${candidate.principal.type}-${candidate.principal.id}`}
                >
                  <PrincipalAvatar
                    kind={candidate.principal.type}
                    name={candidate.name}
                    avatarUrl={candidate.avatarUrl}
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium text-text-primary'>{candidate.name}</div>
                    {candidate.subline && (
                      <div className='truncate text-xs text-text-secondary'>{candidate.subline}</div>
                    )}
                  </div>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    aria-label={t('workspacePermissions.addNamed', { name: candidate.name, ...RAW })}
                    className='text-text-action hover:text-text-action-hover focus-visible:ring-1 focus-visible:ring-border-theme-thick'
                    disabled={disabled}
                    loading={pending[key] === true}
                    onClick={() => void add(candidate)}
                  >
                    {pending[key] ? (
                      <Progress variant='inherit' />
                    ) : (
                      <>
                        <Plus aria-hidden='true' className='h-4 w-4' />
                        {t('workspacePermissions.add')}
                      </>
                    )}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}
      {groupsSupported && !capability.can_grant_creator_groups && (
        <p className='text-xs text-text-secondary'>{t('workspacePermissions.groupEntitlement')}</p>
      )}
      {roster.directoryStatus === 'error' && (
        <InlineAlert message={t('workspacePermissions.directoryError')} onRetry={roster.reloadDirectory} />
      )}
      {roster.loadError !== undefined && (
        <InlineAlert message={t('workspacePermissions.selectionsError')} onRetry={roster.reload} />
      )}
      {rows === undefined ? (
        roster.loadError === undefined && (
          <div role='status' aria-label={t('loading')} className='flex'>
            <Progress />
          </div>
        )
      ) : rows.length === 0 ? (
        <p className='text-sm text-text-secondary'>{t('workspacePermissions.noSelections')}</p>
      ) : (
        <ul aria-labelledby={headingId} className='flex flex-col'>
          {sortedRows.map(({ row, member, group, name }) => {
            const key = principalKey(row.principal);
            const isUser = row.principal.type === 'user';
            const subline = isUser
              ? member?.email && member.email !== name
                ? member.email
                : undefined
              : group
              ? t('workspacePermissions.groupMembers', { count: group.member_count })
              : undefined;

            return (
              <li
                key={key}
                className='flex items-center gap-3 border-b border-border-primary py-3 last:border-b-0'
                data-testid={`space-creator-row-${row.principal.type}-${row.principal.id}`}
              >
                <PrincipalAvatar kind={row.principal.type} name={name} avatarUrl={member?.avatar_url} />
                <div className='flex min-w-0 flex-1 flex-col'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <span className='truncate text-sm font-medium text-text-primary'>{name}</span>
                    {!row.eligible && (
                      <NotEligibleBadge
                        hint={t(
                          isUser ? 'workspacePermissions.notEligibleHint' : 'workspacePermissions.groupNotEligibleHint'
                        )}
                      />
                    )}
                  </div>
                  {subline && <span className='truncate text-xs text-text-secondary'>{subline}</span>}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={t('workspacePermissions.removeNamed', { name, ...RAW })}
                      disabled={disabled}
                      loading={pending[key] === true}
                      onClick={() => void remove(row, name)}
                      data-testid='space-creator-remove'
                    >
                      {pending[key] ? (
                        <Progress variant='inherit' />
                      ) : (
                        <CloseIcon aria-hidden='true' className='h-4 w-4' />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('workspacePermissions.remove')}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PrincipalAvatar({ kind, name, avatarUrl }: { kind: SpaceCreatorKind; name: string; avatarUrl?: string }) {
  if (kind === 'group') return <WorkspaceGroupIcon variant='settings-row' />;

  return (
    <Avatar size='md'>
      <AvatarImage src={avatarUrl || undefined} alt='' />
      <AvatarFallback name={name}>{name.trim().charAt(0).toUpperCase() || '?'}</AvatarFallback>
    </Avatar>
  );
}

function NotEligibleBadge({ hint }: { hint: string }) {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className='shrink-0 cursor-default rounded-full bg-fill-warning-light px-2 py-[1px] text-xs text-text-warning-on-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
          data-testid='space-creator-not-eligible'
        >
          {t('workspacePermissions.notEligible')}
          <span className='sr-only'>{`: ${hint}`}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-[280px]'>{hint}</TooltipContent>
    </Tooltip>
  );
}

function InlineAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      role='alert'
      className='flex flex-wrap items-center gap-3 rounded-400 border border-border-primary px-3 py-2 text-sm text-text-secondary'
    >
      <span>{message}</span>
      <Button type='button' variant='outline' size='sm' onClick={onRetry}>
        {t('button.retry')}
      </Button>
    </div>
  );
}
