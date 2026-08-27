import { Table } from 'dexie';

import { WorkspaceDatabaseViewItem } from '@/application/services/services.type';

export interface WorkspaceDatabaseCatalogRecord {
  user_id: string;
  workspace_id: string;
  database_id: string;
  view_id: string;
  database_order: number;
  view_order: number;
  view: WorkspaceDatabaseViewItem;
  updated_at: number;
}

export type WorkspaceDatabaseCatalogTable = {
  workspace_database_catalog: Table<WorkspaceDatabaseCatalogRecord, [string, string, string]>;
};

export const workspaceDatabaseCatalogSchema = {
  workspace_database_catalog:
    '[user_id+workspace_id+view_id], [user_id+workspace_id], [user_id+workspace_id+database_id], updated_at',
};
