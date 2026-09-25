# Formula and Rollup workflows

`bdd/features/database/rollup-formula-workflows.feature` exercises three real
cross-database workflows through the Formula editor, Rollup property menu,
relation picker, source cell editors, and reload. Fixture schemas and initial
values use the existing database test bridge; subsequent edits use the UI.

| Workflow | Expected results |
| --- | --- |
| Project effort | Conditional task hours aggregate to 8, then 12 and 28 after source edits. Editing the task formula doubles the total to 56. Unlinking/relinking produces 32/56. A project Formula displays each updated Rollup amount. |
| Task research | Completed count 2, unfinished high-priority count 1, completed hours 28, completion 66.7%. Linking a blank-status task changes the denominator to 50%. No matching tasks and a blank-status-only relation produce 0. Removing every relation produces an empty cell; relinking restores the result. |
| Expense budget | Unit price × quantity formulas produce 1000 + 800 + 300 = 2100. Editing equipment quantity produces 2400. A project Formula reads that Rollup to update remaining budget from 900 to 600. |

Every fixture includes an unrelated row with large values that must be excluded.
The scenarios verify persisted Rollup target/calculation choices and the edited
Formula expression. A document token proves live updates did not reload the
project page. Empty-cell assertions require a sustained blank after a previously
nonempty result.

The matching Jest cases in `rollup-formula-combinations.test.ts` exercise the
real Yjs reader and observer, including source and Formula edits, relation
membership changes, zero values, missing statuses, and empty recovery.

The browser scenarios exposed two production bugs that are fixed with additional
regressions:

- Editing a Formula in another tab updated the task values but left the project
  Rollup at 28 instead of 56. Related database metadata had no live sync owner.
  Formula Rollup observers now retain that sync subscription for their lifetime.
  `rollup-related-schema-sync.test.ts` models separate authoritative and cached
  Yjs documents; `useViewSync.retention.test.tsx` checks ownership and cleanup.
- Unlinking the last task left a stale 0 instead of an empty Sum Rollup. Observer
  disposal could invalidate the pending read without starting a replacement.
  The display effect now reads again when relation membership changes.
  `rollupMetadataLoading.test.tsx` checks 0 → empty → 0 both with and without a
  downstream Formula consumer.

Both browser assertions failed before the fixes and passed afterward without
refreshing the project page.

These workflows use explicit Formula → Rollup → Formula properties. Direct
relation traversal such as `current.prop(...)` is a separate unsupported feature;
`relation-traversal-contract.test.ts` verifies that boundary.

The verified local setup used AppFlowy Cloud on port 8000, GoTrue on 9999, and an
isolated Vite server on 3400. From the web repository, start the server in one
terminal (watching is disabled to avoid exhausting this machine's file watchers):

```sh
export APPFLOWY_BASE_URL=http://localhost:8000
export APPFLOWY_GOTRUE_BASE_URL=http://localhost:9999
export APPFLOWY_WS_BASE_URL=ws://localhost:8000/ws/v2
export APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT=true
node --input-type=module -e '
  import { createServer } from "vite";
  const server = await createServer({
    cacheDir: "/tmp/formula-rollup-vite-current-cache",
    plugins: [{ name: "disable-test-watch", configResolved(config) {
      config.server.watch = null;
      config.server.hmr = false;
    }}],
    server: { host: "127.0.0.1", port: 3400, strictPort: true }
  });
  await server.listen();
  server.printUrls();
'
```

In another terminal, run:

```sh
npx bddgen test -c playwright.bdd.config.ts
BASE_URL=http://127.0.0.1:3400 \
APPFLOWY_BASE_URL=http://localhost:8000 \
APPFLOWY_GOTRUE_BASE_URL=http://localhost:9999 \
APPFLOWY_WS_BASE_URL=ws://localhost:8000/ws/v2 \
APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT=true \
npx playwright test -c playwright.bdd.config.ts --project chromium --workers 1 --grep @rollup-formula-select
```

The tag includes the existing Formula/Select Rollup scenario as well as all three
real-world scenarios, so the shared helpers are checked against both fixtures.
