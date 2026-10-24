# Saved dashboard publication regression

`dashboard-publish-showcase.json` records expected UI results from the verified
`af_server_20261009` snapshot. It covers Agency hub (7 widgets, 4 databases) and
Full house (12 widgets, 3 databases) in **Pro workspace → dashboards**. IDs match
the server fixture `tests/fixtures/dashboard_publish_showcase.json`; expected
values were recorded before publishing and must not be inferred from public responses.
Both fixtures use select/checkbox filters, fixed source dates, and date sorts;
neither uses a relative date filter, so their expected results do not require a frozen clock.

Restore that snapshot before the first run. Provide the existing owner's email
and password through `DASHBOARD_PUBLISH_FIXTURE_EMAIL` and
`DASHBOARD_PUBLISH_FIXTURE_PASSWORD` in the process environment; do not save them
in a tracked file or put them in a command line. The suite never creates an
account, grants Pro, edits rows, or publishes source databases separately.

With the web app and server running, execute:

```sh
pnpm exec bddgen test -c playwright.bdd.config.ts
RUN_DASHBOARD_PUBLISH_FIXTURE=1 BASE_URL=http://localhost:3001 \
  APPFLOWY_BASE_URL=http://localhost:8000 \
  pnpm exec playwright test -c playwright.bdd.config.ts --workers=1 --retries=0 \
  playwright/.features-gen/playwright/bdd/features/database/published-dashboard-showcase.feature.spec.js
```

Each fixture must start unpublished, including the referenced widget views.
If server tests published these fixtures first, unpublish those specific fixture
pages before running BDD. This precondition prevents an earlier publication from
masking missing dashboard dependencies. Teardown unpublishes the scenario's
fixture IDs, including a partially completed publication; saved data stays intact.
Unpublishing retains the saved publication configuration. If an earlier server
test published the host container, Share keeps that container's URL identity
when publishing again. The suite checks the binary request against the saved
configuration and the URL shown by Share; it accepts either that canonical host
or the dashboard child, while requiring the dashboard and its host views in the payload.

The test publishes with the dashboard selected and opens the exact Share link
in an anonymous browser, then selects its dashboard tab in the public UI (a
retained host publication can start on Grid). Every widget's source IDs and real row/chart values are
checked on first load, after reload, and after navigating through the public
container and selecting the dashboard tab. Tracing is disabled for this suite
because it signs in with an existing account. Command-line tracing overrides are
rejected before login, since they could record authentication headers.
