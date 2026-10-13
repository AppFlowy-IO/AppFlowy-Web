# Web/server compatibility

The authenticated web app shows a dismissible warning when the loaded web bundle
or its AppFlowy-Cloud server is below the other's minimum supported version.
The warning leaves navigation and editing available.

Web has its own release line. `package.json` currently uses a placeholder version;
the compatibility version is embedded by Vite from `APPFLOWY_WEB_VERSION`, falling
back to the reviewed version in
`src/application/compatibility/web-server-compatibility.json` for source builds.
Both Docker builds pass their `VERSION` build argument to Vite. Runtime endpoint
configuration cannot change the version of a bundle already loaded by a browser.

Server-info requests send that embedded version in `Client-Version` alongside
`X-Platform: web`. The server uses it to advertise version-dependent capabilities,
including database history for web `0.18.6` or later. The UI follows the returned
`enable_database_history` flag; it does not infer availability from the version alone.

The policy is maintained by hand and never blocks a build. When a web release
needs a newer AppFlowy-Cloud, add a row with the release's `client_from` and the
new `min_server`. A build whose version is newer than
`reviewed_through_client_version` uses the last row, so leaving the file
untouched means the current requirements still apply. Advance
`reviewed_through_client_version` when you review the table for a release; it is
also the version source builds report. The initial policy requires server 0.18.1
for web 0.17.1. Web 0.18.2 or later requires server 0.18.10. The old-server banner
shows the required version and warns that some features may be unavailable.
Web versions that cannot be parsed do not produce old-server warnings. There is
no appcast or native update gate on web.

`GET /api/server-info`, with `x-platform: web`, must expose:

```json
{
  "version": "0.18.1",
  "min_web_client_version": "0.0.0"
}
```

The server controls the optional web floor with `APPFLOWY_MIN_WEB_CLIENT_VERSION`.
Unset/invalid settings default to 0.0.0; desktop's `APPFLOWY_MIN_CLIENT_VERSION`
does not apply to web. The web client ignores floors above its compiled 0.20.0
cap. These fields are advisory, with no server request rejection.

The existing server-info request refreshes every five minutes, revalidates on
focus/visibility/online after 30 seconds, retries transient failures with bounded
backoff, and cancels on account/server changes. Failed or missing metadata hides
the warning. When an older server omits the version from the web response, the
same API helper also requests the existing native projection and copies only its
version. Web feature flags and native minimum-client requirements stay separate.
If that fallback also fails or lacks a parseable version, no old-server warning
is shown.

Dismissal is held in the account provider's memory. It survives page navigation,
responsive layout changes and temporary outages. Changing the requirement,
server, or whether a client upgrade can help resets dismissal; a confirmed
compatible response clears it. Reloading the tab starts a new session. An old
web client offers a reload action; contradictory requirements ask the
administrator to update both components.

## Workspace permission controls

Space creation uses the authenticated
`GET /api/workspace/{workspace_id}/space-creation-capabilities` response. Support, effective permission,
configuration authority, and group entitlement are separate fields. An unavailable endpoint, unknown
policy, mismatched workspace, or incomplete response leaves creation unavailable. The current workspace
role alone does not authorize it. No release-version floor has been assigned to these new controls yet.

Settings / Workspace permissions uses the existing settings API's `space_creation_policy` field and
checks that the response confirms the requested mode. User/group selections use focused UUID grant/revoke
endpoints and separately paginated rosters; inactive selections remain visible. Member pickers require
the optional `user_uuid` supplied by current servers. Numeric UIDs are not converted to grant identities.
Guests, pending invitations and entries without a UUID cannot be selected.

Workspace permission notification tag 14 carries an explicit workspace UUID and decimal-string epoch
and counter. Generated protobuf bindings and HTTP validation preserve signed 64-bit values exactly.
The notification hook scopes its last revision by server, account and workspace, ignores duplicate/older
hints, and drops retained messages across a context switch. Hints re-probe current authority; they never
grant access or delete pending edits. Capability reads also refresh on reconnect, online, focus and
visibility changes, and discard responses that precede an observed revision.
The space-creation capability and group-coverage directory each use `createCoalescedRefresh` to
allow one active read and one replaceable pending refresh per mounted scope. Every hint invalidates
the displayed authority immediately, before queueing. A superseded response cannot enable a control;
unmounting also prevents a queued read from starting. Waiting for an active read bounds concurrency,
not latency, and the group directory response itself is still unpaginated. Group drafts survive a
same-scope refresh but do not confer permission to save.

