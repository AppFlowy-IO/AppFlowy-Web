# Live presentation BDD

This opt-in scenario uses an existing local test account and paid shared workspace. It creates
a clearly named source document through the editor, generates thirteen slides, reloads and reopens
the saved artifact and scene, edits and regenerates its story and scene, and downloads native
PowerPoint. Every slide must contain editable text shapes, and the edited title must appear in the
saved story, fetched scene, rendered canvas and exported first slide. Cloud source resolution must
return the created page and a known content marker; reload alone could use browser IndexedDB.
The document and saved artifacts remain available for review. It does not invite users or change
billing state.

## Live status — 2026-10-29

**Passed against the real local Web, Gateway, Cloud and AI services.** The UI-created source
resolved to 15 blocks and the expected marker. Custom 13 generated exactly thirteen slides;
reloading and reopening from Share preserved the artifact version and scene hash without another
generation. Editing the first story title regenerated the same artifact as version 2. The saved
story, fetched scene, rendered preview and downloaded PowerPoint all retained that edit. The
PowerPoint contained thirteen slides with native editable text. The paid workspace's Free slide
and export counters and pending reservations remained unchanged.

The verified chain was **Web `3000` → Gateway `8100` → Cloud `8000` → AI service `5001`**.
The safe [current result](./result-2026-10-29.json) records completed checks and usage counts,
without local identities, credentials, provider bodies or source text. This run also reproduced
and corrected Cloud accepting fewer slides than a custom request; fixed counts now bind the
compiled schema and are validated before publication. Catalog selection uses the artifact ID
because independently generated decks can have identical titles. Ensure the running Vite process
serves current modules after local changes; restarting it cleared stale transformed code in this run.

The [2026-10-28 attempt](./result-2026-10-28.json) remains historical evidence of the earlier
provider-quota block. It is superseded by this passing run. This scenario does not establish all
source/media combinations, deployment readiness or Office pixel parity.

Start and verify the real Web, Gateway, Cloud, auth, AI provider and storage services separately.
The test never starts services, seeds records, mocks HTTP, overrides runtime configuration, injects
browser storage or retrieves bearer tokens. Direct HTTP is limited to unauthenticated Gateway
health; presentation requests come from UI actions. Generation invokes the configured real provider.

Set these variables only after confirming the running environment:

- `PRESENTATION_LIVE_WEB_ORIGIN`: frontend loopback origin.
- `PRESENTATION_LIVE_GATEWAY_ORIGIN`: Gateway loopback origin.
- `APPFLOWY_DEV_API_PROXY_TARGET`: the same Gateway origin used to launch Vite.
- `PRESENTATION_LIVE_WORKSPACE_ID` and `PRESENTATION_LIVE_WORKSPACE_NAME`: exact existing paid workspace.
- `PRESENTATION_LIVE_EMAIL`: the existing test account email.
- `PRESENTATION_LIVE_PASSWORD`: the test account password, supplied privately.

With provider quota available and the real services healthy, confirm the
environment above and rerun from this worktree. Supply the password privately; do not put its value
in a shell command or report:

```sh
pnpm exec bddgen -c playwright.presentation-live.config.ts
pnpm exec playwright test -c playwright.presentation-live.config.ts
```

The isolated configuration uses one worker, no retry, and disables screenshots, video, traces and
automatic failure page snapshots. It rejects `DEBUG` logging. No credentials belong in source,
command history or test reports. The report attaches only allowlisted paths, HTTP results, job and
artifact IDs, versions, slide counts and usage counters.

The browser must use the verified same-origin `/api` proxy. The suite checks the declared proxy
target and the real Gateway health endpoint. Its observed job/artifact IDs can be correlated with
Gateway/Cloud server logs or read-only ledger queries to establish the forwarding chain; the browser
alone cannot observe Vite's upstream socket. It asserts paid Free slide/export counters are unchanged,
without treating a paid subscription as an unlimited shared AI-response allowance.

These tests are outside the normal BDD globs and have no fixture-server dependency. Use the separate
`playwright.presentation.config.ts` for the retained component-only presentation browser tests.

## Existing LLM demo regressions

**Passed on 2026-10-30: four scenarios in 44.5 seconds against the real local services.**
The [recorded result](./result-2026-10-30-llm-regressions.json) contains only checks and counts.

`llm-regressions.feature` reuses the **LLM Iteration Lab** page created in the local Pro workspace.
Set `PRESENTATION_LIVE_LLM_PAGE_ID` to that page's UUID, in addition to the environment above, and
run with `--grep 'LLM demo'`. The fixture must already have its saved six-slide deck, saved AI map,
two PNG images, and the embedded LLM Experiments database with the v4 Hard examples row.

The scenarios cover reopening without generation or session writes, readable database citations
and row navigation, a single preview dialog without the technical source-version footer, stable
regeneration settings without repeating assessment when slide count changes, nonempty document
slides with their database, and downloaded PPTX image proportions/centering against the exact
preview scene. They use UI actions and observe real responses; no provider responses are mocked.
Changing slide counts restores the six-slide selection; exporting creates a disposable download
but does not regenerate the deck. Existing imported-template and paid-generation scenarios cover
upload/AI theme analysis, saved template reuse, regeneration, and usage accounting separately.


## Imported template scenario

**Passed on 2026-10-29 against the real local Web → Gateway → Cloud → AI stack (26.4 seconds).**

`imported-template.feature` uploads the synthetic `fixtures/brand-template.pptx`, waits for the
real AI theme analysis, reviews and names it, then selects it on another UI-created page. Reloading
that page must restore the same version with its palette and analysis intact. The scenario asserts
one upload, one AI analysis and one review across the entire flow. Run it independently with
`--grep 'saved imported template'` using the same verified environment above. No provider response
is mocked; configured AI availability is required.

The fixture has two explicit layouts, an Arial typeface and a teal `#1F7A8C` accent. Regenerate it
with `python fixtures/create_brand_template.py` from this directory in an environment containing
`python-pptx==1.0.2`. The fixture contains only synthetic reference text. The test checks parsed tokens,
visible AI interpretation, durable review and reuse; it does not assert pixel fidelity for
arbitrary third-party decks.
