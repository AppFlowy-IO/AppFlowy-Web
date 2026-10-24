import type { DashboardLayoutUpdate } from '@/application/database-yjs/dashboard.type';

/**
 * R-MODE: the local Edit preference of one open dashboard. Never persisted,
 * never synced. `auto` resolves on the first layout snapshot to `auto_on` (an
 * empty dashboard, or one created in this session: editors start building
 * right away) or `off`. `auto_on` behaves like `on` until the editor acts or
 * remote widgets fill an empty dashboard.
 *
 * The same reducer runs on desktop (`dashboard_mode.dart`); both are checked
 * against `dashboard-parity/mode-transitions.json`.
 */
export type DashboardEditPreference = 'auto' | 'auto_on' | 'on' | 'off';

export type DashboardModeEvent =
  /** Only when a provider is reused for another dashboard view. */
  | { type: 'reset' }
  /** Once per holder, on the first layout snapshot, whatever the access. */
  | { type: 'loaded'; rowsEmpty: boolean; createdThisSession: boolean }
  /** The stored rows changed without a write of this client. */
  | { type: 'remote_rows'; wasEmpty: boolean; isEmpty: boolean }
  /** A layout write of this client (rows, display settings, global filter structure). */
  | { type: 'local_write' }
  /** The editor started building (the add flow). */
  | { type: 'pin' }
  /** Edit / Done. */
  | { type: 'set_editing'; editing: boolean };

/**
 * Access and platform are inputs, never events: a change of either never
 * changes the preference, so Edit mode comes back with write access (#39) and
 * when a narrow window widens again.
 */
export interface DashboardModeInputs {
  canEdit: boolean;
  mobileContext: boolean;
}

export function canEnterDashboardEdit(inputs: DashboardModeInputs): boolean {
  return inputs.canEdit && !inputs.mobileContext;
}

export function resolveDashboardEditing(preference: DashboardEditPreference, inputs: DashboardModeInputs): boolean {
  return canEnterDashboardEdit(inputs) && (preference === 'on' || preference === 'auto_on');
}

export function reduceDashboardEditPreference(
  preference: DashboardEditPreference,
  event: DashboardModeEvent,
  inputs: DashboardModeInputs
): DashboardEditPreference {
  switch (event.type) {
    case 'reset':
      return 'auto';
    case 'loaded':
      if (preference !== 'auto') return preference;
      return event.createdThisSession || event.rowsEmpty ? 'auto_on' : 'off';
    case 'remote_rows':
      // Only the transition from empty to non-empty ends an automatic Edit.
      return preference === 'auto_on' && event.wasEmpty && !event.isEmpty ? 'off' : preference;
    case 'local_write':
    case 'pin':
      return preference === 'auto_on' ? 'on' : preference;
    case 'set_editing':
      if (!event.editing) return 'off';
      return canEnterDashboardEdit(inputs) ? 'on' : preference;
  }
}

/** The `updateSetting` keys that only Edit mode may write. */
const DASHBOARD_EDIT_ONLY_LAYOUT_KEYS = [
  'rows',
  'showWidgetTitles',
  'showIconsInHeading',
] as const satisfies readonly (keyof DashboardLayoutUpdate)[];

/**
 * Writes outside the layout setting that only Edit mode may make (WP05b,
 * WP06): creating a widget's view in the add flow (the default view, a type
 * pick, a view in another database), duplicating a widget with an owned copy
 * of its view, and renaming a widget's view. Desktop marks the same events
 * with `DashboardEditOnlyEvent`.
 */
export const DASHBOARD_EDIT_ONLY_ACTIONS = ['addWidgetView', 'duplicateWidget', 'renameWidgetView'] as const;

export type DashboardEditOnlyAction = (typeof DASHBOARD_EDIT_ONLY_ACTIONS)[number];

/**
 * Everything only Edit mode may write: the `updateSetting` keys and the
 * view writes of `DASHBOARD_EDIT_ONLY_ACTIONS`. A mobile context refuses each
 * of them. Every later edit-only display setting or action joins this list.
 */
export const DASHBOARD_EDIT_ONLY_UPDATE_KEYS = [
  ...DASHBOARD_EDIT_ONLY_LAYOUT_KEYS,
  ...DASHBOARD_EDIT_ONLY_ACTIONS,
] as const;

export function touchesEditOnlyKeys(update: DashboardLayoutUpdate): boolean {
  return DASHBOARD_EDIT_ONLY_LAYOUT_KEYS.some((key) => update[key] !== undefined);
}

/** Whether a mobile context refuses `action` (every edit-only action is refused there). */
export function refusesEditOnlyAction(action: DashboardEditOnlyAction, inputs: Pick<DashboardModeInputs, 'mobileContext'>) {
  return inputs.mobileContext && (DASHBOARD_EDIT_ONLY_UPDATE_KEYS as readonly string[]).includes(action);
}
