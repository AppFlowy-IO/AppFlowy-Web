# Dashboard design-system review

This change brings dashboard cards, controls, filters, creation panels and empty states onto the AppFlowy design system. Headers and content share one bordered card, the dashboard canvas uses a recessed surface, and tools use consistent sizing, typography, focus and selection states.

The implementation follows the AppFlowy UI System Design skill's verified 2026-11-03 snapshot of [AppFlowy's Design System](https://www.figma.com/design/aphWa2OgkqyIragpatdk7a/Design-System). No dashboard-specific Figma layout was supplied; component specs and semantic roles guide the composition.

## Components and tokens

- Reuse the existing Button, Input, DropdownMenu, Popover, Switch and Tooltip components. Use the already installed Radix RadioGroup for the new-view layout selector, including arrow navigation and a single tab stop.
- Desktop controls use 32px height, 14/20 typography, 20px icons and 6px corners. Floating menus and popovers use 12px corners, Border/primary, Surface/layer-04 and the existing Small shadow aliases.
- Mobile search uses a 40px field and 16/24 text. Compact widget tools use a 32px visual control with a 40px hit area.
- Card and canvas surfaces use Surface/primary and Surface Container/layer-00. Text uses Text/primary, secondary and tertiary; controls use Icon/secondary, primary and info-thick; selection and focus use Fill/theme-select and Border/theme-thick. Transparent hover uses Fill/content-hover. Destructive menu actions use the semantic error roles on hover/focus.
- Preserve the existing dashboard row sizes, content viewports, data renderers, saved layouts and persisted display settings. The title-hidden search capsule can expand within its widget; narrow headers allow search to shrink.

## Deliberate deviations and existing drift

Shared design-system components and generated tokens are outside this feature migration. Local classes correct the existing Button/Input/menu-item radius differences without changing controls elsewhere. Dashboard widget search styling applies only to the existing widget variant.

Existing Web Small shadow aliases are reused rather than introducing literal effects; their generated values are not an exact match for the Figma effect definition. Tooltips reuse the shared component, including its current radius and inverse-surface behavior. The current Web drift check reports one existing difference: dark Surface/inverse is `#3d404f` in code and `#f8faff` in the snapshot. No missing semantic token was needed by this change. The global token definitions remain unchanged.

The legacy shared Web/Desktop pixel-parity contract still describes the previous dashboard chrome (including 24px widget tools, 16px icons and 10px popover corners). This Web design-system migration intentionally changes those values. The shared fixtures are unchanged, and `playwright/bdd/features/database/dashboard-visual-parity.feature` was **not run**. Cross-client visual parity needs a separate coordinated contract update; the unit parity-asset consistency check does pass.

## Validation

- **1,364 tests pass across 91 suites**: dashboard, conditions/search, dashboard settings and database host/scope tests.
- `pnpm type-check`: passes.
- ESLint and Prettier on every changed/new TypeScript file: pass.
- `pnpm build`: passes (37.41s; existing large-chunk warnings remain).
- Design-system token audit: **0 hard-coded color literals** in changed/new TypeScript files.
- Web token drift check: the one existing dark Surface/inverse difference above.
- `git diff --check`: passes.
- Real localhost browser checks: settings keyboard navigation and return focus, source-picker autofocus/arrow navigation, named filter panels and Escape, widget creation/loading/configuration, debounced desktop/mobile search and clear, light/dark themes and responsive layouts.
- At 1024px with the sidebar open, checked both titled and title-hidden widgets. The title-hidden expanded search stayed inside a 282px widget (254px capsule, 97px search field); all header controls remained within the widget bounds.
- Final localhost dashboard load has no console errors or warnings. The optional billing service on port 4242 was unavailable during paid-plan checks; existing dashboards and widget creation were verified. No hosted environment was used.

Focused test command:

```sh
pnpm exec jest --runInBand --no-coverage --silent \
  src/components/database/dashboard \
  src/components/database/components/conditions \
  src/components/database/components/settings/__tests__/DashboardSettings.test.tsx \
  src/components/database/__tests__/DatabaseViews.search.test.tsx \
  src/components/database/__tests__/DatabaseViews.dashboard-scope.test.tsx \
  src/components/database/__tests__/Database.dashboard-host.test.tsx
```

## Screenshot provenance

All **28 before/after pairs** below are unmodified browser captures. Desktop captures use a 1440×1000 CSS viewport at 2× device scale (2880×2000 pixels); mobile captures use 390×844 at 1×. Every pair has matching image dimensions.

- Baseline: `origin/main` at `a8d65e46`. Initial baseline captures used the new worktree before edits; additional baseline states used the original checkout at `0ef037b4`, whose dashboard and relevant UI sources are identical to that main revision.
- After: this branch, from the dedicated Git worktree, served on localhost:3001.
- Full house, Life OS, Team delivery and Request intake examples use existing local workspace dashboards and real data. The comparison covers Number, Donut, Bar, Line, Grid, List, Gallery, Feed, Timeline, Board, Calendar and Form rendering layouts through the updated shared widget frame.
- The two empty-dashboard pairs use the actual production DashboardEmptyState component in Storybook with an inert DashboardContext, rendered in dark mode. They are component previews rather than a saved empty dashboard page.
- The Life OS/gallery/feed/mobile List pairs temporarily used the same private empty-date condition on each origin to reveal populated data. Reset restored the saved filter afterward; no shared filter was saved. The original date-filter editor is shown separately.
- Temporary widgets created to capture pending/configuration states were deleted, and the original 12 Full house widget IDs were verified. Original hidden-title settings and dark theme were restored. Source database rows were not edited.

## Dashboard pages and themes

| Surface | Before | After |
| --- | --- | --- |
| Full house — number and donut widgets | ![Before: Full house — number and donut widgets](before/full-house-overview.webp) | ![After: Full house — number and donut widgets](after/full-house-overview.webp) |
| Full house — dark theme | ![Before: Full house — dark theme](before/full-house-dark.webp) | ![After: Full house — dark theme](after/full-house-dark.webp) |
| Widgets with titles hidden | ![Before: Widgets with titles hidden](before/titleless-widgets.webp) | ![After: Widgets with titles hidden](after/titleless-widgets.webp) |
| Life OS — page overview and global filters | ![Before: Life OS — page overview and global filters](before/life-os-overview.webp) | ![After: Life OS — page overview and global filters](after/life-os-overview.webp) |
| Dashboard Edit mode | ![Before: Dashboard Edit mode](before/edit-dashboard.webp) | ![After: Dashboard Edit mode](after/edit-dashboard.webp) |
| Empty dashboard — View mode | ![Before: Empty dashboard — View mode](before/empty-dashboard.webp) | ![After: Empty dashboard — View mode](after/empty-dashboard.webp) |
| Empty dashboard — Edit mode | ![Before: Empty dashboard — Edit mode](before/empty-dashboard-edit.webp) | ![After: Empty dashboard — Edit mode](after/empty-dashboard-edit.webp) |

## Widget layouts

| Surface | Before | After |
| --- | --- | --- |
| Donut, vertical and horizontal bar charts | ![Before: Donut, vertical and horizontal bar charts](before/full-house-charts.webp) | ![After: Donut, vertical and horizontal bar charts](after/full-house-charts.webp) |
| Line chart, List and Grid widgets | ![Before: Line chart, List and Grid widgets](before/full-house-data-widgets.webp) | ![After: Line chart, List and Grid widgets](after/full-house-data-widgets.webp) |
| Gallery and Feed widgets | ![Before: Gallery and Feed widgets](before/gallery-feed-widgets.webp) | ![After: Gallery and Feed widgets](after/gallery-feed-widgets.webp) |
| Timeline widget | ![Before: Timeline widget](before/timeline-widget.webp) | ![After: Timeline widget](after/timeline-widget.webp) |
| Board and Calendar widgets | ![Before: Board and Calendar widgets](before/board-calendar-widgets.webp) | ![After: Board and Calendar widgets](after/board-calendar-widgets.webp) |
| Form widget | ![Before: Form widget](before/form-widget.webp) | ![After: Form widget](after/form-widget.webp) |

## Menus, filters and widget creation

| Surface | Before | After |
| --- | --- | --- |
| Dashboard settings | ![Before: Dashboard settings](before/dashboard-settings.webp) | ![After: Dashboard settings](after/dashboard-settings.webp) |
| Global filter picker | ![Before: Global filter picker](before/global-filter.webp) | ![After: Global filter picker](after/global-filter.webp) |
| Global filter editor | ![Before: Global filter editor](before/global-filter-editor.webp) | ![After: Global filter editor](after/global-filter-editor.webp) |
| Widget options menu | ![Before: Widget options menu](before/widget-menu.webp) | ![After: Widget options menu](after/widget-menu.webp) |
| Widget view settings | ![Before: Widget view settings](before/widget-settings.webp) | ![After: Widget view settings](after/widget-settings.webp) |
| Widget filter popover | ![Before: Widget filter popover](before/widget-filter.webp) | ![After: Widget filter popover](after/widget-filter.webp) |
| Widget source picker | ![Before: Widget source picker](before/source-picker.webp) | ![After: Widget source picker](after/source-picker.webp) |
| Add-widget picker | ![Before: Add-widget picker](before/add-widget-picker.webp) | ![After: Add-widget picker](after/add-widget-picker.webp) |
| New-view configuration | ![Before: New-view configuration](before/new-view-configuration.webp) | ![After: New-view configuration](after/new-view-configuration.webp) |
| Pending widget while creating a view | ![Before: Pending widget while creating a view](before/pending-widget.webp) | ![After: Pending widget while creating a view](after/pending-widget.webp) |

## Desktop search and mobile

| Surface | Before | After |
| --- | --- | --- |
| Desktop widget search | ![Before: Desktop widget search](before/desktop-search.webp) | ![After: Desktop widget search](after/desktop-search.webp) |
| Mobile dashboard | ![Before: Mobile dashboard](before/mobile-dashboard.webp) | ![After: Mobile dashboard](after/mobile-dashboard.webp) |
| Mobile global filters | ![Before: Mobile global filters](before/mobile-filters.webp) | ![After: Mobile global filters](after/mobile-filters.webp) |
| Mobile List search | ![Before: Mobile List search](before/mobile-search.webp) | ![After: Mobile List search](after/mobile-search.webp) |
| Mobile Grid search with a query | ![Before: Mobile Grid search with a query](before/mobile-search-query.webp) | ![After: Mobile Grid search with a query](after/mobile-search-query.webp) |
