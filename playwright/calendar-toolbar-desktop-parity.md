# Calendar toolbar desktop parity

This change follows the inspected AppFlowy Desktop working tree at `6f25ee4457`,
including its uncommitted calendar changes. That commit alone does not contain
the complete reference implementation. The Web base is
`aa2337fd49cf04bc29b03a3ce88f292612da53db`; validation runs against the working tree
on `codex/calendar-toolbar-desktop-parity`.

The design reference is the [Calendar section in Database](https://www.figma.com/design/a3iCZh32MlkFqc178phnIM/Database?node-id=5032-31895&m=dev).
The inspected nodes are the custom-day screen `5637:149440`, view menu
`5637:149441`, day-count submenu `5637:152475`, and Month trigger `5637:141403`.
The controls use 28px height, 8px button corners, 12px menu corners, and 6px menu
row corners. At narrow widths the toolbar wraps while the controls remain usable.

## Desktop sources

Paths are relative to `AppFlowy-Premium/frontend/appflowy_flutter/`.

| Source                                                                       | Contract                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/appflowy_calendar/lib/src/widgets/toolbar/view_type_switcher.dart` | Week, Month, and Number of days menu; selected view label and checkmark |
| `packages/appflowy_calendar/lib/src/model/calendar_controller.dart`          | 2, 3, 4, 5, 6, and 8 day ranges; focused date; date navigation          |
| `packages/appflowy_calendar/lib/src/widgets/calendar_view.dart`              | View switching, focused date, and keyboard shortcuts                    |
| `packages/appflowy_calendar/lib/src/widgets/toolbar/calendar_toolbar.dart`   | Navigation controls, tooltips, and responsive toolbar                   |
| `lib/plugins/database/calendar/presentation/desktop_calendar.dart`           | Calendar controller ownership and database integration                  |
| `packages/appflowy_calendar/test/widgets/calendar_custom_range_test.dart`    | Untracked desktop working-tree regression coverage for custom ranges    |

Month and Week are standard views. Switching views preserves the focused date;
choosing the already selected view does nothing. A custom range starts exactly on that
day, regardless of the first weekday setting. Previous and Next move by the
selected number of calendar days. Month navigation preserves the day of month,
clamping it when the destination month is shorter. Today retains the selected
view. Editable calendars persist the selected mode and day count in the shared
Yjs layout settings and follow remote changes without remounting. Read-only
viewers can explore a different range locally. The shared setting is restored
when the view is reopened. Legacy layout keys and native Yrs integer values are
supported without replacing unrelated settings.

## Browser coverage

[`calendar-toolbar-parity.spec.ts`](e2e/calendar/calendar-toolbar-parity.spec.ts)
uses new local test accounts and creates actual Calendar databases through the
UI. It covers:

- Selected menu state and all six custom day counts, with exact rendered date
  columns after Previous, Next, Today, and navigation across a month boundary.
- Focus preservation when switching between navigated standard and custom views.
- Single keyboard navigation when the original and sticky toolbars are both
  mounted; view and numeric shortcuts; typing shortcut letters in an event
  input without navigating the calendar.
- Design dimensions, menu corner radii, and contained, non-overlapping controls
  at a 430px viewport. Screenshots capture the toolbar, menu, submenu, and sticky
  toolbar.
- Per-tab range selection through two actual Calendar tabs, and focused-day
  preservation after wheel navigation to the next month.
- A Calendar inserted through the slash menu into an actual editable Slate
  document. Calendar shortcuts change the native view and date columns, while
  typing the same shortcut characters in the surrounding document leaves the
  calendar unchanged.

Existing navigation tests retain their coverage. The cloud Calendar placeholder
BDD scenarios use the updated shared dropdown helper and verify that only
committed cards survive a fresh browser session.

The shared-layout BDD scenario opens the same calendar in two browser sessions,
checks live mode changes, and verifies the saved layout from a fresh session.
The event-color browser tests cover light and dark themes across month, week,
and overflow cards, including past, hover, open, drag, and resize states. These
tests start their own Vite fixture server because CI serves prebuilt application
assets. They do not require an application or backend server.

## React review regressions

Keyboard and pointer focus guards stop at the Calendar container so an outer
Slate textbox or dialog does not disable calendar shortcuts. Inputs inside the
calendar remain protected. Pointer events from portaled menus are excluded from
the focus handler, preserving Radix menu selection.

Current-time indicator DOM queries are scoped to each Calendar instance. Its
scheduled retry is cleared when the view changes or unmounts, preventing one
calendar from changing another calendar's indicator or leaving a stale timer.
Unit regressions cover both instance isolation and focus/portal boundaries; the
embedded browser case exercises genuine Slate markup and editing.

Event completion is derived during render and schedules a timer only for the
affected card. Timers are canceled on unmount and rescheduled when the deadline
changes. A deadline that passes before the effect subscribes still updates the
card. Foreground opacity is applied once so nested titles, times, and icons do
not compound the fade.

## Validation

Use the local Web/API configuration from `.env`. Browser validation uses
Chromium on macOS, Web at `http://localhost:3000`, and the local API at
`http://localhost:8000`. Native Yrs compatibility is covered by checked-in
binary fixtures; browser synchronization uses two Web sessions.

```sh
pnpm exec playwright test \
  playwright/e2e/calendar/calendar-toolbar-parity.spec.ts \
  --workers=1 --trace on

pnpm exec bddgen test -c playwright.bdd.config.ts
pnpm exec playwright test -c playwright.bdd.config.ts \
  --grep '@calendar_shared_layout' --workers=1 --trace on

# This suite supplies its own server even if BASE_URL is unreachable.
BASE_URL=http://127.0.0.1:1 pnpm exec playwright test \
  playwright/e2e/calendar/calendar-event-colors.spec.ts --workers=1
```

Validation of the event appearance and shared-layout changes:

| Check                                                            | Result                                  |
| ---------------------------------------------------------------- | --------------------------------------- |
| Calendar, layout, history, selector, and database-tab unit tests | 155 passed across 15 suites             |
| Light/dark event-color browser checks                            | 2 passed                                |
| Toolbar/range, focus, narrow width, tabs, and embedded E2E       | 5 passed across batch and focused rerun |
| Shared-layout synchronization and fresh-session BDD              | 1 passed                                |
| Web TypeScript and full repository ESLint                        | Passed                                  |

The range-navigation case timed out once during parallel execution and passed
on a focused rerun. The color fixture allows extra time for its initial Vite
compilation while keeping the ordinary assertion timeout for interactions.
Local browser artifacts are under `test-results/calendar-toolbar-review/`,
`test-results/calendar-range-review/`, `test-results/calendar-colors-final/`,
and `test-results/calendar-shared-layout-review/`.

The reviewed previews capture the final browser UI:

- [Desktop toolbar](previews/calendar-toolbar/desktop-toolbar.png)
- [View menu](previews/calendar-toolbar/view-menu.png)
- [Number of days submenu](previews/calendar-toolbar/day-count-menu.png)
- [Compact toolbar](previews/calendar-toolbar/compact-toolbar.png)
