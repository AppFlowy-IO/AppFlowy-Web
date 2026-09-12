# Rollup filter parity with Desktop

Reviewed the eleven AppFlowy-Premium runtime PRs and final infrastructure/coverage PR below, including their Flutter controls and Rust filtering/persistence changes. The web implementation uses the same persisted metadata and evaluates related cells through its existing Yjs rollup cache. The final audit uses #1361 head `91f9068765c7e44c07e69fbd54b3bc91ca48d7b2`, based on merged #1360.

| Desktop PR | Web behavior | Regression coverage |
| --- | --- | --- |
| [#1343](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1343) | Optional `rollup_meta` alongside `rollup_target_ty`; missing fields, explicit zero, and legacy filters stay distinct | Metadata parsing and Yjs encode/decode tests |
| [#1344](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1344) | Any / None / Every over text, URL, and number source cells; percent scaling once, negative currency and decimal precision | Mixed lists, empty cells, no related rows, unique display, number comparisons |
| [#1351](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1351) | Native select option IDs, checkbox, and checklist predicates | Typed visibility cases and simple/advanced picker tests |
| [#1352](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1352) | Relation row IDs, person UUIDs, exact creator/editor UIDs, media attachment emptiness | Native predicates, relation target picker, email search, unresolved selections |
| [#1353](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1353) | Date endpoints and relative dates; calculated numeric/date predicates; numeric visualization independent of source type | Raw date endpoints, equal-duration changes, midnight refresh, date range editing, Count over nonnumeric sources |
| [#1355](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1355) | Shared simple/advanced controls, independent nested rules, mode-preserving edits | Real dropdown/input interactions, nested mixed Yjs/plain trees, stale callbacks |
| [#1356](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1356) | The same web controls wrap within a constrained viewport | Browser scenario at desktop and 430px widths |
| [#1357](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1357) | Configuration migration across all views, preserving rule/group IDs; compatible predicates survive and incompatible predicates reset | Source replacement, relation database replacement, list/calculated changes, numeric/date changes, stale edits |
| [#1358](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1358) | People list cells show names and avatars, follow roster updates, retain duplicate occurrences and unknown people | Joined JSON parsing, large UIDs, delayed roster, renamed users, bounded tags |
| [#1359](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1359) | Searchable select/person filter pickers; hidden IDs survive selection; relation fields show their database label | Search/clear/repeated selection and unknown-user removal tests |
| [#1360](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1360) | Legacy formatted numeric comparisons use authoritative source cells; lists apply their source number format; open editors reject stale drafts; unresolved select summaries retain selected counts | Currency, localized display, percentages and precision; all eight native numeric conditions, including empty checks with retained content; scalar/aggregate precedence; NumberMode; live editor reconfiguration and unresolved summaries |
| [#1361](https://github.com/AppFlowy-IO/AppFlowy-Premium/pull/1361) | Native Rust feature compatibility, CI checks, fixture timeouts and final coverage inventory; no additional web runtime implementation | Audited the final coverage report and #1360, including creation defaults, Anonymous/raw people fallback, picker no-results feedback and query reset |

Flutter's native mobile sheets and select-cell widgets are represented by the web's shared popovers and existing cell editor. No Flutter UI code is copied into the web client.

## Persisted contract

```json
{
  "field_id": "rollup-field",
  "rollup_target_ty": 0,
  "condition": 0,
  "content": "Alpha",
  "rollup_meta": {
    "target_field_type": 0,
    "rollup_filter_mode": 0,
    "rollup_show_as": 1,
    "relation_field_id": "relation-field",
    "target_field_id": "source-field"
  }
}
```

`rollup_target_ty` identifies the predicate type; `target_field_type` identifies the source. They differ for calculated numbers, calculated dates, URL text, and creation/modification timestamps. Modes are Any=0, None=1, Every=2. Displays are Calculated=0, OriginalList=1, UniqueList=2. Calculated metadata carries `rollup_calculation_type` instead of a list mode.

Any requires one matching related cell. None requires no matches. Every requires a nonempty relation and all cells to match. A linked row with a missing cell participates as an empty cell. Display deduplication does not change predicate counts. Native list filters stay inactive while their source data is unresolved; incomplete predicates also stay inactive.

Legacy joined-text filters retain their old meaning when native list metadata is absent. Legacy numeric list comparisons use any matching Number source cell only when the display cannot be read as a scalar and no raw aggregate is available. Empty checks retain aggregate display semantics. Currency punctuation is never guessed when source data is unavailable. Background schema resolution does not backfill legacy metadata. Explicit configuration changes migrate filters and reject callbacks from obsolete editors. Match data and raw calculated dates remain ephemeral cache values rather than being written into filter documents.

New date predicates start on local today and new Media predicates start with IsNotEmpty. Configuration migration deliberately resets dates to an unfinished blank predicate and Media to IsEmpty, matching desktop's separate migration defaults.

Numeric lists use the existing web number formatter (for example `$10` instead of desktop's `$10.00`). Predicate comparisons retain the source decimal independently of rounded labels. Both simple and advanced legacy editors honor the saved predicate discriminator; current field configuration guards pending edits even when stored metadata is absent or partial.

## Tests

- [rollup-typed-filters.test.ts](../src/application/database-yjs/__tests__/rollup-typed-filters.test.ts): real Yjs source databases/rows and the production rollup cache, evaluator, and migration functions.
- [rollup-filter-persistence.test.ts](../src/application/database-yjs/__tests__/rollup-filter-persistence.test.ts): nested CRDT updates, metadata preservation, reload encoding, and stale edit rejection.
- [rollup-creation-defaults.test.ts](../src/application/database-yjs/__tests__/rollup-creation-defaults.test.ts): source-list and calculated creation defaults, distinguished from configuration migration.
- [relativeRollupDate.test.tsx](../src/application/database-yjs/hooks/__tests__/relativeRollupDate.test.tsx): midnight refresh and timer cleanup.
- [rollup-controls.test.tsx](../src/components/database/components/filters/__tests__/rollup-controls.test.tsx): real shared controls with isolated database/network dependencies; mode/value persistence, search, date ranges, and read-only behavior.
- [RollupPersonList.test.tsx](../src/components/database/components/cell/rollup/RollupPersonList.test.tsx): people parsing and rendering.
- [rollup-typed-filters.spec.ts](../playwright/e2e/database/rollup-typed-filters.spec.ts): authenticated local databases, related row fixtures, actual filter controls, visible row IDs, advanced editing, and page refresh.
- [rollup-final-parity.spec.ts](../playwright/e2e/database/rollup-final-parity.spec.ts): legacy currency filtering/persistence and live target/calculation changes while an editor is open.

```sh
pnpm type-check
pnpm exec jest --runInBand --no-coverage src/application/database-yjs src/components/database/components/filters src/components/database/components/property/rollup src/components/database/components/cell/rollup
BASE_URL=http://localhost:3000 pnpm exec playwright test playwright/e2e/database/rollup-typed-filters.spec.ts playwright/e2e/database/rollup-final-parity.spec.ts --workers=1
```

The browser cases require the local web app, AppFlowy backend, and test authentication services. They create isolated test accounts and databases. Unit tests exercise interop with desktop-shaped metadata; a live Flutter-to-web session is a separate verification step.

The final local browser fixture used a separate API process on `127.0.0.1:8015`, copied from the cached `AppFlowy-Cloud-Preminum/target/macos-dev/appflowy_cloud` binary and reporting version `0.17.0`. Binary/source equality was not verified. These cases verify web controls, client filtering, and Yjs persistence on that backend; they do not certify the current server release or cross-client compatibility. The separate process avoids interruptions from concurrent restarts of the shared port-8000 server.

The desktop report accounts for original test topics; it explicitly does not claim identical execution coverage. Native CreatedTime/LastEditedTime, URL and Media creation sequences, narrower widget assertions and obsolete wrapper assertions are listed as upstream limitations. The web tests above cover their stated scenarios; this audit does not claim to have replayed every native sequence or run Flutter/Rust CI.

## Validation on 2026-09-12

- TypeScript: `pnpm type-check` passed.
- ESLint on changed source files: no errors.
- Unit/component regression run above: **89 suites, 1,323 tests passed** after the final audit (**60 additional cases**).
- Chromium: **5 cases passed** — desktop and 430px rollup scenarios, legacy currency filtering through simple/advanced editors and reload, live source/calculation changes with pending drafts, and the existing unconfigured Count editor case. All five passed together against the final web source using the isolated local backend.
- The browser run exposed BigInts in server-loaded source metadata. Regression coverage now checks safe schema comparison and migrations that avoid rewriting semantically unchanged metadata.
