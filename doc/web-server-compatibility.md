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

Object permission reads use same-turn batching only when the available Web server-info snapshot
advertises `enable_object_permission_batch: true`. Missing, false or unavailable metadata retains
the existing individual GET requests. The flag promises batch parity for legacy row-document
repair and numeric per-item `error_code` values; errors are normalized through the existing API
error path, including optional `retry_after_secs` guidance. The client does not parse error text.

The batch coordinator groups distinct objects by login lifetime, requester and workspace, with
at most 200 objects per request, four HTTP requests in flight and 2,000 queued objects. A singleton
keeps conditional GET. Queued requests invalidated before dispatch are discarded; the owning
permission-request layer rechecks both successful and failed responses after reconnect, sharing
changes or account transitions and retains its existing single bounded invalidation retry.
Batch responses must preserve object/type/order and valid capability fields before any result is
accepted. No successful permission result receives a new client cache TTL.
Read-only POST batches retain the GET transport retry count (three retries) through the shared
retry helper, including HTTP `Retry-After` guidance. Retries keep their scheduler slot and check
the session and invalidation state before sending. Application-level errors inside successful
HTTP responses keep their existing caller-owned recovery behavior and normalized retry metadata.
During rollout, update the server fleet before shipping Web batching so every routed server
fulfills the capability advertised by server-info.

## Progressive global search

Global search first requests `GET /api/search/{workspace_id}/stream` with bearer authentication
and a per-dialog `x-request-stream-id`. AI-enabled workspaces use hybrid retrieval; other workspaces
use keyword retrieval. SSE keyword snapshots appear while semantic retrieval continues. Each final
snapshot replaces the ranked list; keyboard selection follows a retained result's stable target ID.
The client validates query identity, event sequence, framing, workspace identity, completion and EOF,
with a 30-second deadline and bounded response size. Changing query/workspace or closing the dialog
aborts the request immediately, including during the next query's debounce interval.

Only an unsupported route (404/405/501 without an application error), or missing browser streaming
support, activates the existing paged keyword API. Authentication, rate limits, timeouts, malformed
streams and interruptions do not trigger a second search. Shared authentication recovery may refresh
once before any streamed result. The stream itself has no transport retry.

After validated completion, the overview requests authorized content for final result IDs using
`only_context: true` and `retrieval_mode: "provided_only"`; it does not repeat vector retrieval.
The older-server fallback retains its existing automatic context retrieval. Empty or superseded
streamed searches do not request an overview. A degraded final snapshot remains usable.

The stream has no pagination cursor. A full keyword preview or full final window enables lazy
"Load more", beginning at keyword offset zero to avoid skipping keyword hits displaced by semantic
results. Subsequent pages follow the server's cursor and deduplicate by object/row identity. A full
window is only an indication that another page might exist; the first page response determines the
actual continuation. This compatibility path leaves the minimum supported server version unchanged.


Search presentation timing is reported separately from server enqueue metrics. The monotonic
origin is the latest query input (including the 300 ms debounce and lazy component loading);
a workspace or retrieval-mode switch starts a new origin. `first_result_visible_ms` waits for
nonempty routable rows to commit and two frames in a visible document, an estimate of a paint
opportunity. `all_results_received_ms` waits for validated SSE EOF or the legacy initial page.
`final_results_visible_ms` waits for final metadata to settle and the final state to commit with
a visible-document paint opportunity. The initial ranked window includes an empty final state;
later pagination and AI overview work are excluded. Starting “Load more” finalizes the initial
window report with known completion/paint milestones and cancels any pending initial paints, so
appended rows cannot become its first visible result.

One best-effort timing report goes to `POST /api/search/{workspace_id}/stream/metrics`, independently
of the search cancellation signal. It has a three-second timeout, no retry/auth recovery and no
user-facing error. The observer records no query text or resource/user IDs, omits unavailable or
out-of-window milestones, and disposes after 120 seconds. Hidden tabs and tab closure can lose
samples. Older servers may lack the collector; that does not change search behavior. Cloud exposes
these reports as `cloud_search_client_milestone_seconds` and `cloud_search_client_reports_total`,
with fixed mode/transport/outcome/milestone labels. The Search dashboard distinguishes these
client-reported timings and their sample counts from Search/Cloud server-side measurements.

## Mention picker session reports

Each opening of the mention picker by typing `@`, `+` or `[[` is one session. When the picker
inserts an item or closes, also when the editor unmounts, it sends one best-effort report to
`POST /api/workspace/{workspace_id}/mentions/metrics` (`mention-presentation-metrics.ts`, Cloud
`MentionPickerSessionReport`). It sends only while the web server-info snapshot lists
`session_metrics_v1` in `mention_features`. Older servers, self-hosted servers that leave the
feature off, loading or failed server-info, and pages without the auth layer get nothing. A 404
from the route (a server that advertises the feature without the route, as after a rollback) stops
reports for the rest of the tab. A picker opened from a menu (the slash menu's "Link to page" or
"Date or reminder") is not reported, because Cloud's trigger labels are `at`, `plus` and
`page_link` only.

