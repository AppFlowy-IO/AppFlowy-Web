import { Check, CircleAlert, FileText, FolderTree, Info, ScanSearch } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  GitHubRepositoryProbe,
  GitHubSyncBinding,
  GitHubSyncConfiguration,
  GitHubSyncStatus,
} from '@/application/integrations/github-sync';
import { authorizeIntegration } from '@/application/integrations/oauth';
import { IntegrationConnection } from '@/application/integrations/types';
import * as GitHubSyncService from '@/application/services/domains/github-sync';
import * as IntegrationService from '@/application/services/domains/integration';
import { ReactComponent as GitHubIcon } from '@/assets/login/github.svg';
import { NormalModal } from '@/components/_shared/modal/NormalModal';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getErrorMessage } from '@/utils/errors';

import { isSyncRunning, useGitHubSyncStatus } from './useGitHubSyncStatus';
import { useSyncAction } from './useSyncAction';

export interface GitHubSyncDialogProps {
  workspaceId: string;
  configuration: GitHubSyncConfiguration;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bindingId?: string;
  onBindingChange?: (binding: GitHubSyncBinding) => void;
  onOpenSpace?: (spaceId: string) => void;
}

export function GitHubSyncDialog(props: GitHubSyncDialogProps) {
  if (!props.open || !props.configuration.can_manage || !props.configuration.available) return null;
  return <SyncSession key={`${props.workspaceId}:${props.bindingId || 'new'}`} {...props} />;
}

