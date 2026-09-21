import { render, screen } from '@testing-library/react';

import { GithubPageSource, GithubSourceVersion } from '@/application/services/domains/github-sync';

import { GithubSourceDetails, safeGithubUrl } from '../GithubSourceBadge';
import { GithubVersionSource } from '../GithubVersionSource';

jest.mock('@/application/services/domains/github-sync', () => ({}));
jest.mock('@/components/app/app.hooks', () => ({ useCurrentWorkspaceId: () => 'workspace' }));
jest.mock('../useGithubPageSource', () => ({ useGithubPageSource: () => ({ source: null }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }),
}));

const source: GithubPageSource = {
  binding_id: 'binding',
  view_id: 'view',
  read_only: true,
  status: 'synced',
  paused: false,
  path: 'docs/AUTHENTICATION.md',
  lifecycle: 'active',
  source_url: 'https://github.com/example/docs/blob/main/docs/AUTHENTICATION.md',
  source_commit_sha: 'abc123',
  last_error: null,
};

test('shows source ownership, status and a safe link to the exact GitHub file', () => {
  render(<GithubSourceDetails source={source} />);
  expect(screen.getByText('GitHub · Synced')).toBeTruthy();
  const link = screen.getByRole('link', { name: 'Open in GitHub' });

  expect(link.getAttribute('href')).toBe(source.source_url);
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(screen.getByTestId('github-source-badge').getAttribute('title')).toContain(source.path);
});

test('preserves ownership display for paused/error states and never renders unsafe source URLs', () => {
  const active = render(<GithubSourceDetails source={{ ...source, paused: true }} />);

  expect(screen.getByText('GitHub · Paused')).toBeTruthy();
  active.rerender(<GithubSourceDetails source={{ ...source, paused: true, status: 'connection_issue' }} />);
  expect(screen.getByText('GitHub · Connection issue')).toBeTruthy();
  active.rerender(<GithubSourceDetails source={{ ...source, source_url: 'javascript:alert(1)' }} stale />);
  expect(screen.getByText('GitHub · Status unavailable')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  for (const target of ['https://github.com.evil.test/file', 'http://github.com/file', 'https://user@github.com/file']) {
    expect(safeGithubUrl(target)).toBeUndefined();
  }
});

test('shows commit provenance without treating GitHub identity as an AppFlowy user', () => {
  const version: GithubSourceVersion = {
    version_id: 'version',
    applied_at: '2026-09-20T00:00:00Z',
    source: {
      path: source.path,
      applied_commit: 'abcdef12345',
      commit: {
        sha: 'abcdef12345',
        message: 'Update authentication guide',
        html_url: 'https://github.com/example/docs/commit/abcdef12345',
        author_github_id: 42,
        author_login: 'github-author',
        authored_at: null,
        committed_at: null,
      },
    },
  };

  render(<GithubVersionSource version={version} />);
  expect(screen.getByText('Synced from GitHub · github-author · abcdef1')).toBeTruthy();
  expect(screen.getByText('Update authentication guide')).toBeTruthy();
  expect(screen.getByText(source.path)).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe(version.source.commit?.html_url);
});
