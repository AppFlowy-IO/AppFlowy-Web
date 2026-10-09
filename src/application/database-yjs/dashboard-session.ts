/**
 * Dashboard view ids this client created in this app session. A dashboard
 * created here opens in Edit mode even when it already has widgets (R-MODE
 * `loaded`); the mark is consumed on that first open, so reopening it later
 * resolves from its rows alone. Never persisted.
 */
const createdThisSession = new Set<string>();

export function markDashboardCreatedThisSession(viewId: string) {
  createdThisSession.add(viewId);
}

export function wasDashboardCreatedThisSession(viewId: string): boolean {
  return createdThisSession.has(viewId);
}

export function consumeDashboardCreatedThisSession(viewId: string) {
  createdThisSession.delete(viewId);
}

export function resetDashboardSessionForTests() {
  createdThisSession.clear();
}
