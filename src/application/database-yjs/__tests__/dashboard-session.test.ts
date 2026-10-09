import {
  consumeDashboardCreatedThisSession,
  markDashboardCreatedThisSession,
  resetDashboardSessionForTests,
  wasDashboardCreatedThisSession,
} from '../dashboard-session';

describe('dashboard-session', () => {
  afterEach(() => resetDashboardSessionForTests());

  it('remembers the dashboards created in this session', () => {
    expect(wasDashboardCreatedThisSession('dashboard-a')).toBe(false);

    markDashboardCreatedThisSession('dashboard-a');

    expect(wasDashboardCreatedThisSession('dashboard-a')).toBe(true);
    expect(wasDashboardCreatedThisSession('dashboard-b')).toBe(false);
  });

  it('forgets a dashboard once its mark is consumed', () => {
    markDashboardCreatedThisSession('dashboard-a');
    markDashboardCreatedThisSession('dashboard-b');

    consumeDashboardCreatedThisSession('dashboard-a');

    expect(wasDashboardCreatedThisSession('dashboard-a')).toBe(false);
    expect(wasDashboardCreatedThisSession('dashboard-b')).toBe(true);
    // Consuming an unmarked id is a no-op.
    expect(() => consumeDashboardCreatedThisSession('never-marked')).not.toThrow();
  });

  it('clears every mark on reset', () => {
    markDashboardCreatedThisSession('dashboard-a');
    markDashboardCreatedThisSession('dashboard-b');

    resetDashboardSessionForTests();

    expect(wasDashboardCreatedThisSession('dashboard-a')).toBe(false);
    expect(wasDashboardCreatedThisSession('dashboard-b')).toBe(false);
  });
});
