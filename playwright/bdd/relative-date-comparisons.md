# Relative date comparison BDD

`features/database/relative-date-comparisons.feature` drives the full Web app
against a running AppFlowy Cloud and GoTrue service. It creates a disposable
account and Grid, adds a Date property, and enters Yesterday/Today/Tomorrow rows
through the UI. It does not inject database fields, rows, or filters into Yjs.

The browser clock advances normally during authentication and synchronization;
only the final next-day step shifts its system time.

The scenario checks all five comparison operators, all three relative operands,
simple-to-advanced conversion and editing, reload, and next-day refresh when the
page becomes visible. Exact row lists catch both missing and unexpected matches.
It also opens the same database in a separate authenticated browser context
without IndexedDB twice, each with its own device identity and after pending
collaboration edits have drained, verifying that both simple and advanced filter content
and rows are retrieved from Cloud rather than the writer's local cache.

The only intercepted response is `/api/server-info`: the test fetches the real
response and adds `enable_relative_date_comparisons: true` for its own browser
contexts. The capability has not been enabled on the server. Authentication,
database creation, cell/filter writes, and synchronization use real services.
This test does not authorize production rollout to incompatible Desktop clients.

Run the Web branch's dev server and supply the local service URLs to the test
process (the shared auth helper applies them only to disposable browser contexts):

```sh
pnpm exec bddgen test -c playwright.bdd.config.ts
BASE_URL=http://127.0.0.1:3000 \
APPFLOWY_BASE_URL=http://127.0.0.1:3000 \
APPFLOWY_GOTRUE_BASE_URL=http://127.0.0.1:3000/gotrue \
APPFLOWY_WS_BASE_URL=ws://127.0.0.1:3000/ws/v2 \
PLAYWRIGHT_VIDEO=on \
pnpm exec playwright test -c playwright.bdd.config.ts \
  --workers=1 --grep @relative-date-comparisons
```

Use the local test services' `GOTRUE_ADMIN_EMAIL` and `GOTRUE_ADMIN_PASSWORD` if
they differ from the existing helpers' defaults. `PLAYWRIGHT_VIDEO=on` retains
successful test videos; the normal BDD configuration still defaults to no video.
The scenario is included in the existing `database-bdd` CI group.
