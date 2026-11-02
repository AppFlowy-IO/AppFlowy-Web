# Google Drive Embed

Web uses the Flutter `google_drive` document data (`url`, `name`, `email`,
`uploaded_at`, width/height factors, caption and alignment). Optional `file_id`,
MIME type, size and modified time support connected-account metadata. OAuth
credentials and authenticated thumbnail URLs are never persisted in the document.

Design reference: [Web & Google Drive Embed](https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=14963-45081).
The local `assets/icons/google-drive` SVGs come from that frame. Menu masks keep
those assets at their original dimensions inside 20px slots and inherit theme
colors, including the shared destructive hover color.

Browser fixture previews: [light menu](../../../../../../docs/previews/google-drive/menu-light.png)
and [dark menu](../../../../../../docs/previews/google-drive/menu-dark.png). These use
test documents and show the selected fill and alignment submenu near the viewport edge.

Flutter parity sources are `google_drive_block_bloc.dart`,
`google_drive_block_menu.dart`, `google_drive_util.dart` and
`google_drive_block_bloc_test.dart` under the desktop Google Drive plugin.
Account refresh, OAuth completion and account-specific selection cases are
adapted in `GoogleDriveBrowser.test.tsx` and the browser parity cases listed below,
using Web's existing connection/token APIs. Choosing an account opens Google's
Picker SDK (matching Flutter's `google_drive_file_picker.dart` and `picker.html`),
including folder navigation, search, shared drives and file selection. The SDK
loads lazily, uses the chosen connection's access token only in memory, and is
disposed on cancel, unmount or account/workspace changes. Metadata still uses the
server integration proxy. The public picker app ID defaults to Flutter's project;
custom builds can set `APPFLOWY_GOOGLE_DRIVE_PICKER_APP_ID` and the optional
`APPFLOWY_GOOGLE_DRIVE_PICKER_API_KEY` at build time (or via `window.__APP_CONFIG__`).

PDFs and documents always use the full Google viewer, even when metadata includes
a thumbnail. A first-page thumbnail cannot provide document pagination. Only
image files use the scrollable image preview.

Private files use connected Google accounts. Provider sign-in/permissions are
handled by Google; there is no separate AppFlowy password-unlock protocol.
Comment is omitted, matching Flutter's implemented menu and Web's other media
blocks: Web inline comments currently require a text selection.

## Validation

- `pnpm test:e2e:google-drive`: isolated Chromium, light and dark; the HTTP and Google Picker SDK
  boundaries are mocked; no live Google account is accessed. Real Slate/Yjs, dialogs, clipboard, browser tabs and
  fullscreen execute in the browser.
- Jest tests in `__tests__`: URL/data compatibility, source changes and request
  cancellation, selected-account behavior, preview caching and Page conversion
  with undo/redo and collaboration conflicts.
- The existing PDF browser suite covers the shared media AI composer and picker
  geometry. The connected-features suite covers the account browser alongside
  Calendar/transcription.

The Drive cache refreshes on explicit Reload or file reselection, connection/session
changes, or an expired entry requested by a new reader. Focus, screenshot and visibility
changes do not reload mounted previews. Public titles use AppFlowy's own unfurler;
public document contents stay in Google's viewer.

## Flutter test parity audit (2026-11-02)

Audited the Flutter checkout at `338ec2b1e9fe88a05f9a0de4df723b0862ed723b`
(`frontend/appflowy_flutter`), searching both `test` and `integration_test`.
There are 16 relevant cases across the five sources below. The generated mobile
test and its `.feature` describe the same scenario and are counted once.
Dart tests are adapted to observable Web behavior, not copied verbatim.

The Web browser cases live in
[`google-drive.spec.ts`](../../../../../../playwright/e2e/integrations/google-drive.spec.ts).
New audit cases have the `Flutter parity:` prefix and run in both light and dark themes.

| Flutter source / case | Web equivalent or platform adaptation |
| --- | --- |
| `test/bloc_test/lib/features/google_drive/google_drive_block_bloc_test.dart`: empty initialization | Empty picker geometry/focus test and blank-input parity test. |
| Same: blank `refreshUrl` | Blank-input parity test clears the document source through the real editor and verifies the empty state survives reload. Web disables blank form submissions instead of clearing an existing embed accidentally. |
| Same: connect emits OAuth event | First/additional OAuth parity cases open an actual isolated popup and exercise the production cross-origin callback. |
| Same: ordinary account refresh caches accounts | Ordinary-refresh parity case updates the chooser without opening a picker, then explicitly selects the work account. |
| Same: pending OAuth refresh opens picker | First/additional OAuth parity cases hold confirmation pending, then verify the new account's token and persisted file/account metadata. |
| Same: selected account controls picker after OAuth | Account chooser/cancel browser cases verify switching between personal/work accounts; additional OAuth case verifies the newly connected account. Web hides account selection during pending OAuth, so the exact Dart event ordering does not apply. |
| `integration_test/mobile/bdd/document/google_drive_block.feature`: slash insertion, link entry, visible webview | Public embed browser case inserts via `/google`, submits a document link and verifies the iframe. Native anonymous sign-in, mobile shell and `UniversalWebView` plumbing are outside the Web block fixture. |
| `test/widget_test/internal_error_presentation_test.dart`: Drive 403 | 403 parity case verifies access recovery without a generic retry or raw diagnostics, then reselects the file. |
| Same: Drive 404 | 404 parity case verifies the same access-recovery path. |
| Same: Drive 500 | 500 parity case verifies safe error copy, Retry and successful recovery. |
| `test/widget_test/settings_connections_content_test.dart`: pending connection row | OAuth parity cases verify authorizing/confirming status remains visible until confirmation completes. Web uses its shared status/Cancel controls rather than Flutter's pending row/spinner. |
| Same: settled list has no loading indicator | OAuth completion/cancel and ordinary-refresh parity cases assert the chooser has no pending/loading status. |
| `test/bloc_test/settings_integration_test/integration_bloc_test.dart`: preserve existing connections while confirming/refreshing | Additional-account OAuth parity case holds confirmation and verifies both old and new accounts after refresh. |
| Same: pending OAuth timeout | Stalled-authorization parity case advances the browser clock, verifies popup cleanup, preserved accounts and successful retry. |
| Same: confirmation never finishes | Stalled-confirmation parity case leaves the HTTP request unanswered and verifies the real 45-second request timeout, cleanup and retry. |
| Same: passive BLoC must not clear active callback singleton | Native-only singleton/deep-link mechanism. Web uses operation-local popup listeners; `application/integrations/__tests__/oauth.test.ts` and `playwright/e2e/integrations/connections.spec.ts` verify source/origin/state validation, listener cleanup and duplicate callback handling. No Dart singleton is ported. |

The HTTP, consent page, callback page and Google Picker SDK responses are controlled
test fixtures. Real Google OAuth consent, Drive permissions, Google viewer internals
and mobile sign-in are not verified by these tests. Multi-page viewer tests validate
that AppFlowy preserves iframe interaction and state using a deterministic viewer.