Open search results, previews, AI summaries and recent-page names also have a server/account/workspace
permission scope. A hard invalidation hides the old snapshot synchronously, before fresh requests
finish: an object or broad permission hint, a share hint, sign-in or sign-out, or a different account
or GoTrue session, also from another tab. A routine token refresh keeps the same `session_id` and so
keeps the scope; tokens without that claim count as a new session. Late keyword, pagination, metadata
and summary responses cannot restore an invalidated snapshot, and the unchanged query runs again after
the normal debounce. Window focus, tab visibility and connectivity changes invalidate nothing. When the
realtime socket reopens after a disconnect (hints may have been missed), Best matches reloads the shown
query with every loaded page and the AI summary in the background and swaps them together, and recent
pages revalidate the same way; a failed revalidation keeps the current results. Offline, Best matches
and recent pages say so instead of showing empty results and Ask AI is disabled with that reason. A
read skipped offline or lost to the dropped connection runs again once the browser is back online;
while the browser stays online, a failed read is not retried on its own. These are UI lifetime checks;
Search and page APIs still enforce current server authorization.
Keyword, summary and metadata requests receive a caller-owned cancellation signal; these metadata
reads do not join or populate shared view-cache requests. Recent pages are read directly from
`GET /api/workspace/{workspace_id}/recent`, because the app-wide loader cannot tell a failure from a
request that another reader replaced. Loading, offline, failed (with "Try again") and empty ("No
recent pages yet.") are distinct. A loaded list belongs to one dialog opening within one scope, so
clearing the query shows it again without a request; after a hard invalidation a failed refresh keeps
the old names hidden. Recent-page refresh keeps one active read and one replaceable follow-up, and
only starts while recent pages are displayed. Until Ask AI sends its create request, closing the dialog
or a permission or session change cancels the attempt (a permission change asks the user to try
again). Once the chat page exists the attempt finishes: after a permission hint the parent is read
again and only sources inside the fresh, permission-filtered tree are attached; if the dialog was
closed meanwhile, a toast offers to open the chat; only a session, account, workspace or server change
stops it silently. Ask AI stays busy for the whole attempt, so one request cannot create two chats.

Mention suggestions reuse that permission/session scope. The cache lifetime follows the scope: within
one scope a reopened picker shows its cached suggestions at once and revalidates them, while a
permission or session change (also while the picker is closed) or a remount starts empty, so an
earlier account/workspace/server snapshot is never reused. The shared cache retains at most 50
entries, and a retired scope frees its entries. Scope changes hide results and prevent selection
immediately; a late request cannot fill the replacement scope. Authenticated `loadViews` fallback
suggestions also reload under that scope, while anonymous published-page fallback remains available.
`RetryLater` discards cached and displayed suggestions even before a permission hint arrives,
including when only the parallel row request fails: for a typed query the server returns it only when
permissions changed or are being updated, and a parallel response may predate that change. The picker
says "Refreshing suggestions…" and searches again after the server's cooldown. A per-key read token
prevents an older success from undoing that invalidation. A socket reconnect refreshes suggestions in
the background, and a dropped connection or server error during a refresh keeps them on screen. A page
created from the picker is the user's own: it is linked when the same picker opening is still active
and the editor is editable, otherwise a toast offers to open it, and after a session change nothing is
shown. A refused creation shows one plain message. Existing request debounce and cooldowns remain;
these lifetime checks do not cancel the underlying mention HTTP requests or replace server authorization.

Create/Manage Space expose the existing `sidebar_edit_policy`. Direct space-child actions require both
canonical content Write and sidebar permission. Ordinary nested pages retain their own Write check.
Changing this setting does not grant B (space creation) or D (workspace creation). Create Space keeps
useful draft fields after a denied final check, while possibly committed retries retain their original
identity. The full background-writer, destination-operation, offline re-grant and native-client acceptance
matrix remains in progress in the Server repository's Oodrive plan.

The opt-in `playwright.permissions.config.ts` suite uses the passed Server
`group_permission_lifecycle.py` document fixture. It checks real open editor bodies, title controls,
Slate editability, canonical Folder plus Shared with me navigation and a second tab across group View/Edit/revoke and
membership removal/re-addition. Independent direct and second-group grants are controls; a readable
child can retain its containing space as an ancestor. The stale-response case holds an actual fresh
allowed capability response across a newer server revocation and requires completed browser delivery;
a cancelled response does not establish that an old response was consumed safely. Notifications are
observed passively and never synthesized. This fixture has no database/grid/row coverage.
After restoring View, the owner captures the actual group override and reads workspace creation and
group coverage settings without changing them. These settings screenshots show the canonical current
configuration; they do not establish a creation or coverage mutation. The journal records the Web
source manifest and requires it to remain unchanged through preservation checks.

Run its offline transport/identity guards with
`pnpm exec playwright test -c playwright.permissions.config.ts --grep @offline`.
The connected case skips unless `APPFLOWY_GROUP_PERMISSION_RUNTIME_DIR` is supplied. It also requires
`APPFLOWY_GROUP_PERMISSION_CLOUD_PROOF`, `APPFLOWY_GROUP_PERMISSION_WORKER_PROOF`, and `BASE_URL` matching
the private runtime. Optional `APPFLOWY_TEST_PYTHON` selects the Python environment with psycopg;
`APPFLOWY_TEST_CHROMIUM_EXECUTABLE` selects an installed browser. The read-only preflight binds current
processes/source to the passed Server run and verifies restored owned state before authenticating the
two existing actors. Each attempt journals mutations before sending, restores the exact starting grant
and membership, and checks original content/config/roster rows and owned document bytes afterward.
Original Server evidence is immutable. No user, workspace or document is created by this Web suite;
AI traffic and unrelated browser writes are excluded, traces/video are disabled, and evidence consists
of screenshots plus a separate private journal and sanitized result. The preservation comparison
retains raw protected rows and permits only three observed timestamps inside the server-managed
`search_admission_health` value (`last_checked_at`, `last_healthy_at`, `next_check_at`) plus that
row's `updated_at`; every policy value, admission state, lease, other configuration field and membership
timestamp remains strict. The owning Cloud monitor in `libs/database/src/search_health.rs` updates
those observations every ten seconds; its row hashes are recorded separately. These tests require an exclusive
released fixture; compiling or listing them is not connected UI verification.

The older stg0822 BDD fixture now represents inheritance explicitly with
`access_level_override: null`; explicit View/Edit overrides remain independent of the collective
Custom Member default. Its teardown restores each scenario's exact prior role, override, default and
seeded memberships instead of imposing a hardcoded baseline. It requires a server returning the
tri-state assignment DTO and refuses a lossy restore when that field is absent.

After a reviewed server rebuild, the original fixture result and journal remain unchanged. The
read-only guard accepts a separate `identity_state_requalification` record only with matching
`APPFLOWY_GROUP_PERMISSION_REQUALIFICATION` and
`APPFLOWY_GROUP_PERMISSION_REQUALIFICATION_SHA256` inputs. Its generator uses JSON stdin with
`action: "requalify"`, current and original Cloud/Worker proof paths, a preserved raw baseline
snapshot, an exact reviewed list of changed native-source paths, and a new private output path.
It validates current process/binary/environment/source proofs before reading actor credentials,
then performs only PostgreSQL SELECTs. It rechecks fixture identities, the restored View grant,
Member roles/memberships, None defaults, independent Edit grants, document bytes and protected rows.
The record binds original evidence hashes and the exact source delta; it explicitly does not claim
that the original server lifecycle cases ran again. Unknown source changes, modified proof bytes,
missing checks, or an altered fixture fail closed. The generator never overwrites an output file.
Each completed SELECT snapshot is also retained as a separate private, explicitly unqualified
observation before preservation checks, so a rejected lease or policy change retains its raw evidence.
Run its offline regressions with
`PYTHONDONTWRITEBYTECODE=1 python3 playwright/support/test_space_group_permission_guard.py`.
