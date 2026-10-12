import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validate as isUuid } from 'uuid';

import { WorkspaceService } from '@/application/services/domains';
import { Role } from '@/application/types';
import {
  SpaceCreatorKind,
  SpaceCreatorPrincipal,
  SpaceCreatorSelections,
  WorkspaceSpaceCreationCapabilities,
  WorkspaceSpaceCreationPolicy,
} from '@/application/workspace-permissions';
import { useSpaceCreationCapability } from '@/components/app/hooks/useSpaceCreationCapability';
import { SettingsPanelShell, SettingsSection } from '@/components/app/settings/billing/SettingsPanelShell';
import { GroupSpaceAccessSettings } from '@/components/app/settings/GroupSpaceAccessSettings';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { getErrorMessage } from '@/utils/errors';

const POLICIES: WorkspaceSpaceCreationPolicy[] = ['members_and_owners', 'owners_only', 'owners_and_selected_members'];

export function WorkspacePermissionsPanel({ workspaceId }: { workspaceId: string }) {
  const permission = useSpaceCreationCapability(workspaceId);
  const { t } = useTranslation();

  return (
    <SettingsPanelShell title={t('workspacePermissions.title')} testId='workspace-permissions-panel'>
      {permission.status === 'loading' && (
        <div role='status'>
          <Progress />
          {t('workspacePermissions.loading')}
        </div>
      )}
      {permission.status === 'unsupported' && <p role='status'>{t('workspacePermissions.unsupported')}</p>}
      {permission.status === 'error' && <p role='alert'>{t('workspacePermissions.loadError')}</p>}
      {(permission.status === 'unsupported' || permission.status === 'error') && (
        <Button
          variant='outline'
          onClick={() => {
            void permission.refresh();
          }}
        >
          {t('button.retry')}
        </Button>
      )}
      {permission.capability && (
        <SpaceCreationSettings
          key={permission.scopeKey}
          capability={permission.capability}
          onRefresh={permission.refresh}
        />
      )}
      <GroupSpaceAccessSettings workspaceId={workspaceId} />
    </SettingsPanelShell>
  );
}

