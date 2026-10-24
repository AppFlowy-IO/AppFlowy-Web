import { useState } from 'react';

import type { DashboardEditPreference } from '../dashboard-mode';

/**
 * What a dashboard view's mode needs to resume: the Edit preference, and
 * whether its rows were empty, so widgets that arrived while another tab was
 * shown still end an automatic Edit mode (as the desktop bloc, which stays
 * alive across tabs, does).
 */
export interface DashboardModeSnapshot {
  preference: DashboardEditPreference;
  rowsEmpty: boolean;
}

/**
 * The mode of each dashboard view of one open page, by view id.
 * `DashboardProvider` unmounts on a tab switch while `DatabaseViews` stays
 * mounted, so the store lives there: switching to another tab and back keeps
 * Edit mode for the life of the page.
 */
export type DashboardModeStore = Map<string, DashboardModeSnapshot>;

export function useDashboardModeStore(): DashboardModeStore {
  const [store] = useState<DashboardModeStore>(() => new Map());

  return store;
}
