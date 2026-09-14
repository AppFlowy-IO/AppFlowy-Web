# Embedded database scope

`embedded` describes persisted database ownership, not whether the current UI is an inline block
or a full-page database. A database owned by a document can be opened full-page while its container
and concrete views remain embedded. A missing persisted flag means `false`.

The folder container, its concrete child views, and their database Y.Doc entries must agree on this
scope. The server rejects a linked view whose requested scope differs from its container. Internal
Y.Doc views marked `is_inline` are canonical row-order state and are distinct from embedded views.

## Confirmed web defects and fixes

### Creating or duplicating a tab from a full-page embedded database

[`useAddDatabaseView`](../src/application/database-yjs/dispatch.ts) previously computed the request's
`embedded` value from `isDocumentBlock`. Opening an embedded database full-page made that UI flag
false, so a new Calendar or duplicated tab could be rejected despite having the correct parent ID.

The request now derives its parent and embedded scope together from saved container metadata. A
standalone container remains non-embedded even when presented inside a document. Legacy linked
leaves without containers retain their document-parent behavior. If the active-child lookup fails,
the known page/container is tried before the existing legacy presentation fallback.

### Creating List, Gallery, or Feed under a document

[`AddPageActions`](../src/components/app/view-actions/AddPageActions.tsx) uses a full-page creation
request for these layouts. The server bootstraps the database through Grid, returning a container
under a space but a concrete embedded Grid child under a document or row document.

The three creation helpers treated every full-page response as a container with exactly one Grid
child. A valid concrete-child response failed that check and entered deletion compensation. Their
container-replacement branch also hardcoded `embedded: false` for the replacement linked view.

[`list-layout.ts`](../src/application/database-yjs/list-layout.ts),
[`gallery-layout.ts`](../src/application/database-yjs/gallery-layout.ts), and
[`feed-layout.ts`](../src/application/database-yjs/feed-layout.ts) now inspect the returned view's
metadata. Concrete Grid leaves use the existing in-place layout conversion; containers use the
existing two-phase replacement with the container's saved embedded scope. A legacy Grid-shaped
container with a concrete child remains a container even if its marker is absent.

The in-place converters retain the view's identity and embedded flag. Failed conversion of a
concrete child only soft-deletes that returned child. If metadata cannot be loaded, compensation
also stays recoverable. Permanent deletion requires recognizing the returned object as a container.

### Showing tabs before the outline loads

[`DatabaseView`](../src/components/app/DatabaseView.tsx) previously rejected an embedded active
view's breadcrumb parent as a container and did not pass the breadcrumb container's child IDs to
the tab selector. Without outline children, the selector's standalone fallback excluded embedded
Y.Doc views, so valid tabs disappeared.

The full-page database now uses the matching breadcrumb container and its concrete child IDs when
outline metadata is unavailable or shallow. A loaded, complete outline remains preferred. The tab
selector continues to exclude unrelated embedded projections and internal `is_inline` state.

## Other paths audited

| Path | Scope behavior |
| --- | --- |
| Tab duplication | [`copyDatabaseViewConfiguration`](../src/application/database-yjs/dispatch.ts) copies an explicit configuration allowlist. It does not overwrite the destination view's identity or embedded scope. Creation goes through the fixed tab-creation boundary. |
| Database block duplication | [`ControlsMenu`](../src/components/editor/components/toolbar/block-controls/ControlsMenu.tsx) sends `embedded: true` for newly linked document views. Deep copies delegate container and backing-state creation to the server. |
| Page/container duplication and published templates | The HTTP duplication APIs delegate Folder/Y.Doc reconstruction to the server; the web client does not reconstruct wrapper extras. Generic Form deep copies are guarded because those server paths do not preserve Form configuration. |
| Row templates and row-document copies | [`row.ts`](../src/application/database-yjs/dispatch/row.ts) and [`DatabaseTemplateButton`](../src/components/database/components/template/DatabaseTemplateButton.tsx) call the server's row-document deep-copy pipeline with source template identity and optional document snapshot. They do not materialize database wrapper flags locally. |
| CSV, Notion, and Confluence imports | [`import-service.ts`](../src/components/app/import/import-service.ts) submits import tasks with the selected parent. Parsing and database/Folder creation are server-owned. No web import path was found that freezes an inconsistent embedded database locally. |
| Clipboard paste | [`withInsertData`](../src/components/editor/plugins/withInsertData.ts) and [`convertSlateFragmentTo`](../src/components/editor/utils/fragment.ts) preserve database/view references in block data. They do not create Folder metadata or rewrite embedded flags. Clipboard identity/ownership behavior is separate from the creation mismatch. |
| Relation targets and reciprocal fields | [`workspace-database-catalog.ts`](../src/application/services/js-services/workspace-database-catalog.ts) can choose an embedded concrete primary view when no non-embedded one exists. [`relation.ts`](../src/application/database-yjs/dispatch/relation.ts) updates field and row orders across database views without using the display-only embedded filter. |

These are source-level audit conclusions. Server-owned duplication and import behavior still
depends on the deployed server implementation; delegating the work does not itself prove every
historical record or import format is consistent.

## Validation

- Initial focused helper regression: 9 failures and 6 passes before the fix. Failures reproduced
  both the concrete-child/container assumption and the server embedded-state rejection.
- Final aggregate: **330 tests passed across 20 distinct suites**, covering creation, duplication,
  imports, row templates, relations, Folder metadata, and tab rendering. This includes 24 tab-hook
  cases, 18 full-page component cases, and 69 List/Gallery/Feed helper cases.
- **Four Chromium browser cases passed** against the local Cloud server: create Calendar from a
  full-page embedded database, and create List/Gallery/Feed through a document's sidebar menu.
  Each checks persisted container, child, and backing-view scope; tabs/layouts remain after reload.
- `pnpm lint` passed, including TypeScript checking and repository ESLint.

Validation used web base commit `56c7c5dc93afb2554832d5557fcff5c3f2e85842` plus these changes.
Logs are `/tmp/appflowy-web-embedded-scope-final-unit.log`,
`/tmp/appflowy-web-embedded-scope-final-lint.log`, and
`/tmp/appflowy-web-embedded-scope-browser.log`. Browser tests used a temporary Vite instance on
localhost port 3100, proxying to the local Cloud instance on port 8000 and GoTrue on port 9999.

The fixes prevent new client-side scope mistakes. They do not rewrite previously rejected
operations, repair inconsistent production metadata, or prove that an older deployed web bundle
already contains these changes.
