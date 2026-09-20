import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GitHubSyncBinding, GitHubSyncConfiguration } from '@/application/integrations/github-sync';
import * as GitHubSyncService from '@/application/services/domains/github-sync';
import { ReactComponent as GitHubIcon } from '@/assets/login/github.svg';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getErrorMessage } from '@/utils/errors';

import { GitHubSyncDialog } from './GitHubSyncDialog';

export interface GitHubSyncSectionProps {
  workspaceId: string;
  configuration: GitHubSyncConfiguration;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSpace?: (spaceId: string) => void;
}

export function GitHubSyncSection(props: GitHubSyncSectionProps) {
  // Unmount the old workspace before rendering any of its account or binding state.
  return <WorkspaceSyncSection key={props.workspaceId} {...props} />;
}

function WorkspaceSyncSection({ workspaceId, configuration, open, onOpenChange, onOpenSpace }: GitHubSyncSectionProps) {
  const { t } = useTranslation();
  const [bindings, setBindings] = useState<GitHubSyncBinding[]>([]);
  const [loading, setLoading] = useState(configuration.available && configuration.can_manage);
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [managedId, setManagedId] = useState<string>();
  const canManage = configuration.available && configuration.can_manage;

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();

    setLoading(true);
    setError(undefined);
    void GitHubSyncService.listBindings(workspaceId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setBindings(result.bindings);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canManage, configuration, revision, workspaceId]);

  return (
    <section
      className={bindings.length ? 'mt-6 space-y-5 border-t border-border-primary pt-5' : undefined}
      aria-label={t('settings.githubSync.title', { defaultValue: 'GitHub sync' })}
    >
      {bindings.map((binding) => (
        <div
          key={binding.id}
          className='flex items-start justify-between gap-4'
          data-testid={`github-sync-binding-${binding.id}`}
        >
          <div className='min-w-0'>
            <h3 className='flex items-center gap-2 text-sm font-medium text-text-primary'>
              <GitHubIcon aria-hidden='true' className='h-5 w-5' />
              {t('settings.githubSync.title', { defaultValue: 'GitHub sync' })}
            </h3>
            <p className='mt-1 text-sm text-text-secondary'>
              {t('settings.githubSync.description', {
                defaultValue: 'Keep a space up to date with Markdown from GitHub.',
              })}
            </p>
            <p className='mt-2 break-words text-sm text-text-secondary'>
              {binding.repository_owner}/{binding.repository_name} →{' '}
              {configuration.spaces.find((space) => space.space_id === binding.space_id)?.space_name || binding.space_id}
            </p>
            <p className='mt-2 text-sm text-text-secondary'>
              {!binding.enabled
                ? t('settings.githubSync.paused', { defaultValue: 'Sync paused' })
                : binding.last_error
                ? t('settings.githubSync.failed', { defaultValue: 'Sync needs attention' })
                : t('settings.githubSync.connected', { defaultValue: 'Repository connected' })}
            </p>
          </div>
          {canManage && (
            <Button
              variant='outline'
              disabled={loading || Boolean(error)}
              onClick={() => setManagedId(binding.id)}
              data-testid='github-sync-open'
            >
              {t('settings.githubSync.manage', { defaultValue: 'Manage sync' })}
            </Button>
          )}
        </div>
      ))}
      {!configuration.available && (
        <p className='mt-3 text-sm text-text-secondary'>
          {t('settings.githubSync.unavailable', {
            defaultValue: 'GitHub sync is not available on this server.',
          })}
        </p>
      )}
      {configuration.available && !configuration.can_manage && (
        <p className='mt-3 text-sm text-text-secondary'>
          {t('settings.githubSync.ownerOnly', { defaultValue: 'A workspace owner can manage GitHub sync.' })}
        </p>
      )}
      {loading && canManage && (
        <div role='status' className='mt-3'>
          <Progress variant='primary' />
          <span className='sr-only'>{t('settings.githubSync.loading', { defaultValue: 'Loading GitHub sync…' })}</span>
        </div>
      )}
      {Boolean(error) && canManage && (
        <div role='alert' className='mt-3 flex items-center justify-between gap-3 text-sm text-text-error'>
          <p>
            {getErrorMessage(
              error,
              t('settings.githubSync.loadFailed', { defaultValue: 'Could not load GitHub sync.' })
            )}
          </p>
          <Button variant='outline' onClick={() => setRevision((value) => value + 1)}>
            {t('settings.githubSync.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      )}
      {(open || managedId) && canManage && !loading && !error && (
        <GitHubSyncDialog
          workspaceId={workspaceId}
          configuration={
            open
              ? {
                  ...configuration,
                  spaces: configuration.spaces.filter(
                    (space) => !bindings.some((binding) => binding.space_id === space.space_id)
                  ),
                }
              : configuration
          }
          open
          bindingId={open ? undefined : managedId}
          onOpenChange={(value) => {
            onOpenChange(value);
            if (!value) {
              setManagedId(undefined);
              setRevision((current) => current + 1);
            }
          }}
          onOpenSpace={onOpenSpace}
        />
      )}
    </section>
  );
}
