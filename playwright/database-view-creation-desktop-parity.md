# Database view creation: Desktop parity

Web mirrors Desktop's `form_chart_quota.feature`: an isolated hosted Free owner
creates the first Form and Chart, observes independent crowns after each creation,
and selects exhausted allowances to open Pro plan comparison. Clicking Pro starts
monthly checkout directly without an interval-selection dialog.
Verified self-hosted instances bypass plan and quota restrictions. Atomic Web
creation still requires connectivity and a server advertising the creation
capability. Workspace permissions apply normally.

| Behavior | Web coverage |
| --- | --- |
| Real first Form/Chart creation, persisted IDs/counts and independent allowances | `bdd/features/database/form-chart-quota.feature` |
| A new Form and its Responses grid appear together and survive reload | Same BDD scenario |
| Source reads finish before creation; a lost acknowledgement retries the exact operation before activating readable content | `e2e/database/atomic-database-view.spec.ts` |
| Offline and missing-capability attempts preserve tabs, selected view, and existing content without creation requests | Same atomic database-view suite |
| Linked Gallery uses the source database and publishes matching sidebar identity and cards under its document | Same atomic database-view suite |
| Crowns reflect existing server inventory after reload | Same BDD scenario |
| Tab/sidebar checkout creates no extra view or creation request | Same BDD scenario |
| Chart/Timeline and linked variants preserve slash text and editor content on click/Enter | Same BDD scenario; `SlashPanel.creation.test.tsx` |
| Owner crowns; members/guests disabled without crowns | `DatabaseViewCreationAccess.test.tsx`; `useDatabaseViewCreation.test.tsx` |
| Loading/error state has no crown; quotas update while the menu remains open | Same menu and hook tests |
| Confirmed allowances and crowns survive background refreshes and failures; disconnect clears the snapshot | `useDatabaseViewCreation.test.tsx`; `DatabaseViewCreationAccess.test.tsx` |
| Blocked attempts toast the reason and refetch status; per-layout owner upgrade messages | `useDatabaseViewCreation.test.tsx` |
| Upgrade menus hand off to plan comparison without checkout; clicking Pro starts monthly checkout directly without a billing-period dialog | `DatabaseViewCreationAccess.test.tsx`; `bdd/features/database/form-chart-quota.feature` |
| Every opening rechecks billing and quotas; reopened and remounted menus immediately show cached values while requests run; completed billing requests populate the cache even after a menu closes | `useDatabaseViewCreation.test.tsx`; `DatabaseViewCreationAccess.test.tsx` |
| Self-hosted quota admission does not read billing or quotas, including when disconnected; actual creation has separate online/capability admission | `DatabaseViewCreationAccess.test.tsx`; `e2e/database/atomic-database-view.spec.ts` |
| Self-hosted local Form/Chart conversion; hosted conversion cannot bypass server admission | `Layout.test.tsx`; `useAddDatabaseView.test.tsx` |
| Shared billing requests/TTL, event invalidation, no idle polling, account/workspace isolation | `useDatabaseViewCreation.test.tsx` |
| Ordinary slash searches defer reads; status updates preserve the keyboard listener | `SlashPanel.creation.test.tsx` |

## Cloud fixture

`support/database-view-creation-helpers.ts` uses the existing test authentication
helpers to create a unique account in a fresh Playwright browser context. Sign-in,
WebSocket traffic, folder reads, quota-status reads and view creation use the real
Cloud server. It compares persisted folder IDs with the created database views
and checks that upgrade actions leave the inventory, client view list and editor
content unchanged. Its request guard detects both legacy and compact atomic
creation endpoints. Form creation also verifies the server-created Responses grid.

Only billing is simulated: subscription responses model Free, the catalog offers
monthly and annual prices, checkout requests are recorded, and the returned
checkout URL opens in an intercepted browser page. The test checks that no
checkout starts before clicking Pro, then checks the absence of an interval
dialog, workspace, plan, monthly interval, Bearer authentication and the actual
checkout URL. Annual upsells are configured in Stripe and are not simulated or
verified by this scenario. It returns to the source page and verifies unchanged
content and inventory. It never purchases a subscription or changes an existing
account's plan, server hosting mode, `.env`, or installed application settings.

The fixture fails if the real server is self-hosted or lacks
`GET /api/workspace/{workspace_id}/database-view-creation-status`. It never
substitutes mocked quotas or silently skips those checks.

## Run

Use a hosted-mode test server that implements the creation-status endpoint,
advertises atomic default creation, and enforces the Form/Chart allowances.
Existing auth helper credentials and API URLs apply.
For an isolated dev server, without modifying a running instance:

```sh
pnpm exec vite --port 3011 --strictPort
```

In another terminal:

```sh
pnpm exec bddgen test -c playwright.bdd.config.ts
BASE_URL=http://localhost:3011 pnpm exec playwright test -c playwright.bdd.config.ts \
  playwright/.features-gen/playwright/bdd/features/database/form-chart-quota.feature.spec.js --workers=1
```

The scenario is registered in the `form-timeline-bdd` CI group. The Cloud image
used by that job must support both quota status and atomic default creation.
A server without the atomic capability deliberately refuses creation; that
compatibility behavior is covered separately by the atomic database-view suite.
