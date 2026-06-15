import { Table } from 'dexie';

import { User } from '@/application/types';

export type UserTable = {
  users: Table<User>;
};

export const userSchema = {
  users: 'uuid',
};