# Live presentation BDD

This opt-in scenario uses an existing local test account and paid shared workspace. It creates
a clearly named source document through the editor, generates thirteen slides, reloads and reopens
the saved artifact and scene, edits and regenerates its story and scene, and downloads native
PowerPoint. Every slide must contain editable text shapes, and the edited title must appear in the
saved story, fetched scene, rendered canvas and exported first slide. Cloud source resolution must
return the created page and a known content marker; reload alone could use browser IndexedDB.
The document and saved artifacts remain available for review. It does not invite users or change
billing state.

## Live status — 2026-10-28

**Blocked by external provider quota; the live suite has not passed.** Attempt 4 used an
existing test account and an existing Pro shared workspace. Actual password login,
workspace selection, editor document creation and reload, Cloud source resolution, paid status,
session reads/writes, and custom-count selection succeeded. The source API returned the correct
page and revision, 15 blocks, and the known content marker.

The verified request chain was **Web `5182` → Gateway `8100` → Cloud `8000` → AI service `5001`**.
Browser observations were correlated with the configured proxy, Gateway forwarding log and server
diagnostic. Source assessment reached OpenAI, which returned HTTP `429`, type `insufficient_quota`,
with the original provider classification `retryable: false`. The browser received HTTP `503`, code
`1032`, reason `AI_EXECUTION_FAILED`. The read-only ledger check and a further 35-second observation
found no presentation jobs, presentation usage operations or quota debits.

Generation, saved-deck reopen, story/scene regeneration, editable PPTX download and post-workflow
Free-allowance assertions are implemented but **were not executed** because assessment failed first.
The safe, durable [attempt 4 result](./result-2026-10-28.json) records the observed paths, counts,
and failure classification. Local account, workspace and document identifiers are omitted from the checked-in report.
It contains no credentials, provider body or source text. Static TypeScript validation and BDD
generation passed; those checks do not establish live generation success.

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

After the configured provider has available quota and the real services are healthy, confirm the
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
