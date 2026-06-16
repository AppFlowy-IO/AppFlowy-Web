import { Table } from 'dexie';

import { View } from '@/application/types';

export interface AppViewCacheRecord {
  user_id: string;
  workspace_id: string;
  view_id: string;
  data: View;
  updated_at: number;
}

export type AppViewCacheTable = {
  app_view_cache: Table<AppViewCacheRecord, [string, string, string]>;
};

export const appViewCacheSchema = {
  app_view_cache: '[user_id+workspace_id+view_id], user_id, workspace_id, view_id, updated_at',
};
