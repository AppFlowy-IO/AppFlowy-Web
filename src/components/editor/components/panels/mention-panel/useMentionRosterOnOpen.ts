import { useEffect } from 'react';

import { loadMentionableUsers } from '@/components/database/components/cell/person/useMentionableUsers';

/**
 * Loads the workspace roster when an editor @ picker opens with its item details on (MEN-WEB-13):
 * once for each opening that passes `workspaceId`, and never while it is `undefined`. The roster
 * cache answers (`useMentionableUsers.ts`): memory, else IndexedDB, else one GET of the released
 * `mentionable-person` endpoint, shared with every other reader. It hands what it loads to the local
 * index (`recordMentionRoster`), which the picker reads: a person result then shows its avatar, and
 * a collaborator whom awareness names only by uid (Desktop) counts as on the page. Until the roster
 * arrives, or when it cannot load, the picker keeps what the tab has: initials, as before.
 */
export function useMentionRosterOnOpen(workspaceId: string | undefined): void {
  useEffect(() => {
    if (!workspaceId) return;

    void loadMentionableUsers(workspaceId).catch(() => undefined);
  }, [workspaceId]);
}