function SpaceCreationSettings({
  capability,
  onRefresh,
}: {
  capability: WorkspaceSpaceCreationCapabilities;
  onRefresh: () => Promise<WorkspaceSpaceCreationCapabilities | undefined>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<unknown>();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setPolicy = async (policy: WorkspaceSpaceCreationPolicy) => {
    if (busyRef.current || !capability.can_manage_space_creators || policy === capability.policy) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await WorkspaceService.setWorkspaceSpaceCreationPolicy(capability.workspace_id, policy);
      if (alive.current) await onRefresh();
    } catch (failure) {
      if (alive.current) setError(failure);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <SettingsSection title={t('workspacePermissions.createSpaces')}>
      <p className='text-sm text-text-secondary'>{t('workspacePermissions.explanation')}</p>
      <p role='status'>
        {t(capability.can_create_space ? 'workspacePermissions.allowed' : 'workspacePermissions.denied')}
      </p>
      {!capability.can_manage_space_creators && <p>{t('workspacePermissions.ownerRequired')}</p>}
      <fieldset disabled={busy || !capability.can_manage_space_creators} className='flex flex-col gap-3'>
        <legend className='mb-2 text-sm font-medium'>{t('workspacePermissions.whoCanCreate')}</legend>
        {POLICIES.map((policy) => (
          <label key={policy} className='flex items-center gap-2 text-sm'>
            <input
              type='radio'
              name='space-creation-policy'
              value={policy}
              checked={policy === capability.policy}
              disabled={policy === 'owners_and_selected_members' && !capability.selected_creators_supported}
              onChange={() => {
                void setPolicy(policy);
              }}
            />
            {t(`workspacePermissions.policies.${policy}`)}
          </label>
        ))}
      </fieldset>
      {error !== undefined && <p role='alert'>{getErrorMessage(error)}</p>}
      {capability.can_manage_space_creators && capability.selected_creators_supported && (
        <>
          <p className='text-sm text-text-secondary'>{t('workspacePermissions.retainedSelections')}</p>
          <SpaceCreatorList kind='user' capability={capability} />
          {capability.group_selection_supported && <SpaceCreatorList kind='group' capability={capability} />}
        </>
      )}
    </SettingsSection>
  );
}

type Candidate = { id: string; label: string };

/** A bounded selection roster, independent of the workspace's current policy mode. */
function SpaceCreatorList({
  kind,
  capability,
}: {
  kind: SpaceCreatorKind;
  capability: WorkspaceSpaceCreationCapabilities;
}) {
  const { t } = useTranslation();
  const { workspace_id: workspaceId } = capability;
  const canGrant = kind === 'user' || capability.can_grant_creator_groups;
  const [page, setPage] = useState<SpaceCreatorSelections>();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<unknown>();
  const [directoryError, setDirectoryError] = useState(false);
  const [reload, setReload] = useState(0);
  const sequence = useRef(0);

  // Every authority change invalidates even an open roster; a stale Owner cannot keep editing it.
  useEffect(() => {
    let cancelled = false;
    const request = ++sequence.current;

    setPage(undefined);
    setCandidates([]);
    setError(undefined);
    setDirectoryError(false);
    void WorkspaceService.listWorkspaceSpaceCreators(workspaceId, { kind }).then(
      (result) => {
        if (!cancelled && sequence.current === request) setPage(result);
      },
      (failure) => {
        if (!cancelled && sequence.current === request) setError(failure);
      }
    );
    if (canGrant) {
      const directory =
        kind === 'user'
          ? WorkspaceService.getMembers(workspaceId).then((members) =>
              members
                .filter(
                  (member) =>
                    member.role === Role.Member &&
                    !member.is_pending_invitation &&
                    typeof member.user_uuid === 'string' &&
                    isUuid(member.user_uuid)
                )
                .map((member) => ({
                  id: member.user_uuid!,
                  label: member.name ? `${member.name} (${member.email})` : member.email,
                }))
            )
          : WorkspaceService.getWorkspaceGroups(workspaceId).then((groups) =>
              groups.groups.map((group) => ({
                id: group.group_id,
                label: group.name,
              }))
            );

      void directory.then(
        (result) => {
          if (!cancelled && sequence.current === request) setCandidates(result);
        },
        () => {
          if (!cancelled && sequence.current === request) setDirectoryError(true);
        }
      );
    }

    return () => {
      cancelled = true;
      sequence.current += 1;
    };
  }, [workspaceId, kind, canGrant, capability.revision.epoch, capability.revision.counter, reload]);

  const mutate = async (principal: SpaceCreatorPrincipal, granted: boolean) => {
    if (busyRef.current || !capability.can_manage_space_creators || (granted && !canGrant)) return;
    const request = sequence.current;

    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await WorkspaceService.setWorkspaceSpaceCreator(workspaceId, principal, granted);
      if (sequence.current !== request) return;
      setTarget('');
      setReload((value) => value + 1);
    } catch (failure) {
      if (sequence.current === request) setError(failure);
    } finally {
      busyRef.current = false;
      // Resetting this flag also covers a concurrent notification that already refreshed the list.
      setBusy(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (!page?.next_cursor || busyRef.current) return;
    const request = sequence.current;

    busyRef.current = true;
    setBusy(true);
    try {
      const result = await WorkspaceService.listWorkspaceSpaceCreators(workspaceId, { kind, after: page.next_cursor });

      if (sequence.current !== request) return;
      setPage({ selections: [...page.selections, ...result.selections], next_cursor: result.next_cursor });
    } catch (failure) {
      if (sequence.current === request) setError(failure);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [kind, page, workspaceId]);

  const selected = new Set(page?.selections.filter((row) => row.revoked_at === null).map((row) => row.principal.id));
  const matches = candidates.filter(
    (candidate) => !selected.has(candidate.id) && candidate.label.toLowerCase().includes(query.toLowerCase())
  );
  const label = t(kind === 'user' ? 'workspacePermissions.users' : 'workspacePermissions.groups');

  return (
    <section aria-label={label} className='flex flex-col gap-3 rounded-lg border border-border-primary p-4'>
      <h3 className='font-medium'>{label}</h3>
      {!canGrant && <p className='text-sm'>{t('workspacePermissions.groupEntitlement')}</p>}
      {directoryError && (
        <div role='alert'>
          {t('workspacePermissions.directoryError')}
          <Button variant='outline' onClick={() => setReload((value) => value + 1)}>
            {t('button.retry')}
          </Button>
        </div>
      )}
      {canGrant && (
        <fieldset disabled={busy || !page} className='flex flex-col gap-2'>
          <SearchInput
            aria-label={t('workspacePermissions.search', { kind: label })}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('workspacePermissions.search', { kind: label })}
          />
          <div className='flex gap-2'>
            <select
              aria-label={t('workspacePermissions.select', { kind: label })}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className='min-w-0 flex-1 rounded border border-border-primary bg-surface-primary p-2'
            >
              <option value=''>{t('workspacePermissions.select', { kind: label })}</option>
              {matches.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <Button
              disabled={!matches.some((candidate) => candidate.id === target)}
              onClick={() => {
                void mutate({ type: kind, id: target }, true);
              }}
            >
              {t('workspacePermissions.add')}
            </Button>
          </div>
        </fieldset>
      )}
      {error !== undefined && (
        <div role='alert'>
          {getErrorMessage(error)}
          <Button variant='outline' onClick={() => setReload((value) => value + 1)}>
            {t('button.retry')}
          </Button>
        </div>
      )}
      {!page && error === undefined && <div role='status'>{t('workspacePermissions.loading')}</div>}
      {page?.selections.length === 0 && <p>{t('workspacePermissions.noSelections')}</p>}
      <ul className='flex flex-col gap-2'>
        {page?.selections.map((row) => {
          const retained = row.revoked_at === null;
          const active = retained && row.eligible && capability.policy === 'owners_and_selected_members';

          return (
            <li
              key={row.principal.id}
              className='flex items-center justify-between gap-3 border-t border-border-primary py-2'
            >
              <div className='min-w-0'>
                <p className='truncate'>{row.name || row.principal.id}</p>
                <p className='text-sm text-text-secondary'>
                  {t(active ? 'workspacePermissions.active' : 'workspacePermissions.inactive')}
                </p>
              </div>
              <Button
                variant='outline'
                disabled={busy || (!retained && (!row.eligible || !canGrant))}
                onClick={() => {
                  void mutate(row.principal, !retained);
                }}
              >
                {t(retained ? 'workspacePermissions.remove' : 'workspacePermissions.selectAgain')}
              </Button>
            </li>
          );
        })}
      </ul>
      {page?.next_cursor && (
        <Button
          variant='outline'
          disabled={busy}
          onClick={() => {
            void loadMore();
          }}
        >
          {t('workspacePermissions.loadMore')}
        </Button>
      )}
    </section>
  );
}
