import { ExternalLink, Github } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GithubPageSource } from '@/application/services/domains/github-sync';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';

import { useGithubPageSource } from './useGithubPageSource';

/** Provider URLs are displayed as external links, never used as app navigation targets. */
export function safeGithubUrl(value?: string): string | undefined {
  try {
    const url = new URL(value || '');

    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function GithubSourceBadge({ viewId }: { viewId?: string }) {
  const workspaceId = useCurrentWorkspaceId();
  const { source, error } = useGithubPageSource(workspaceId, viewId);

  return source ? <GithubSourceDetails source={source} stale={error} /> : null;
}

export function GithubSourceDetails({ source, stale = false }: { source: GithubPageSource; stale?: boolean }) {
  const { t } = useTranslation();
  const labels = {
    synced: t('settings.githubSync.synced', { defaultValue: 'Synced' }),
    syncing: t('settings.githubSync.syncing', { defaultValue: 'Syncing' }),
    sync_failed: t('settings.githubSync.syncFailed', { defaultValue: 'Sync failed' }),
    connection_issue: t('settings.githubSync.connectionIssue', { defaultValue: 'Connection issue' }),
  };
  const status = stale
    ? t('settings.githubSync.statusUnavailable', { defaultValue: 'Status unavailable' })
    : source.paused && source.status !== 'sync_failed' && source.status !== 'connection_issue'
    ? t('settings.githubSync.paused', { defaultValue: 'Paused' })
    : labels[source.status];
  const url = safeGithubUrl(source.source_url);
  const message = t('settings.githubSync.managedPage', {
    defaultValue: 'This page is synced from GitHub and is read-only in AppFlowy.',
  });

  return (
    <div
      data-testid='github-source-badge'
      role='group'
      aria-label={`GitHub · ${status}. ${message}`}
      className='flex min-w-0 items-center gap-2 text-xs text-text-secondary'
      title={`GitHub · ${status}\n${message}\n${source.path}`}
    >
      <Github className='h-4 w-4 shrink-0' aria-hidden />
      <span className='hidden whitespace-nowrap lg:inline'>GitHub · {status}</span>
      {url && (
        <a
          href={url}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={t('settings.githubSync.openInGithub', { defaultValue: 'Open in GitHub' })}
          className='whitespace-nowrap text-text-info hover:underline'
        >
          <span className='hidden sm:inline'>
            {t('settings.githubSync.openInGithub', { defaultValue: 'Open in GitHub' })}
          </span>
          <ExternalLink aria-hidden className='h-4 w-4 sm:hidden' />
        </a>
      )}
    </div>
  );
}
