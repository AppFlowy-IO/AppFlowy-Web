export interface AppOutlineResponse {
  outline: import('@/application/types').View[];
  folderRid?: string;
}

/** Database metadata returned by GET /api/workspace/:workspaceId/database. */
export interface WorkspaceDatabaseViewItem {
  view_id: string;
  layout: import('@/application/types').ViewLayout;
  is_container: boolean;
  embedded: boolean;
  name: string;
  icon: import('@/application/types').ViewIcon | null;
  parent_view_id: string | null;
}

export interface WorkspaceDatabaseWithViews {
  database_id: string;
  views: WorkspaceDatabaseViewItem[];
}

export interface WorkspaceDatabaseListPage {
  databases: WorkspaceDatabaseWithViews[];
  has_more: boolean;
}

export interface AFCloudConfig {
  baseURL: string;
  gotrueURL: string;
  wsURL: string;
}

export interface WorkspaceMemberProfileUpdate {
  name: string;
  avatar_url?: string;
  cover_image_url?: string;
  custom_image_url?: string;
  description?: string;
}
