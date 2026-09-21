/** Writable destinations in the currently selected workspace. */
export interface GitHubSyncSpace {
  space_id: string;
  space_name: string;
  existing_page_count: number;
}

/** Server-authorized destinations and defaults for a new GitHub connection. */
export interface GitHubSyncConfiguration {
  available: boolean;
  can_manage: boolean;
  repository: string;
  branch: string;
  root_path: string;
  space_id: string | null;
  space_name: string | null;
  existing_page_count: number;
  oauth_configured: boolean;
  spaces: GitHubSyncSpace[];
}

export interface GitHubRepository {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
}

export type GitHubRepositoryProbe =
  | { status: 'ready'; repository: GitHubRepository }
  | { status: 'authentication_required' };

export interface GitHubSyncBinding {
  id: string;
  workspace_id: string;
  space_id: string;
  connection_id: string | null;
  authentication_mode: 'public' | 'oauth';
  repository_id: number;
  repository_owner: string;
  repository_name: string;
  branch: string;
  root_path: string;
  enabled: boolean;
  generation: number;
  status: string;
  last_error: string | null;
  last_applied_commit: string | null;
  last_synced_at: string | null;
}

export interface GitHubSyncRun {
  id: string;
  status: string;
  progress?: {
    stage?: string;
    completed?: number;
    total?: number;
    failed?: number;
    conflicts?: unknown[];
  };
  last_error?: string | null;
  source_commit_sha?: string | null;
  finished_at?: string | null;
}

export interface GitHubSyncEntry {
  view_id: string;
  path: string;
  kind: string;
  lifecycle: string;
  last_error: string | null;
  source_commit_sha: string | null;
  updated_at: string;
}

export interface GitHubSyncStatus {
  binding: GitHubSyncBinding;
  run: GitHubSyncRun | null;
  entries: GitHubSyncEntry[];
}

export interface CreateGitHubSyncBinding {
  connection_id?: string;
  repository_id: number;
  space_id: string;
  branch: string;
  root_path: string;
  initial_mappings?: { path: string; view_id: string }[];
}

export interface UpdateGitHubSyncBinding {
  expected_generation: number;
  enabled?: boolean;
  connection_id?: string;
  authentication_mode?: 'public';
}

export interface GithubPageSource {
  binding_id: string;
  view_id: string;
  read_only: boolean;
  status: 'synced' | 'syncing' | 'sync_failed' | 'connection_issue';
  paused: boolean;
  path: string;
  lifecycle: string;
  source_url: string;
  source_commit_sha: string | null;
  last_error: string | null;
}

export interface GithubSourceVersion {
  version_id: string;
  applied_at: string;
  source: {
    repository_id?: number;
    repository?: string;
    path?: string;
    applied_commit?: string;
    commit?: {
      sha: string;
      message: string;
      html_url: string;
      author_github_id: number | null;
      author_login: string | null;
      authored_at: string | null;
      committed_at: string | null;
    } | null;
  };
}
