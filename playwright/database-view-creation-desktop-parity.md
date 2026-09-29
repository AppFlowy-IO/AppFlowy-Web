# Database view creation: Desktop parity

Web mirrors Desktop's `form_chart_quota.feature`: an isolated hosted Free owner
creates the first Form and Chart, observes independent crowns after each creation,
and selects exhausted allowances to open authenticated annual Pro checkout.
Verified self-hosted instances bypass these plan and quota restrictions, including
when disconnected. Workspace permissions still apply normally.

| Behavior | Web coverage |
| --- | --- |
| Real first Form/Chart creation, persisted IDs/counts and independent allowances | `bdd/features/database/form-chart-quota.feature` |
| Crowns reflect existing server inventory after reload | Same BDD scenario |
| Tab/sidebar checkout creates no extra view or creation request | Same BDD scenario |
| Chart/Timeline and linked variants preserve slash text and editor content on click/Enter | Same BDD scenario; `SlashPanel.creation.test.tsx` |
| Owner crowns; members/guests disabled without crowns | `DatabaseViewCreationAccess.test.tsx`; `useDatabaseViewCreation.test.tsx` |
| Loading/error state has no crown; quotas update while the menu remains open | Same menu and hook tests |
| Known crowns survive slow/failed refreshes; stale allowances stay disabled until confirmed; disconnect clears the snapshot | `useDatabaseViewCreation.test.tsx`; `DatabaseViewCreationAccess.test.tsx` |
| Blocked attempts toast the reason and refetch status; per-layout owner upgrade messages | `useDatabaseViewCreation.test.tsx` |
| Tab-bar checkout shows progress on the clicked item, ignores other items, then closes; sidebar/slash menus close first | `DatabaseViewCreationAccess.test.tsx`; `useDatabaseViewCreation.test.tsx` |
| A reopened menu never trusts a remembered allowance; e2e helpers wait for an enabled, crown-free item | `useDatabaseViewCreation.test.tsx`; `support/view-creation-availability.ts` |
| Self-hosted creation online/offline, beyond hosted allowances, with no billing/quota reads | `DatabaseViewCreationAccess.test.tsx` |
| Self-hosted local Form/Chart conversion; hosted conversion cannot bypass server admission | `Layout.test.tsx`; `useAddDatabaseView.test.tsx` |
| Shared billing requests/TTL, event invalidation, no idle polling, account/workspace isolation | `useDatabaseViewCreation.test.tsx` |
| Ordinary slash searches defer reads; status updates preserve the keyboard listener | `SlashPanel.creation.test.tsx` |

## Cloud fixture

`support/database-view-creation-helpers.ts` uses the existing test authentication
helpers to create a unique account in a fresh Playwright browser context. Sign-in,
WebSocket traffic, folder reads, quota-status reads and view creation use the real
Cloud server. It compares persisted folder IDs with the created database views
and checks that upgrade actions leave the inventory, client view list and editor
content unchanged.

Only billing is simulated: subscription responses model Free, checkout requests
are recorded, and the returned checkout URL opens in an intercepted browser tab.
The test checks workspace, plan, interval, Bearer authentication and the actual
popup URL. It never purchases a subscription or changes an existing account's
plan, server hosting mode, `.env`, or installed application settings.

The fixture fails if the real server is self-hosted or lacks
`GET /api/workspace/{workspace_id}/database-view-creation-status`. It never
substitutes mocked quotas or silently skips those checks.

## Run

Use a Web build with `EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED=true` and a
hosted-mode test server that implements the creation-status endpoint and enforces
the Form/Chart allowances. Existing auth helper credentials and API URLs apply.
For an isolated dev server, without modifying a running instance:

```sh
EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED=true pnpm exec vite --port 3011 --strictPort
```

In another terminal:

```sh
pnpm exec bddgen test -c playwright.bdd.config.ts
BASE_URL=http://localhost:3011 pnpm exec playwright test -c playwright.bdd.config.ts \
  playwright/.features-gen/playwright/bdd/features/database/form-chart-quota.feature.spec.js --workers=1
```

The scenario is registered in the `form-timeline-bdd` CI group. Its current Cloud
pin, `0.18.60-amd64` (`69a888e2fc3dbfa99441c2dc2c01ef49ea217831`), predates the
creation-status endpoint. That server dependency must be updated before this
scenario can pass in CI; the Web change does not alter the pin.