function SyncSession({
  workspaceId,
  configuration,
  bindingId,
  onOpenChange,
  onBindingChange,
  onOpenSpace,
}: GitHubSyncDialogProps) {
  const { t } = useTranslation();
  const [currentId, setCurrentId] = useState(bindingId);
  const [phase, setPhase] = useState<'repository' | 'review'>('repository');
  const [recovering, setRecovering] = useState(false);
  const [probe, setProbe] = useState<GitHubRepositoryProbe>();
  const [connectionId, setConnectionId] = useState<string>();
  const [accounts, setAccounts] = useState<IntegrationConnection[]>([]);
  const { run, busy, error } = useSyncAction();
  const { status, error: statusError, reload } = useGitHubSyncStatus(workspaceId, currentId);
  const setup = !currentId || recovering;

  const checkRepository = useCallback(
    (selected?: string) =>
      run(
        async (signal) => {
          const result = await GitHubSyncService.probeRepository(
            workspaceId,
            selected ? { connection_id: selected } : {},
            signal
          );

          assertActive(signal);
          const connections =
            result.status === 'authentication_required'
              ? (await IntegrationService.listConnections(workspaceId, signal)).filter(
                  (account) => account.provider === 'github'
                )
              : undefined;

          return { result, connections, selected };
        },
        ({ result, connections, selected }) => {
          setProbe(result);
          setConnectionId(selected);
          if (connections) setAccounts(connections);
        }
      ),
    [run, workspaceId]
  );

  useEffect(() => {
    if (!bindingId) void checkRepository();
  }, [bindingId, checkRepository]);

  const connect = () =>
    run(
      async (signal) => {
        // This is invoked directly from the click, so the shared OAuth helper can open its popup.
        const authorization = await authorizeIntegration(workspaceId, 'github', signal);

        assertActive(signal);
        const confirmation = await IntegrationService.confirmConnection(
          workspaceId,
          'github',
          authorization.connectionId,
          authorization.oauthQuery,
          signal
        );

        assertActive(signal);
        if (!confirmation.success)
          throw new Error(
            t('settings.githubSync.authorizationFailed', {
              defaultValue: 'GitHub authorization could not be confirmed.',
            })
          );
        const selected = confirmation.connection?.id || authorization.connectionId;
        const result = await GitHubSyncService.probeRepository(workspaceId, { connection_id: selected }, signal);

        return { result, selected, account: confirmation.connection };
      },
      ({ result, selected, account }) => {
        setProbe(result);
        setConnectionId(selected);
        if (account) setAccounts((current) => [...current.filter((item) => item.id !== account.id), account]);
      }
    );

  const start = () => {
    if (busy || probe?.status !== 'ready' || !configuration.space_id || (currentId && !status)) return;
    const repositoryId = probe.repository.id;
    const spaceId = configuration.space_id;

    void run(
      async (signal) => {
        if (currentId && status) {
          const result = await GitHubSyncService.updateBinding(
            workspaceId,
            currentId,
            {
              expected_generation: status.binding.generation,
              ...(connectionId ? { connection_id: connectionId } : { authentication_mode: 'public' as const }),
            },
            signal
          );

          assertActive(signal);
          return result.binding.enabled
            ? result
            : GitHubSyncService.updateBinding(
                workspaceId,
                currentId,
                {
                  expected_generation: result.binding.generation,
                  enabled: true,
                },
                signal
              );
        }

        return GitHubSyncService.createBinding(
          workspaceId,
          {
            repository_id: repositoryId,
            space_id: spaceId,
            branch: configuration.branch,
            root_path: configuration.root_path,
            ...(connectionId ? { connection_id: connectionId } : {}),
          },
          signal
        );
      },
      ({ binding }) => {
        setCurrentId(binding.id);
        setRecovering(false);
        onBindingChange?.(binding);
        reload();
      }
    );
  };

  const setEnabled = (enabled: boolean) => {
    if (!status || busy) return;
    void run(
      (signal) =>
        GitHubSyncService.updateBinding(
          workspaceId,
          status.binding.id,
          {
            expected_generation: status.binding.generation,
            enabled,
          },
          signal
        ),
      ({ binding }) => {
        onBindingChange?.(binding);
        reload();
      }
    );
  };

  const syncNow = () => {
    if (!currentId || busy) return;
    void run(
      (signal) => GitHubSyncService.syncBinding(workspaceId, currentId, signal),
      () => reload()
    );
  };

  const checkAccess = () => {
    setRecovering(true);
    setPhase('repository');
    setProbe(undefined);
    void checkRepository();
  };

  const account = accounts.find((item) => item.id === connectionId);
  const displayAccount =
    accountLabel(account) || t('settings.githubSync.authorizedAccount', { defaultValue: 'Authorized GitHub account' });
  const step = setup ? (phase === 'repository' ? 0 : 1) : 2;
  const active = status ? isSyncRunning(status) : true;
  const failure = error || statusError;
  const completed = !setup && Boolean(status && isSyncCompleted(status));

  return (
    <NormalModal
      open
      title={
        <div className='flex items-start gap-3 pr-2 text-left'>
          <GitHubIcon aria-hidden='true' className='h-11 w-11 shrink-0 text-text-primary' />
          <div className='min-w-0 pt-1'>
            <div className='text-base font-semibold leading-5 text-text-primary'>
              {t('settings.githubSync.dialogTitle', { defaultValue: 'Sync from GitHub' })}
            </div>
            <p className='mt-1 whitespace-normal text-xs font-normal leading-5 text-text-secondary'>
              {t('settings.githubSync.dialogDescription', {
                defaultValue: 'Sync Markdown files from a GitHub repository to a space in AppFlowy.',
              })}
            </p>
          </div>
        </div>
      }
      showActions={false}
      onClose={() => onOpenChange(false)}
      fullWidth
      maxWidth='sm'
      PaperProps={{ sx: { width: 640, maxWidth: 'calc(100vw - 32px)' } }}
      data-testid='github-sync-dialog'
    >
      <div className={`flex flex-col gap-5 ${completed ? '' : 'sm:flex-row'}`}>
        {!completed && <SetupSteps current={step} />}
        <div className={`min-w-0 flex-1 space-y-4 ${setup ? '' : 'min-h-52'}`}>
          {setup ? (
            <>
              {phase === 'repository' && (
                <>
                  {!probe && busy && (
                    <div role='status' className='flex items-center gap-2 text-xs text-text-secondary'>
                      <Progress variant='primary' />
                      {t('settings.githubSync.checkingRepository', { defaultValue: 'Checking repository access…' })}
                    </div>
                  )}
                  {probe?.status === 'ready' && (
                    <p className='flex items-center gap-2 text-xs text-text-secondary'>
                      <Check aria-hidden='true' className='h-4 w-4 shrink-0 text-text-success' />
                      {connectionId
                        ? displayAccount
                        : t('settings.githubSync.publicAccess', {
                            defaultValue: 'Public repository · No GitHub sign-in required',
                          })}
                    </p>
                  )}
                  {probe?.status === 'authentication_required' && (
                    <div className='space-y-3'>
                      <p className='text-xs leading-5 text-text-secondary'>
                        {t('settings.githubSync.authenticationRequired', {
                          defaultValue:
                            'This repository requires GitHub access. Select or connect an account that can read it.',
                        })}
                      </p>
                      {accounts.length > 0 && (
                        <label className='block text-xs text-text-primary'>
                          {t('settings.githubSync.account', { defaultValue: 'GitHub account' })}
                          <select
                            className='mt-1 w-full rounded border border-border-primary bg-fill-content px-3 py-2 text-sm'
                            disabled={busy}
                            value={connectionId || ''}
                            onChange={(event) => {
                              if (event.target.value) void checkRepository(event.target.value);
                            }}
                          >
                            <option value=''>
                              {t('settings.githubSync.selectAccount', { defaultValue: 'Select an account' })}
                            </option>
                            {accounts.map((item) => (
                              <option key={item.id} value={item.id}>
                                {accountLabel(item) ||
                                  item.account_identifier ||
                                  t('settings.githubSync.authorizedAccount', {
                                    defaultValue: 'Authorized GitHub account',
                                  })}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {configuration.oauth_configured ? (
                        <Button variant='outline' disabled={busy} onClick={() => void connect()}>
                          {t('settings.githubSync.connectAccount', { defaultValue: 'Connect GitHub account' })}
                        </Button>
                      ) : (
                        <p role='status' className='text-xs leading-5 text-text-secondary'>
                          {t('settings.githubSync.oauthUnavailable', {
                            defaultValue:
                              'Ask your administrator to configure GitHub OAuth for private repository access.',
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
              <RepositorySummary
                configuration={configuration}
                variant={phase === 'review' ? 'review' : 'fields'}
                account={phase === 'review' && connectionId ? displayAccount : undefined}
              />
            </>
          ) : status ? (
            <BindingProgress status={status} configuration={configuration} />
          ) : (
            <div role='status' className='flex items-center gap-2 py-5 text-sm text-text-secondary'>
              <Progress variant='primary' />
              {t('settings.githubSync.loading', { defaultValue: 'Loading GitHub sync…' })}
            </div>
          )}
          {Boolean(failure) && (
            <div role='alert' className='space-y-2 text-sm text-text-error'>
              <p>
                {getErrorMessage(
                  failure,
                  t('settings.githubSync.requestFailed', {
                    defaultValue: 'The request failed. Your existing pages are safe. Try again.',
                  })
                )}
              </p>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => {
                  if (setup) void checkRepository(connectionId);
                  else reload();
                }}
              >
                {t('settings.githubSync.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          )}
        </div>
      </div>
      {setup && phase === 'review' && (
        <InfoNotice className='mt-5'>
          {t('settings.githubSync.reviewNotice', {
            defaultValue:
              'Synced pages will be read-only in AppFlowy. We will create or update mapped pages. Existing pages that are not mapped to this repository will not be changed.',
          })}
        </InfoNotice>
      )}
      {!setup && active && status && (
        <InfoNotice className='mt-5'>
          {t('settings.githubSync.closeWhileSyncing', {
            defaultValue: 'You can close this window. Sync continues in the background; reopen it to see progress.',
          })}
        </InfoNotice>
      )}
      {!setup && status && (
        <div className='mt-5 flex flex-wrap items-center gap-2 border-t border-border-primary pt-3'>
          {Boolean(status.binding.last_error) && (
            <Button variant='ghost' size='sm' disabled={busy} onClick={checkAccess}>
              {t('settings.githubSync.checkAccess', { defaultValue: 'Check repository access' })}
            </Button>
          )}
          <Button variant='ghost' size='sm' disabled={busy} onClick={() => setEnabled(!status.binding.enabled)}>
            {status.binding.enabled
              ? t('settings.githubSync.pause', { defaultValue: 'Pause sync' })
              : t('settings.githubSync.resume', { defaultValue: 'Resume sync' })}
          </Button>
          {status.binding.enabled && (
            <Button variant='ghost' size='sm' disabled={busy || active} onClick={syncNow}>
              {status.binding.last_error
                ? t('settings.githubSync.retrySync', { defaultValue: 'Retry sync' })
                : t('settings.githubSync.syncNow', { defaultValue: 'Sync now' })}
            </Button>
          )}
        </div>
      )}
      <div className='mt-5 flex flex-wrap justify-end gap-3'>
        {setup ? (
          <>
            <Button
              variant='outline'
              className='min-w-20 px-4'
              onClick={() => {
                if (phase === 'review') setPhase('repository');
                else if (recovering) setRecovering(false);
                else onOpenChange(false);
              }}
            >
              {phase === 'review'
                ? t('settings.githubSync.back', { defaultValue: 'Back' })
                : t('settings.githubSync.cancel', { defaultValue: 'Cancel' })}
            </Button>
            {phase === 'repository' ? (
              <Button
                className='min-w-20 px-4'
                disabled={busy || probe?.status !== 'ready'}
                onClick={() => setPhase('review')}
              >
                {t('settings.githubSync.next', { defaultValue: 'Next' })}
              </Button>
            ) : (
              <Button className='min-w-20 px-4' loading={busy} onClick={start}>
                {recovering
                  ? t('settings.githubSync.resume', { defaultValue: 'Resume sync' })
                  : t('settings.githubSync.start', { defaultValue: 'Start sync' })}
              </Button>
            )}
          </>
        ) : (
          <>
            {status && onOpenSpace && (
              <Button
                variant='outline'
                className='min-w-24 px-4'
                onClick={() => {
                  onOpenChange(false);
                  onOpenSpace(status.binding.space_id);
                }}
              >
                {t('settings.githubSync.viewSpace', { defaultValue: 'View space' })}
              </Button>
            )}
            <Button className='min-w-20 px-4' onClick={() => onOpenChange(false)}>
              {active
                ? t('settings.githubSync.close', { defaultValue: 'Close' })
                : t('settings.githubSync.done', { defaultValue: 'Done' })}
            </Button>
          </>
        )}
      </div>
    </NormalModal>
  );
}

function accountLabel(account?: IntegrationConnection): string | undefined {
  const label = account?.metadata?.github_login || account?.metadata?.account_name;

  return typeof label === 'string' && label ? label : undefined;
}

function SetupSteps({ current }: { current: number }) {
  const { t } = useTranslation();
  const labels = [
    t('settings.githubSync.repository', { defaultValue: 'Repository' }),
    t('settings.githubSync.review', { defaultValue: 'Review' }),
    t('settings.githubSync.sync', { defaultValue: 'Sync' }),
  ];

  return (
    <ol
      className='flex shrink-0 justify-between gap-2 text-xs sm:w-32 sm:flex-col sm:justify-start sm:gap-0 sm:border-r sm:border-border-primary sm:py-2 sm:pr-5'
      aria-label={t('settings.githubSync.steps', { defaultValue: 'Setup steps' })}
    >
      {labels.map((label, index) => (
        <li
          key={label}
          aria-current={current === index ? 'step' : undefined}
          className='relative flex min-w-0 items-center gap-2.5 sm:pb-6 sm:last:pb-0'
        >
          {index < labels.length - 1 && (
            <span aria-hidden='true' className='absolute bottom-0 left-3 top-6 hidden w-px bg-border-primary sm:block' />
          )}
          <span
            className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              current === index ? 'bg-fill-theme-thick text-text-on-fill' : 'bg-fill-content-hover text-text-secondary'
            }`}
          >
            {index + 1}
          </span>
          <span className={current === index ? 'font-medium text-text-primary' : 'text-text-secondary'}>{label}</span>
          {current > index && <Check aria-hidden='true' className='h-3.5 w-3.5 shrink-0 text-text-success' />}
        </li>
      ))}
    </ol>
  );
}

function SpaceLabel({ name }: { name: string | null }) {
  return (
    <span className='flex min-w-0 items-center gap-2'>
      <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded bg-fill-featured-thick text-text-on-fill'>
        <FileText aria-hidden='true' className='h-4 w-4' />
      </span>
      <span className='break-words'>{name}</span>
    </span>
  );
}

function InfoNotice({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-md border border-border-theme-thick bg-fill-theme-select px-3 py-3 text-xs leading-5 text-text-secondary ${className}`}
    >
      <Info aria-hidden='true' className='mt-0.5 h-4 w-4 shrink-0 fill-fill-theme-thick text-text-on-fill' />
      <p>{children}</p>
    </div>
  );
}

function RepositorySummary({
  configuration,
  variant,
  account,
}: {
  configuration: GitHubSyncConfiguration;
  variant: 'fields' | 'review';
  account?: string;
}) {
  const { t } = useTranslation();
  const fields = variant === 'fields';
  const details = [
    ...(account ? [[t('settings.githubSync.account', { defaultValue: 'GitHub account' }), account]] : []),
    [t('settings.githubSync.repository', { defaultValue: 'Repository' }), configuration.repository],
    [t('settings.githubSync.branch', { defaultValue: 'Branch' }), configuration.branch],
    [
      t('settings.githubSync.directory', { defaultValue: 'Documentation directory' }),
      `/${configuration.root_path.replace(/^\/+/, '')}`,
    ],
  ];

  return (
    <dl className={fields ? 'space-y-4 text-sm' : 'space-y-3 text-sm'}>
      {details.map(([label, value], index) => (
        <div key={label}>
          <dt className='mb-1 text-xs text-text-secondary'>{label}</dt>
          <dd
            className={
              fields
                ? 'break-words rounded-md border border-border-primary px-3 py-2 text-text-primary'
                : 'break-words text-text-primary'
            }
          >
            {value}
          </dd>
          {fields && index === details.length - 1 && (
            <dd className='mt-1.5 text-xs leading-5 text-text-tertiary'>
              {t('settings.githubSync.directoryHelp', {
                defaultValue: 'Path to the directory containing Markdown files.',
              })}
            </dd>
          )}
        </div>
      ))}
      <div className={fields ? 'pt-1' : ''}>
        <dt className='mb-1 text-xs text-text-secondary'>
          {t('settings.githubSync.space', { defaultValue: 'Sync to space' })}
        </dt>
        <dd
          className={
            fields ? 'rounded-md border border-border-primary px-2 py-1.5 text-text-primary' : 'text-text-primary'
          }
        >
          <SpaceLabel name={configuration.space_name || configuration.space_id} />
        </dd>
        <dd className='mt-2 text-xs leading-5 text-text-tertiary'>
          {fields
            ? t('settings.githubSync.existingPages', {
                count: configuration.existing_page_count,
                defaultValue:
                  '{{count}} existing pages. Pages that are not mapped to this repository will not be changed.',
              })
            : t('settings.githubSync.existingPageCount', {
                count: configuration.existing_page_count,
                defaultValue: '{{count}} existing pages',
              })}
        </dd>
      </div>
    </dl>
  );
}

function isSyncCompleted(status: GitHubSyncStatus) {
  return (
    status.binding.enabled &&
    !isSyncRunning(status) &&
    !status.binding.last_error &&
    !status.run?.last_error &&
    status.run?.status === 'completed'
  );
}

function BindingProgress({
  status,
  configuration,
}: {
  status: GitHubSyncStatus;
  configuration: GitHubSyncConfiguration;
}) {
  const { t } = useTranslation();
  const running = isSyncRunning(status);
  const paused = !status.binding.enabled;
  const failed = Boolean(
    status.binding.last_error ||
      status.run?.last_error ||
      ['failed', 'partial_failure'].includes(status.run?.status || '')
  );
  const completed = isSyncCompleted(status);
  const progress = status.run?.progress;
  const pages = status.entries.filter(
    (entry) => entry.kind === 'file' && entry.lifecycle === 'active' && entry.source_commit_sha
  ).length;
  const folders = status.entries.filter((entry) => entry.kind === 'directory' && entry.lifecycle === 'active').length;
  const failures = status.entries.filter((entry) => entry.last_error);
  const scanned = progress?.stage === 'importing' || progress?.stage === 'complete';
  const title = paused
    ? t('settings.githubSync.paused', { defaultValue: 'Sync paused' })
    : completed
    ? t('settings.githubSync.completed', { defaultValue: 'Sync completed' })
    : failed
    ? t('settings.githubSync.failed', { defaultValue: 'Sync needs attention' })
    : t('settings.githubSync.inProgress', { defaultValue: 'Sync in progress' });
  const details = [
    [t('settings.githubSync.repository', { defaultValue: 'Repository' }), configuration.repository],
    [t('settings.githubSync.branch', { defaultValue: 'Branch' }), configuration.branch],
    [
      t('settings.githubSync.summaryDirectory', { defaultValue: 'Directory' }),
      `/${configuration.root_path.replace(/^\/+/, '')}`,
    ],
  ];

  return (
    <div className='space-y-4' aria-live='polite'>
      {running ? (
        <>
          <h3 className='sr-only'>{title}</h3>
          <div className='space-y-8 py-6'>
            <div className='flex items-center gap-3 text-sm text-text-primary'>
              <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-primary'>
                <ScanSearch aria-hidden='true' className='h-4 w-4' />
              </span>
              <span className='flex-1'>
                {t('settings.githubSync.scanningStage', { defaultValue: 'Scanning repository' })}
              </span>
              {scanned ? (
                <Check
                  aria-label={t('settings.githubSync.stageComplete', { defaultValue: 'Complete' })}
                  className='h-5 w-5 text-text-success'
                />
              ) : (
                <Progress variant='primary' />
              )}
            </div>
            <div className='flex items-center gap-3 text-sm text-text-primary'>
              <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-primary'>
                <FolderTree aria-hidden='true' className='h-4 w-4' />
              </span>
              <div className='min-w-0 flex-1'>
                <p>{t('settings.githubSync.applyingStage', { defaultValue: 'Importing content and navigation' })}</p>
                {typeof progress?.total === 'number' && typeof progress.completed === 'number' && (
                  <p className='mt-1 text-xs text-text-secondary'>
                    {t('settings.githubSync.operationsApplied', {
                      completed: progress.completed,
                      total: progress.total,
                      defaultValue: '{{completed}} / {{total}} changes applied',
                    })}
                  </p>
                )}
              </div>
              {scanned ? (
                <Progress variant='primary' />
              ) : (
                <span aria-hidden='true' className='h-4 w-4 rounded-full border border-dashed border-border-primary' />
              )}
            </div>
          </div>
        </>
      ) : (
        <div className={`flex items-center gap-3 ${completed ? 'px-1 pb-1 pt-3 sm:px-10' : ''}`}>
          {completed ? (
            <span className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-fill-success-thick text-text-on-fill'>
              <Check aria-hidden='true' className='h-7 w-7' strokeWidth={3} />
            </span>
          ) : (
            <CircleAlert aria-hidden='true' className='h-6 w-6 shrink-0 text-text-secondary' />
          )}
          <div>
            <h3 className='text-sm font-semibold text-text-primary'>{title}</h3>
            {completed && (
              <p className='mt-1 text-xs leading-5 text-text-secondary'>
                {t('settings.githubSync.successSummary', {
                  count: pages,
                  space: configuration.space_name || configuration.space_id,
                  defaultValue: 'Successfully synced {{count}} pages to {{space}}.',
                })}
              </p>
            )}
          </div>
        </div>
      )}
      {(failed || paused) && (
        <div
          role={failed ? 'alert' : 'status'}
          className='rounded-md border border-border-primary p-3 text-xs leading-5 text-text-secondary'
        >
          {paused
            ? t('settings.githubSync.pauseNotice', { defaultValue: 'Synced pages stay read-only while sync is paused.' })
            : t('settings.githubSync.failureNotice', {
                defaultValue: 'Some changes could not be applied. Previously synced content is preserved.',
              })}
          {(status.binding.last_error || status.run?.last_error) && (
            <p className='mt-1'>
              {t(`settings.githubSync.errors.${status.binding.last_error || status.run?.last_error}`, {
                defaultValue: t('settings.githubSync.resolveError', {
                  defaultValue: 'Check repository access and source files, then retry.',
                }),
              })}
            </p>
          )}
        </div>
      )}
      {!running && (
        <dl className='grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-4 gap-y-3 rounded-md border border-border-primary p-4 text-xs text-text-secondary'>
          {details.map(([label, value]) => (
            <div key={label} className='contents'>
              <dt className='break-words'>{label}</dt>
              <dd className='break-words text-text-primary'>{value}</dd>
            </div>
          ))}
          <dt>{t('settings.githubSync.summarySpace', { defaultValue: 'Space' })}</dt>
          <dd className='text-text-primary'>
            <SpaceLabel name={configuration.space_name || configuration.space_id} />
          </dd>
          <dt>{t('settings.githubSync.syncedPages', { defaultValue: 'Synced pages' })}</dt>
          <dd className='text-text-primary'>{pages}</dd>
          <dt>{t('settings.githubSync.folders', { defaultValue: 'Folders' })}</dt>
          <dd className='text-text-primary'>{folders}</dd>
          {status.binding.last_applied_commit && (
            <>
              <dt>{t('settings.githubSync.lastCommit', { defaultValue: 'Last commit' })}</dt>
              <dd className='font-mono text-text-primary' title={status.binding.last_applied_commit}>
                {status.binding.last_applied_commit.slice(0, 8)}
              </dd>
            </>
          )}
          {status.binding.last_synced_at && (
            <>
              <dt>{t('settings.githubSync.lastSynced', { defaultValue: 'Last synced' })}</dt>
              <dd className='text-text-primary'>{new Date(status.binding.last_synced_at).toLocaleString()}</dd>
            </>
          )}
        </dl>
      )}
      {failures.length > 0 && (
        <ul
          className='space-y-1 text-xs text-text-error'
          aria-label={t('settings.githubSync.failedPages', { defaultValue: 'Pages requiring attention' })}
        >
          {failures.map((entry) => (
            <li key={entry.view_id} className='break-words'>
              {entry.path}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}
