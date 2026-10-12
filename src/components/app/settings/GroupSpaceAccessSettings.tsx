import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import {
  isGroupSpaceCoverageLevel,
  setGroupSpaceCoverage,
} from '@/application/services/js-services/http/group-space-coverage-api';
import { GroupSpaceCoverageLevel, WorkspaceGroup } from '@/application/types';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { SettingsSection } from '@/components/app/settings/billing/SettingsPanelShell';
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { createCoalescedRefresh } from '@/utils/coalesced-refresh';
import { getErrorMessage, isUnsupportedRouteError } from '@/utils/errors';
import { getConfigValue } from '@/utils/runtime-config';

const PAGE_SIZE = 25;

export function GroupSpaceAccessSettings({ workspaceId }: { workspaceId: string }) {
  const userId = useAuthenticatedUserIdOptional();
  const auth = useContext(AuthInternalContext);
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const enabled = Boolean(userId && auth?.isAuthenticated && auth.currentWorkspaceId === workspaceId);

  return (
    <GroupSpaceAccessContent
      key={JSON.stringify([serverUrl, userId, workspaceId, enabled])}
      workspaceId={workspaceId}
      enabled={enabled}
    />
  );
}

function GroupSpaceAccessContent({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const { t } = useTranslation();
  const emitter = useContext(AppEventEmitterContext);
  const [groups, setGroups] = useState<WorkspaceGroup[]>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [drafts, setDrafts] = useState<Record<string, GroupSpaceCoverageLevel>>({});
  const [error, setError] = useState<unknown>();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busyGroup, setBusyGroup] = useState<string>();
  const busy = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const [queueRefresh] = useState(() => createCoalescedRefresh<void>());

  const refresh = useCallback(() => {
    const request = ++sequence.current;

    if (!enabled) return;
    setStatus('loading');
    return queueRefresh(async () => {
      if (!alive.current || request !== sequence.current) return;
      try {
        if (!navigator.onLine) throw new Error('Offline');
        const result = await WorkspaceService.getWorkspaceGroups(workspaceId);

        if (
          !Array.isArray(result.groups) ||
          !result.groups.every((group) => typeof group?.group_id === 'string' && typeof group?.name === 'string')
        )
          throw new Error('Invalid group directory');

        if (!alive.current || request !== sequence.current) return;
        setGroups(result.groups);
        setStatus('ready');
      } catch (failure) {
        if (!alive.current || request !== sequence.current) return;
        setStatus(isUnsupportedRouteError(failure) ? 'unsupported' : 'error');
      }
    });
  }, [enabled, queueRefresh, workspaceId]);

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
    emitter?.on(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, revalidate);
    emitter?.on(APP_EVENTS.WEBSOCKET_STATUS, revalidate);
    window.addEventListener('focus', revalidate);
    window.addEventListener('online', revalidate);
    window.addEventListener('offline', revalidate);
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive.current = false;
      sequence.current += 1;
      emitter?.off(APP_EVENTS.PERMISSION_CHANGED, revalidate);
      emitter?.off(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, revalidate);
      emitter?.off(APP_EVENTS.WEBSOCKET_STATUS, revalidate);
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('online', revalidate);
      window.removeEventListener('offline', revalidate);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [emitter, refresh]);

  const save = async (group: WorkspaceGroup) => {
    if (
      busy.current ||
      status !== 'ready' ||
      group.space_coverage_supported !== true ||
      group.can_manage_space_coverage !== true ||
      !Object.prototype.hasOwnProperty.call(drafts, group.group_id)
    )
      return;
    const level = drafts[group.group_id];
    const request = sequence.current;
    const isCurrent = () => alive.current && request === sequence.current;

    busy.current = true;
    setBusyGroup(group.group_id);
    setError(undefined);
    try {
      const saved = await setGroupSpaceCoverage(workspaceId, group.group_id, level, isCurrent);

      if (!isCurrent()) return;
      setGroups((previous) =>
        previous?.map((row) =>
          row.group_id === group.group_id ? { ...row, space_coverage_access_level: saved.access_level } : row
        )
      );
      setDrafts((previous) => {
        const next = { ...previous };

        delete next[group.group_id];
        return next;
      });
    } catch (failure) {
      if (isCurrent()) {
        setError(failure);
        void refresh();
      }
    } finally {
      busy.current = false;
      if (alive.current) setBusyGroup(undefined);
    }
  };

  const matches = groups?.filter((group) => group.name.toLowerCase().includes(query.toLowerCase())) ?? [];

  return (
    <SettingsSection title={t('groupSpaceAccess.title')}>
      <p className='text-sm text-text-secondary'>{t('groupSpaceAccess.scope')}</p>
      <p className='text-sm text-text-secondary'>{t('groupSpaceAccess.independent')}</p>
      {status !== 'ready' && (
        <p role='status'>
          {t(
            status === 'loading'
              ? 'groupSpaceAccess.loading'
              : status === 'unsupported'
              ? 'groupSpaceAccess.unsupported'
              : 'groupSpaceAccess.unavailable'
          )}
        </p>
      )}
      {status !== 'loading' && (
        <Button variant='outline' onClick={() => void refresh()}>
          {t('groupSpaceAccess.refresh')}
        </Button>
      )}
      {error !== undefined && <p role='alert'>{getErrorMessage(error)}</p>}
      {groups && (
        <>
          <SearchInput
            aria-label={t('groupSpaceAccess.search')}
            value={query}
            placeholder={t('groupSpaceAccess.search')}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
          {groups.length === 0 && <p>{t('groupSpaceAccess.empty')}</p>}
          {matches.slice(0, limit).map((group) => {
            const supported = group.space_coverage_supported === true;
            const canManage = group.can_manage_space_coverage === true;
            const current = group.space_coverage_access_level;
            const known = isGroupSpaceCoverageLevel(current);
            const draft = Object.prototype.hasOwnProperty.call(drafts, group.group_id)
              ? drafts[group.group_id]
              : current;
            const disabled = status !== 'ready' || busyGroup !== undefined || !supported || !canManage || !known;

            return (
              <div
                key={group.group_id}
                className='flex flex-wrap items-center gap-3 rounded border border-border-primary p-3'
                data-testid={`group-space-access-${group.group_id}`}
              >
                <div className='min-w-0 flex-1'>
                  <p className='font-medium'>{group.name}</p>
                  {!supported ? (
                    <p className='text-xs'>{t('groupSpaceAccess.unsupported')}</p>
                  ) : (
                    !canManage && <p className='text-xs'>{t('groupSpaceAccess.ownerRequired')}</p>
                  )}
                </div>
                <select
                  disabled={disabled}
                  aria-label={t('groupSpaceAccess.levelFor', { name: group.name })}
                  value={draft === undefined ? 'unknown' : draft === null ? 'off' : String(draft)}
                  className='rounded border border-border-primary bg-fill-content p-2'
                  onChange={(event) => {
                    const value = event.target.value;

                    if (value === 'off' || value === '10' || value === '30') {
                      setDrafts((previous) => ({
                        ...previous,
                        [group.group_id]: value === 'off' ? null : (Number(value) as GroupSpaceCoverageLevel),
                      }));
                    }
                  }}
                >
                  {!known && <option value='unknown'>{t('groupSpaceAccess.unknown')}</option>}
                  <option value='off'>{t('groupSpaceAccess.off')}</option>
                  <option value='10'>{t('shareAction.canView')}</option>
                  <option value='30'>{t('shareAction.canEdit')}</option>
                </select>
                <Button disabled={disabled || draft === current} onClick={() => void save(group)}>
                  {t('button.save')}
                </Button>
              </div>
            );
          })}
          {matches.length > limit && (
            <Button variant='outline' onClick={() => setLimit((value) => value + PAGE_SIZE)}>
              {t('workspacePermissions.loadMore')}
            </Button>
          )}
        </>
      )}
    </SettingsSection>
  );
}
