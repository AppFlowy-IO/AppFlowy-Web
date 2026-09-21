import { useTranslation } from 'react-i18next';

import { GithubSourceVersion } from '@/application/services/domains/github-sync';

import { safeGithubUrl } from './GithubSourceBadge';

export function GithubVersionSource({ version }: { version: GithubSourceVersion }) {
  const { t } = useTranslation();
  const commit = version.source.commit;
  const url = safeGithubUrl(commit?.html_url);
  const sha = commit?.sha ?? version.source.applied_commit;

  return (
    <div
      data-testid='github-version-source'
      className='border-b border-border-primary px-6 py-3 text-sm text-text-secondary'
    >
      <p>
        {t('settings.githubSync.syncedFromGithub', { defaultValue: 'Synced from GitHub' })}
        {commit?.author_login ? ` · ${commit.author_login}` : ''}
        {sha ? ` · ${sha.slice(0, 7)}` : ''}
      </p>
      {commit?.message && <p className='mt-1 whitespace-pre-wrap'>{commit.message}</p>}
      {version.source.path && <p className='mt-1 break-all text-xs'>{version.source.path}</p>}
      {url && (
        <a href={url} target='_blank' rel='noopener noreferrer' className='text-text-info hover:underline'>
          {t('settings.githubSync.viewCommit', { defaultValue: 'View commit in GitHub' })}
        </a>
      )}
    </div>
  );
}
