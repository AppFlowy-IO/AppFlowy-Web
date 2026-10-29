# Presentation features for AppFlowy Web

This feature provides **Present document**, **Present AI mind map**, and **AI Slides** in the signed-in app. Document presentation uses a read-only editor snapshot; AI operations use authenticated AppFlowy Cloud presentation APIs.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5182 --strictPort
```

Use the app's normal server configuration and sign in at `/app`. The configured Cloud deployment must provide the presentation endpoints. This worktree does not start a model provider, mock backend, Cloud proxy, or unauthenticated presentation lab.

- **Present** beside Share opens document presentation, mind maps, or AI Slides.
- **Share → AI Slides** lists up to 30 authorized workspace presentations. This is a workspace catalog, not a current-page list. The list is reused for a minute per user; Retry, or closing an AI presentation dialog, lists it again.
- **Settings → AI Settings → Presentation Styles** manages uploaded templates and their reviewed versions.
- Prompt maintenance is a separate administrative screen. The server checks administrator access; normal generation never sends a system prompt or provider configuration from the browser.

## Server integration

[`server-client.ts`](./server-client.ts) uses the application's Axios instance, runtime server URL, token refresh, and signed-in session fencing. [`server-contract.ts`](./server-contract.ts) contains the wire DTOs. [`server-adapter.ts`](./server-adapter.ts) projects those DTOs into UI state. [`presentation-client.ts`](./presentation-client.ts) coordinates job polling, cancellation and artifact loading through those APIs.

All business calls are under `/api/presentation/{workspace_id}`:

| Operation | Server contract |
| --- | --- |
| Access, themes, reservations, remaining quota | `GET /status` |
| Resolve current evidence and assess slides | `POST /sources`, `POST /slides/assess` |
| Find an unchanged saved result | `POST /reusable` |
| Generate, poll, cancel | `POST /generate`, `GET /jobs/{id}`, `DELETE /jobs/{id}` |
| Read saved decks, maps, styles and versions | Catalog and `/artifacts/{id}` routes |
| Persist selected artifact/options | `GET /session`, revision-checked `PUT /session` |
| Deterministic map, map edits and explicit imports | `/map/structure`, `/map/{id}`, `/map/import` |
| Upload/review a PowerPoint template | Binary `POST /template`, version-checked `PUT /styles/{id}/review` |
| Saved slide rendering/private images | `/artifacts/{id}/scene` and `/assets/{asset_id}` |
| Export an immutable deck version | `POST /download`, job polling, binary `/exports/{id}/download` |

Generation submits source IDs, native revision fences, options, and immutable artifact/style references. It does not submit client roles, plan scenarios, usage counters, raw editor contents, or provider credentials. Generated artifacts are already saved by Cloud and are never reimported to simulate saving. Technical retries reuse their operation identity; new requests get a new identity. Cancellation attempts to cancel the durable server job.

Before assessment, the studio checks for a successful result with the same source and generation
settings. A match shows **Open presentation** or **Open mind map**, skips assessment and opens the
saved artifact without a new generation request. Any generation-setting change removes the match
immediately; late network replies cannot restore Open for obsolete inputs. Open revalidates, and a
miss never silently submits paid generation. Explicit deck regeneration still requests fresh work.

The server owns slide/export quotas, AI accounting, source permissions and deployment policy. The UI uses returned maximum and remaining slide counts; it does not reconstruct quotas from a plan label or historical usage. Preset/custom choices retain their explicit request mode. Export, custom-count and map-style admission are decided by the API. Unknown or unavailable AI accounting does not become an unlimited allowance. Error reason, retryability, quota details and retry delay survive transport decoding.

[`ServerSlideCanvas.tsx`](./ServerSlideCanvas.tsx) renders the saved server scene used by native PowerPoint export. All thumbnails share one scene load and deduplicated, bounded private image reads; a deck read with its scene reuses that scene and fetches only its images. Slides render before their images, and an image that cannot be shown is marked unavailable without hiding the deck. Images use authenticated Blob requests with workspace, artifact version and asset revision. Object URLs are revoked on replacement/unmount. Source changes or permission failures do not fall back to fixture generation.

## Editing and compatibility

Story-plan editing preserves the saved artifact version and source revision. Accepting an unchanged initial outline opens the already-generated artifact. Applying a changed outline regenerates through Cloud. Map text and appearance edits use expected-version checks; rejected writes retain the accepted content. The root map label remains the approved source title. Structural maps also come from Cloud: loading, failure and retry states never synthesize a replacement map in the browser.

Canonical source references resolve through the server evidence envelope. A historical deck/map whose source envelope cannot be proven to match the open page remains viewable but cannot silently reuse that page's citations or regeneration evidence. The current artifact catalog does not expose a saved source-page filter or full historical evidence envelope.

Template uploads produce candidates requiring explicit review. Review preserves the imported template geometry, assets and mandatory footer, then saves a new server version. Arbitrary browser-created company styles, logo uploads and workspace-default style changes have no matching server API and are not presented as persisted operations.

Explicit map/deck JSON imports are available through the typed API adapter. Ordinary generation and the separate administrator prompt tests use the server workflows above. Prompt compilation, provider calls, output validation and native exports are implemented only on the server; the prototype implementation and historical prompt copies have been removed from Web.

The non-AI document presenter retains measured pagination, tables, row properties, code/Mermaid, equations, callouts, meeting summaries, covers, linked databases, source navigation and fullscreen controls. It reuses the current main branch's secure Mermaid renderer and editor behavior.

Present document borrows live resources from the page's mounted database view through
`database/mounted-database.ts`: the same Y.Doc, row map and loading functions, with separate
presentation controls and row-order publication. It does not mount a second row-prefetch/sync
lifecycle. The borrower remains read-only and checks current access. Owners unregister on unmount;
a missing owner falls back to the normal cached loader. Resources are isolated by workspace, view,
database mapping and login session, and restored documents replace old resources. Published and
historical snapshots never enter this live registry.

## Validation

- Presentation Jest suites cover source transformations, layout, authenticated request contracts, version/idempotency handling, errors, access refresh, scene rendering and workflow rules.
- `playwright.presentation.config.ts` runs document and mind-map UI fixtures through an isolated test-only harness on port 5183; fixture code is not an application route or a generation fallback. It never reuses the live application server.
- `pnpm type-check` and `pnpm build` validate integration with the main Web application.

Mocked HTTP contract tests do not prove a deployed provider's output quality or a live account's entitlement behavior. Live generation/export should be exercised against a Cloud deployment containing the presentation feature with an authorized workspace.

The 2026-10-29 Chrome run verified Open/Generate switching and reading the existing 13-slide deck
without generation. Delivery Control Room's two database slides made zero additional blob or
collab-content reads after the page loaded; current permission/metadata/trash checks still ran.
Regression coverage includes the full source/settings reuse matrix on Cloud, the Web Open path,
late probes, quota-independent opening, mounted-resource reuse and live restore/session boundaries.
