import { Filter } from '@/application/database-yjs';

export enum PersonFilterCondition {
  PersonContains = 0,
  PersonDoesNotContain = 1,
  PersonIsEmpty = 2,
  PersonIsNotEmpty = 3,
}

export interface PersonFilter extends Filter {
  condition: PersonFilterCondition;
  userIds: string[];
}

export interface PersonTypeOption {
  is_single_select: boolean;
  fill_with_creator: boolean;
  disable_notification: boolean;
  persons: {
    id: string,
    name?: string,
    avatar_url?: string,
  }[];
}

export interface PersonCellData {
  users: {
    id: string,
    name?: string,
    avatar_url?: string,
  }[];
}
