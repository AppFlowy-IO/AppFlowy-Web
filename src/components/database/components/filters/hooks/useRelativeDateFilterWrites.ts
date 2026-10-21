import { useSyncExternalStore } from 'react';

import { canWriteRelativeDateComparisons } from '@/application/database-yjs/fields/date/relativeDateCompatibility';
import { subscribeToServerInfo } from '@/utils/server-info';

export function useRelativeDateFilterWrites(): boolean {
  return useSyncExternalStore(subscribeToServerInfo, canWriteRelativeDateComparisons, () => false);
}
