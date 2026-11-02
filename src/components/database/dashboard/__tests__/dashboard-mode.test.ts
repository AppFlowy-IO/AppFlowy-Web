import { readFileSync } from 'fs';
import { join } from 'path';

import {
  canEnterDashboardEdit,
  DASHBOARD_EDIT_ONLY_ACTIONS,
  DASHBOARD_EDIT_ONLY_UPDATE_KEYS,
  DashboardEditPreference,
  DashboardModeEvent,
  reduceDashboardEditPreference,
  resolveDashboardEditing,
  refusesEditOnlyAction,
  touchesEditOnlyKeys,
} from '../dashboard-mode';

type FixtureEvent =
  | { type: 'reset' | 'local_write' | 'pin' }
  | { type: 'loaded'; rows_empty: boolean; created_this_session: boolean }
  | { type: 'remote_rows'; was_empty: boolean; is_empty: boolean }
  | { type: 'set_editing'; editing: boolean };

interface FixtureStep {
  event: FixtureEvent | null;
  can_edit: boolean;
  mobile_context: boolean;
  expect: { preference: DashboardEditPreference; editing: boolean; can_enter_edit: boolean };
}

interface ModeTransitions {
  version: number;
  cases: { name: string; steps: FixtureStep[] }[];
}

// The same golden file the desktop client tests (`dashboard_mode_test.dart`).
const FIXTURE: ModeTransitions = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../application/database-yjs/__fixtures__/dashboard-parity/mode-transitions.json'),
    'utf8'
  )
);

function toEvent(event: FixtureEvent): DashboardModeEvent {
  switch (event.type) {
    case 'loaded':
      return { type: 'loaded', rowsEmpty: event.rows_empty, createdThisSession: event.created_this_session };
    case 'remote_rows':
      return { type: 'remote_rows', wasEmpty: event.was_empty, isEmpty: event.is_empty };
    case 'set_editing':
      return { type: 'set_editing', editing: event.editing };
    default:
      return { type: event.type };
  }
}

describe('R-MODE (mode-transitions.json)', () => {
  it('is version 1 and covers every listed transition', () => {
    expect(FIXTURE.version).toBe(1);
    expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(15);
    const eventTypes = new Set(FIXTURE.cases.flatMap((c) => c.steps.map((step) => step.event?.type ?? null)));

    expect(eventTypes).toEqual(
      new Set([null, 'reset', 'loaded', 'remote_rows', 'local_write', 'pin', 'set_editing'])
    );
  });

  it.each(FIXTURE.cases.map((c) => [c.name, c] as const))('%s', (_name, fixtureCase) => {
    let preference: DashboardEditPreference = 'auto';

    fixtureCase.steps.forEach((step, index) => {
      const inputs = { canEdit: step.can_edit, mobileContext: step.mobile_context };

      if (step.event) preference = reduceDashboardEditPreference(preference, toEvent(step.event), inputs);
      expect({
        step: index,
        preference,
        editing: resolveDashboardEditing(preference, inputs),
        can_enter_edit: canEnterDashboardEdit(inputs),
      }).toEqual({ step: index, ...step.expect });
    });
  });
});

describe('touchesEditOnlyKeys', () => {
  it('lists the Edit-only update keys and view writes', () => {
    // WP05b / WP06: the add flow's view writes, the owned-view duplicate and the widget rename joined the list.
    expect(DASHBOARD_EDIT_ONLY_UPDATE_KEYS).toEqual([
      'rows',
      'showWidgetTitles',
      'showIconsInHeading',
      'addWidgetView',
      'duplicateWidget',
      'renameWidgetView',
    ]);
    expect(DASHBOARD_EDIT_ONLY_ACTIONS).toEqual(['addWidgetView', 'duplicateWidget', 'renameWidgetView']);
  });

  it.each(DASHBOARD_EDIT_ONLY_ACTIONS.map((action) => [action] as const))(
    'refuses the %s view write in a mobile context only',
    (action) => {
      expect(refusesEditOnlyAction(action, { mobileContext: true })).toBe(true);
      expect(refusesEditOnlyAction(action, { mobileContext: false })).toBe(false);
    }
  );

  it('flags rows and display-setting writes', () => {
    expect(touchesEditOnlyKeys({ rows: [] })).toBe(true);
    expect(touchesEditOnlyKeys({ showWidgetTitles: false })).toBe(true);
    // WP03: "Show icons in heading" is an Edit-only display setting too.
    expect(touchesEditOnlyKeys({ showIconsInHeading: true })).toBe(true);
    expect(touchesEditOnlyKeys({ showIconsInHeading: false, globalFilters: [] })).toBe(true);
    expect(touchesEditOnlyKeys({ rows: [], globalFilters: [] })).toBe(true);
  });

  it('lets global filter writes through (they are allowed in View mode)', () => {
    expect(touchesEditOnlyKeys({ globalFilters: [] })).toBe(false);
    expect(touchesEditOnlyKeys({})).toBe(false);
    expect(touchesEditOnlyKeys({ rows: undefined, globalFilters: [] })).toBe(false);
  });
});
