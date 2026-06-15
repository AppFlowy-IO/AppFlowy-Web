import { Table } from 'dexie';

import { MentionablePerson } from '@/application/types';

export interface WorkspaceMemberProfile extends MentionablePerson {
  workspace_id: string;
  user_uuid: string;
  updated_at: number;
}

export type WorkspaceMemberProfileTable = {
  workspace_member_profiles: Table<WorkspaceMemberProfile>;
};

export const workspaceMemberProfileSchema = {
  workspace_member_profiles: '[workspace_id+user_uuid], workspace_id, user_uuid',
};
