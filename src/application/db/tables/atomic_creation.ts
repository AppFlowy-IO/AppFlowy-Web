import type { AtomicCreationRecord } from '@/application/atomic-creation/types';

import type { Table } from 'dexie';


export type AtomicCreationTable = { atomic_creation: Table<AtomicCreationRecord, string> };
export const atomicCreationSchema = {
  atomic_creation: 'id, [serverUrl+userId+workspaceId], &[serverUrl+userId+workspaceId+requestId]',
};
