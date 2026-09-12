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

| Source                                                                       | Contract                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/appflowy_calendar/lib/src/widgets/toolbar/view_type_switcher.dart` | Week, Month, and Number of days menu; selected view label and checkmark                               |
| `packages/appflowy_calendar/lib/src/model/calendar_controller.dart`          | 2, 3, 4, 5, 6, and 8 day ranges; focused date; date navigation                                        |
| `packages/appflowy_calendar/lib/src/widgets/calendar_view.dart`              | Switching standard views resets to today; switching custom ranges preserves focus; keyboard shortcuts |
| `packages/appflowy_calendar/lib/src/widgets/toolbar/calendar_toolbar.dart`   | Navigation controls, tooltips, and responsive toolbar                                                 |
| `lib/plugins/database/calendar/presentation/desktop_calendar.dart`           | Local controller ownership; view changes do not write persisted database layout                       |
| `packages/appflowy_calendar/test/widgets/calendar_custom_range_test.dart`    | Untracked desktop working-tree regression coverage for custom ranges                                  |

Month and Week are standard views. Choosing a different standard view resets the
focused date to today; choosing the already selected standard view does nothing.
Choosing a custom range preserves the focused day and starts exactly on that
day, regardless of the first weekday setting. Previous and Next move by the
selected number of calendar days. Month navigation preserves the day of month,
clamping it when the destination month is shorter. Today retains the selected
view. View selection remains local session state and does not write Yjs layout
settings.

## Browser coverage

[`calendar-toolbar-parity.spec.ts`](e2e/calendar/calendar-toolbar-parity.spec.ts)
uses new local test accounts and creates actual Calendar databases through the
UI. It covers:

- Selected menu state and all six custom day counts, with exact rendered date
  columns after Previous, Next, Today, and navigation across a month boundary.
- Focus preservation when moving from a navigated Month or Week to a custom
  range, and reset to today when switching back to a standard view.
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

## Validation

Use the normal local Web/API configuration. For this session Web runs at
`http://localhost:3005`, with API/WebSocket traffic proxied to the isolated local
API at `127.0.0.1:8015` and local authentication at `127.0.0.1:9999`.
The API uses the existing development binary copied from
`AppFlowy-Cloud-Preminum/target/macos-dev/appflowy_cloud`; matching that binary to
the backend working-tree source was not verified. These are Web browser tests,
not a live Flutter/Web synchronization run.

```sh
BASE_URL=http://localhost:3005 \
APPFLOWY_BASE_URL=http://localhost:3005 \
APPFLOWY_GOTRUE_BASE_URL=http://localhost:3005/gotrue \
APPFLOWY_WS_BASE_URL=ws://localhost:3005/ws/v2 \
pnpm exec playwright test \
  playwright/e2e/calendar/calendar-toolbar-parity.spec.ts \
  playwright/e2e/calendar/calendar-navigation.spec.ts \
  --workers=1 --trace on

pnpm exec bddgen -c playwright.bdd.config.ts
BASE_URL=http://localhost:3005 \
APPFLOWY_BASE_URL=http://localhost:3005 \
APPFLOWY_GOTRUE_BASE_URL=http://localhost:3005/gotrue \
APPFLOWY_WS_BASE_URL=ws://localhost:3005/ws/v2 \
pnpm exec playwright test -c playwright.bdd.config.ts \
  --grep '@calendar-placeholder' --workers=1 --trace on
```

Validation on the inspected working tree:

| Check                                                     | Result                    |
| --------------------------------------------------------- | ------------------------- |
| Toolbar/range E2E after React review                      | 4 passed                  |
| Real embedded Slate E2E after React review                | 1 passed, 22.4 seconds    |
| Existing navigation E2E before React review               | 5 passed                  |
| Cloud Calendar placeholder BDD before React review        | 2 passed, 1.4 minutes     |
| Final Calendar and database view unit tests               | 89 passed across 9 suites |
| Final Web TypeScript and changed production-source ESLint | Passed                    |

The E2E tests use the existing 120-second timeout. All five parity scenarios
passed after the React review. The new embedded scenario passed in a focused
rerun after adding the normal database creation dialog dismissal to its setup.
The earlier full browser batch passed all nine then-existing E2E cases in
4.9 minutes at source fingerprint
`c4c1e09b5d2cc74715e54a5d5643e17a2a2565a8e008bd9d312e1685643693c0`.
The final review source fingerprint is
`4e55ab25d5d495965f4eaf2fcae7ccc8f8079db7722b1f0eab9fe6546b459ae2`.
It hashes sorted relative paths and contents for Calendar `.ts`/`.tsx` files,
`DatabaseViews.tsx`, and English translations, with NUL separators. Session logs
and traces are under `/tmp/appflowy-rollup-parity/`:
`calendar-final-tests.log`, `calendar-final-results/`,
`calendar-placeholder-bdd.log`, `calendar-placeholder-results/`,
`calendar-react-review-final-tests.log`, `calendar-react-review-final-results/`,
`calendar-embedded-review-tests.log`, and `calendar-embedded-review-results/`.

The reviewed previews capture the final browser UI:

- [Desktop toolbar](previews/calendar-toolbar/desktop-toolbar.png)
- [View menu](previews/calendar-toolbar/view-menu.png)
- [Number of days submenu](previews/calendar-toolbar/day-count-menu.png)
- [Compact toolbar](previews/calendar-toolbar/compact-toolbar.png)
