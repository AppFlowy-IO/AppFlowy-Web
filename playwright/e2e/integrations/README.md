# Browser integration tests

## PDF Embed

```sh
pnpm test:e2e:pdf
# Exercise the same two-worker scheduling used by CI:
pnpm test:e2e:pdf --workers=2
```

The PDF suite runs the production editor and PDF.js worker in isolated browser
contexts, with a separate Vite server per worker. On macOS the PDF config requires
the dedicated Chrome for Testing executable; it never attaches to an existing
browser or personal profile. No Cloud account is required.

Both light and dark projects cover upload and replacement, drag-and-drop ordering,
captions, resizing, selection, menus and hover colors, filename mentions,
fullscreen/browser previews, password challenges, AI actions, permission changes,
upload limits, and persistence. CORS fallback tests verify request counts, retained
original URLs, password retries without refetching, and invalid-file handling.
Replacing an in-flight source verifies cancellation before accepting the new PDF.

PDF files, uploads, and AI responses are controlled fixtures. These tests exercise
the real browser UI and parsing, but do not validate Cloud storage or a live public
host. Server-side proxy policy and streaming have separate unit tests under
`api/_lib/__tests__`.

CI runs the two theme projects concurrently and retains screenshots and failure
traces in `pdf-browser-results`. Its job timeout includes browser installation
and artifact upload as well as test execution.

## Drive and Calendar

Run from the web repository; no running Cloud, Google credentials, or shared test account is required:

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e:integrations --workers=1
```

For a visible connection flow:

```sh
pnpm test:e2e:integrations --project=chromium --headed --grep 'google-drive: consent'
```

`connections.spec.ts` runs the production Connections panel, hooks, HTTP client and OAuth helper in Chromium, Firefox and WebKit. Each test gets an isolated browser context and network fixture. It clicks Connect, navigates a real popup through a simulated consent page, and executes Cloud's callback HTML on a different origin. The fixture rejects unexpected API requests and external traffic. CSP bypass is disabled. As in the web repository's server configuration, the fixture does not add a Cross-Origin-Opener-Policy (COOP) header.

Covered cases:

- Drive and Calendar authorization, one confirmation, account lookup and reload.
- Denial, popup close, Cancel, panel unmount, timeout and subsequent retry.
- Popup-blocked guidance and connection-start network failure.
- Actual cross-origin messages with incorrect origin, source window or state; duplicate callbacks.
- Failed account loading and confirmation, with recovery.
- Provider availability changes after Refresh.
- Multiple accounts, disconnect confirmation/cancellation, failure preservation and targeted removal.

The popup-blocked case overrides `window.open` to return `null`; it checks the UI response rather than a particular browser's popup-blocker policy. Timeout uses Playwright's clock. Other popup cases use real windows and `postMessage`, without synthetic `MessageEvent` objects or arbitrary sleeps.

`connected-features.spec.ts` runs in Chromium and covers Drive account switching/search, Calendar reminders, private meeting notes and microphone transcription. Provider responses and the transcription websocket are controlled; Chromium captures generated audio through the actual Web Audio path.

GitHub Actions runs this suite in the standalone **Connections (Chromium, Firefox, WebKit)** job, with no Cloud container dependency. It typechecks the tests and retains failure screenshots and retry traces.

Cloud requests may include query parameters. Match endpoint paths
with `new URL(request.url()).pathname`, and inspect meaningful query values through `searchParams`
instead of depending on parameter order. Route globs ending at an endpoint need an optional query
suffix, for example `**/api/integrations/connect/google-drive{,?**}`. Keep method, body, request-count,
and origin assertions intact.

## Callback fixture provenance

`playwright/support/fixtures/oauth_callback.html` is an unmodified copy of:

- Repository: AppFlowy Cloud Premium (`AppFlowy-Cloud-Preminum` locally).
- Path: `libs/appflowy-cloud-integrations/assets/oauth_callback.html`.
- Last source change: `419aee513490674352966c8c1698394a8ed4fafd`.
- SHA-256: `09b119194dda1c56cc774eb5d4cb8b8fd6d3f52e50ece8e487c7d7d262563645`.

Keep the copy and provenance updated when Cloud's callback protocol changes. To check a new Cloud callback before updating the pinned copy:

```sh
APPFLOWY_OAUTH_CALLBACK_HTML=/absolute/path/to/cloud/libs/appflowy-cloud-integrations/assets/oauth_callback.html \
  pnpm test:e2e:integrations --workers=1
```

## What still needs a deployed-stack test

Cloud API responses and persistence are simulated here. These tests do not validate Cloud's authorization-code exchange, database authorization, refresh-token rotation/revocation, multi-replica coordination, or Google scopes and consent configuration. Run those through Cloud's service-backed tests and a separate Google test project/account smoke test. The local Vite app also does not reproduce deployed HTTPS, CORS and proxy/security headers; check the deployed popup flow when those settings change.

During development, adding `COOP: same-origin-allow-popups` to the fixture severed `window.opener` in Firefox when the initial `about:blank` popup finished loading before navigation to the provider. The same flow worked without that extra header. Do not assume a COOP configuration is compatible with this asynchronous popup flow without testing the deployed headers.

This is the browser regression layer of the [Playwright API-mocking approach](https://playwright.dev/docs/mock), not a claim of live Google end-to-end coverage.