- `outcome`: `selected` when an item or a created page was inserted; `error` when the picker
  closed while it showed a failure (unavailable, offline or busy) and no result; else `dismissed`.
- `query_len`: code points typed after the trigger; Cloud counts a bucket.
- `selected_rank`: the 1-based position among the result options on screen, across sections.
  "N more", Retry and "Create" rows hold none, and an expanded section ranks what it reveals. A
  created page has no rank, section or source.
- `selected_section`: the rendered section; databases and rows render inside Pages.
- `selected_source`: `cache` while a stored answer is on screen, `server` once an answer arrived,
  `local` for the picker's local fallback without server search. `selected_tier` is not sent:
  Web does not compute match tiers yet.
- `time_to_first_paint_ms`, `server_ms`, `time_to_select_ms`: from the opening (PanelsContext's
  `performance.now()`) to React's commit of the first render with a result, of the first render
  of a server answer, and the pick. A commit precedes the browser's paint by up to a frame, so
  these are not comparable with the search dialog's two-frame `first_result_visible_ms`.
- `requests_sent`, `requests_aborted`: the requests the session's lanes issued, and those it
  aborted while they were pending (replaced on their lane, stopped by a query change or the close,
  or past their deadline). A refresh that joins one an earlier opening sent counts there.
- `zero_result_shown`: a settled answer showed no result for a typed query, or for the local pages.

The request has a three-second timeout, no transport retry, no authentication recovery and no
signal shared with the search, and its errors are swallowed. Only these fields are sent, and labels
outside Cloud's vocabularies are left out. Numbers are whole and within Cloud's bounds: a duration
above 600,000 ms or a rank outside 1-1,000 is left out, and counts stop at 1,000. The body carries
no query text and no object, user or workspace identity.

## Mention request scheduling

Each picker session decides when its searches are sent (`mentionSearchScheduler.ts`). The default,
`legacy`, keeps MEN-WEB-01's rules: a typed search waits 120 ms after every keystroke, a query
change aborts the typed search in flight, and the bare `@` request and the refresh of a cached
answer go out at once. The `contract` scheduler follows the Scheduler section of the typeahead
contract (AppFlowy-Cloud-Premium `doc/context/workspace/mention_typeahead_contract.md`):

- A keystroke at least 100 ms after the previous one is sent at once; otherwise its query waits
  100 ms, and a newer query replaces it.
- At most one typed group is in flight: the primary and rows requests of one query, or the refresh
  of one stale cached answer. A query that is ready waits for it, or aborts it once it has been in
  flight for 400 ms.
- A query that the group in flight already asks gets that group's answer and sends nothing, and so
  does a return to `@` while the bare request runs. Typing never aborts the bare request.
- Closing the picker drops the waiting query and aborts a typed search in flight; a refresh and
  the bare request run to their deadline.

A browser opts in with `localStorage.__mention_request_scheduler = 'contract'`. The default
switches once the session reports above give the baseline the contract scheduler is measured
against. Both schedulers send the same requests with the same headers to every server, and the
contract scheduler sends fewer of them.

Under the contract scheduler, a typed query that normalizes to one Latin letter can stay on the
local lane until the server lists `short_prefix_v1` in `mention_features`
(`localStorage.__mention_one_letter_local = 'true'`). This rule is off by default because the
picker has no local lane yet (MEN-WEB-09), so a one-letter query would only keep the list already
on screen. Web reads the feature from the server-info snapshot. Loading, failed or older server info
lists no features, so the rule then holds.

## Comment @ pickers

The @ pickers of row comments, Feed cards and document comments suggest people from the workspace
roster (`GET /api/workspace/{workspace_id}/mentionable-person`), not from the mention search.
`comment-mention-ranking.ts` decides who is listed and in what order, and
`useCommentMentionPicker` shares it between the two composers; each keeps its own trigger, keys
and insertion. The default, `legacy`, keeps the order these pickers have always had: everyone
whose name or address contains the typed text, in roster order, at most eight. A browser opts in
to the `ranked` order with `localStorage.__comment_mention_ranking = 'ranked'`, read when a
composer mounts:

- People match by the typeahead contract's people classes (C0 a name word, the address's local
  part or one of its words starts with the query; C1 the name contains it; C2 the local part
  does; C3 a query with `@` or `.` that the full address contains), so a shared domain matches no
  one.
- Inside a class: the commenter last; then the discussion's participants, the most recent first
  (a reply's thread, then, on a row, the row's other commenters; a new row or Feed comment ranks
  everyone who commented on the row); then people on the page, for document comments, from the
  page's awareness while the picker is open; then the commenter's latest mention of the person
  (`last_mentioned_at`); then Cloud's own tie-breaks for people (the shorter name on a typed
  query, the lowercased name, the person id). A bare `@` uses the same keys without the class.
- The highlighted person stays highlighted when the list changes without a keystroke, so Enter
  inserts the person the user chose.

Both orders read the roster fields every released server sends (`person_id`, `uid`, `name`,
`email`). `last_mentioned_at` is optional: a person without it, or with a value that does not
parse, counts as never mentioned. Neither order sends a request or changes the stored comment
format (`@[name](person_id)`).
