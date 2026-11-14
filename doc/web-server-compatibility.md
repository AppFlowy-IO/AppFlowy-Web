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
- `selected_section`: the rendered section; databases and rows render inside Pages, and a pick
  from the Suggested section reports `suggested` (see "Mention opt-ins").
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
(`localStorage.__mention_one_letter_local = 'true'`). With the picker's v2 on, such a query shows
the local lane's matches (see "Mention local lane"); otherwise it keeps the list already on screen.
The rule stays off by default until product approves it (contract decision D8). Web reads the
feature from the server-info snapshot. Loading, failed or older server info lists no features, so
the rule then holds.

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
  does; C3 a query with `@` or `.` that the full address contains). So a domain word alone
  (`appflowy`) matches no one, while `appflowy.io` or `@appflowy` lists everyone at that domain
  (C3).
- Inside a class: the commenter last; then the discussion's participants, the most recent first
  (a reply's thread, then, on a row, the row's other commenters; a new row or Feed comment ranks
  everyone who commented on the row); then people on the page, for document comments, from the
  page's awareness while the picker is open (a Web collaborator by person id, a Desktop one by
  the exact uid its awareness metadata carries as `id`); then the commenter's latest mention of
  the person (`last_mentioned_at`); then Cloud's own tie-breaks for people (the shorter name on a
  typed query, the lowercased name, the person id). A bare `@` uses the same keys without the
  class.
- In both orders the highlight stays on the person it shows when the list changes without a
  keystroke (the roster arrives in another order; under `ranked`, a comment arrives or someone
  joins or leaves the page), from the first render of the list, so Enter inserts the person on
  screen.

Both orders read `person_id`, `name` and `email`, which every released server sends. The ranked
order also reads two optional fields. `uid`, which servers before 0.18.2 omit, resolves the
people that comments and awareness name by uid: the authors of row comments written with a uid,
and Desktop collaborators on the page. Without it they count as neither participants nor
present, and the remaining keys order them. A person without `last_mentioned_at`, or with a value
that does not parse, counts as never mentioned. Neither order sends a request or changes the
stored comment format (`@[name](person_id)`).

## Mention pick memory

The editor's @ picker can remember which item the user inserted after typing what, and list that
item first in its tier the next time they type it (`mentionPickMemory.ts`, applied by
`mentionPickRanking.ts`). It is off by default, and the replay gate keeps it off (see "Mention
ranker replay gate"): it passes the gates against MRU, but lowers hit@1 of queries of 7 or more code
points by 0.72 pp against the same ranking without it, more than the 0.5 pp the plan allows a
ranking change. Turning it on waits for a ranker change or a product decision on that, and for
product sign-off. A browser opts in with `localStorage.__mention_pick_memory = 'true'`, read when a
picker opens; while it is off the picker neither records nor reads picks.

- Only inserting a person, page, database or row records a pick. Showing, highlighting or hovering
  an item never does, and neither do dates, reminders, links or a page created from the picker.
- The memory is the typeahead contract's (AppFlowy-Cloud-Premium
  `doc/context/workspace/mention_typeahead_contract.md`, section Pick memory): Firefox's
  adaptive-history parameters as integers in millionths, decay by whole days, a stored input counts
  for every typed input it starts with and double for the same input, and at most 1,000 entries.
- Inside a tier, pick memory comes first. Four picks after exactly the typed input, the same day,
  lift an item one tier and never more, so only those picks can put an item above another's exact
  title. A section where no pick scores keeps the server's order; one where a pick scores is
  ranked by the contract's client ranking, so a body-only hit there drops below the title matches.
- Pick memory orders only the answer to what is typed now, once it is on screen: a server answer,
  part of one, or a cached one. While that answer is pending the loading state shows as before,
  and the answer to an earlier search, such as the bare one a local one-letter query keeps, stays
  as it is.
- A picked page, database or person that the answer lacks (the index has not caught up, or the
  roster is refreshing) joins from the tab's local index, when the picker asked for its kind and
  its current title or name still matches the query. A person joins named as Cloud names them, by
  the address when the name is blank. The session report counts such a pick as `local`.
- Until access returns (`VIEW_ACCESS_RESTORED`), a page or database the user lost access to in this
  session (`VIEW_ACCESS_REVOKED`) never joins, though the index lists it until the outline or the
  recent views catch up. The app names only the page whose share changed, so a page or database
  below it never joins either, as far as the index knows the pages above it (from the outline, the
  recent views' parents and this tab's creations). The one exception: a page two or more levels
  below, which the recent views still list, can join while a page in between is listed by no
  source, until the recent views reload.
- Access can also change without the app naming a page: a space's access or members, a member's
  role or a group (`PERMISSION_CHANGED`). The outline reloads with it and decides for the pages it
  lists, so from then until the recent views reload, a picked page only they list never joins.
  Neither does a page this tab created before the change that neither the outline nor the recent
  views listed yet, until one of them lists it.
- The memory stays on the device, under `af.mention.pick-memory.v1:<workspace_id>:<uid>`: normalized
  inputs of at most 32 code points, navigation keys, counts and times, no title, name or address.
  An explicit sign-out removes the user's memories in every workspace; a session that expires keeps
  them, as it keeps the device's other local state. Blocked or full storage leaves the picker
  without pick memory and otherwise unchanged.

Pick memory sends nothing and changes no request or header, so every server, released or older
self-hosted, receives what it received before. It reads only the item fields every released server
sends (the kind, title, subtitle and mention payload ids).

With pick memory on or off, the picker lays its sections out as "Mention picker sections" below
describes, and titles a section it makes, such as one only picked targets fill, with the
translation of its kind (`document.mentionMenu.pages` for Pages, "Pages" in English), as it titles
every section.

## Mention keep-and-narrow first paint

The editor's @ picker can keep its list while the user types, instead of blanking it on every
keystroke whose answer is not cached (`mentionProvisional.ts`, wired in `MentionPanel.tsx`). It is
off by default until its rollout. A browser opts in with
`localStorage.__mention_typeahead_v2 = 'true'`, read when a picker opens; while it is off the picker
behaves as before.

- On a keystroke whose answer is not cached, the picker builds provisional sections in the same
  render from what it already holds: the list on screen, the cached answer of the longest typed
  prefix of the query, and the cached bare `@` answer of the same picker. A cached answer is read
  fresh or stale, and one that arrives later, such as a bare answer that comes after the user typed,
  narrows into the list at once. An item listed by several of them is listed once, with the first
  one's title, so a page renamed on screen is not brought back by an older answer. Date and reminder
  quick picks are the exception: Cloud computes their time when it answers (Today is that day,
  "Reminder 1 week" a week from then) and keys them by kind and title only, so each comes from the
  newer of the two cached answers that lists it (the one whose request was sent later), never from
  the list on screen, which can still show an older answer's after the bare answer's refresh landed.
- Only items that still match the new query by the typeahead contract's matcher stay: pages,
  databases and rows whose title matches at T3 or better, people at C3 or better (by name or the
  address's local part, or by the whole address for a query with `@` or `.`; a domain word alone
  never matches), and date and reminder quick picks that match at T2 or better, as Cloud offers
  them. A body-only hit cannot be checked on the client, so it waits for the server; links, which
  derive from the query, never stay. A view the user lost access to in this session never shows,
  and neither does a picked target that pick memory joined from the local index: those join only
  an answer to what is typed (see "Mention pick memory"). After an access change that names no
  page (`PERMISSION_CHANGED`: a space's access or members, a member's role, a group), an answer
  asked for before it may list a page the user lost. Cached or not (one lane's answer can arrive
  after the change), it narrows into no provisional list, and neither does a list on screen built
  from such answers: a provisional list on screen and the items kept next to "Suggestions
  unavailable · Retry" are dropped at the change. The answer to what is typed still shows, as with
  the v2 off, until a newer answer replaces it, also next to Retry when the request fails, but it
  narrows into no later keystroke.
- The skeleton shows only while that list is empty and a request is pending. Over results, a 2 px
  progress bar shows instead (`role="progressbar"`, "Updating suggestions…"), and the list is not
  `aria-busy`.
- The answer to what is typed replaces the provisional list. People, Pages and Database rows are
  ranked by the contract's client ranking (people classes and title tiers, then pick memory when it
  is on, then the server's order), so a body-only hit never sits above a title match, also from an
  older self-hosted server whose answers come in keyword order. Dates, Links and Databases keep the
  server's order; Databases because Search also matches a database by the name of the view that
  reached it, which the item does not carry. While a request of the answer is pending, or after it
  failed, the provisional items of its kinds stay: the rows a slower rows request has not answered
  yet, or the pages next to the "Suggestions unavailable · Retry" row. An incomplete answer that
  lists no item replaces the provisional list too when one of its requests answered, so only the
  kinds it lacks stay; when none answered, the whole list stays. When a retry, or the search sent
  again after a busy cooldown, lists no item, the items an earlier attempt for the same query showed
  stay.
- "No result" shows only for an answer to what is typed, never for a provisional list that is
  empty. A query that stays local under the contract scheduler's one-letter rule shows its
  provisional list as its answer.
- The highlight behaves as before: nothing is highlighted until ArrowUp or ArrowDown, it stays on
  its item through merges, and a keystroke clears it. With
  `localStorage.__mention_default_highlight = 'true'` as well, the first result is highlighted and
  follows the top of the list as it is narrowed and answered, Enter inserts it, and ArrowUp or
  ArrowDown holds the highlight on the item it moves to until the next keystroke.
- The session report gives `selected_source: cache` for a pick from a provisional list, or for a
  provisional item that an incomplete answer kept, and `time_to_first_paint_ms` counts a
  provisional list as the first list with a result.

The picker sends the same requests with the same headers to every server, with the switch on or
off, and reads only item fields every released server sends (the kind, title, subtitle and mention
payload ids).

## Mention local lane

With the picker's v2 on (`localStorage.__mention_typeahead_v2 = 'true'`, see the section above),
the editor's @ picker also merges the candidates the tab already holds into every list
(`mentionLocalLane.ts`, `mentionLocalMerge.ts`): the pages and databases of the local index (the
outline, the recent views and this tab's creations, renames and opens) and the roster the tab last
loaded. `localStorage.__mention_local_lane = 'false'` keeps the v2 lists without it, to compare them.

- Typed queries follow the typeahead contract's merge (AppFlowy-Cloud-Premium
  `doc/context/workspace/mention_typeahead_contract.md`, section Merge, pinned by its `merge.json`
  vectors). An item the server lists and the tab holds keeps the server's payload and shows the
  tab's title, so a page renamed in this tab shows its new name and ranks by it. People, pages and
  databases the tab holds that match the query (people by name or the address's local part, or by
  the whole address for a query with `@` or `.`, never by a domain word alone; pages and databases
  at T3 or better) join in the keystroke's own render, also before
  any answer, and stay once the server answers. They join only pickers that ask for their kind and
  pass the request's filter, so a page-reference picker never lists people. One that this tab
  created or renamed in the last 15 minutes carries `data-fresh="true"` on its option; with the item
  details on, its chip says when the tab created it (see "Mention item details"), as a rename gets
  none. A database this tab just created, whose view the outline has not listed
  yet, merges with the server's item for that database, and the highlight stays on it when an
  answer brings that item.
- Inside a tier, the client's signals order the items, as the contract's in-tier keys say: pick
  memory when it is on, people on the page (read from the page's awareness, as the comment pickers
  read it), then how recently this tab or the user opened, created or mentioned the item, then the
  server's order. Databases keep the server's order, as with v2 alone, and the tab's databases
  follow them. The page being edited (the request's `context.view_id`; for a Text cell, the
  database view it is edited in) gets no recency: opening it made it the tab's latest open, but it
  is rarely its own mention target, and Search gives it no personal score either.
- A bare `@` keeps the server's order and lists no other item, except that this tab's recent
  activity comes first, the newest first: the pages and databases it opened since a minute before
  the answer arrived, since another Cloud replica can answer from a bare answer up to a minute old,
  and those it created in the last 15 minutes and has not opened, however new the answer is: Cloud's
  bare answer lists only the user's opens and the page being edited, so it lists such a page only
  once the user opens it. Most creations open at once: a sub-page or "turn into page" in a document
  opens in the page modal, and an AI chat opens in the main view, which counts as an open although
  the tab never loads a chat as a document. What stays unopened is a sub-page added in a row page
  or a Feed card's preview, whose editors offer no page modal, and a creation whose modal closed
  before the page loaded. The cached paint and every answer lift the same creations. A lifted
  database leads the databases, which the picker lists after the pages, as it lists the server's.
  The page being edited is never lifted; it stays where the server puts it. People follow the
  same rule: the people this tab picked in the session come first, then up to three people on the
  page whom the answer or the roster lists, then the server's order, with the requester last as
  the server puts them. Nothing the answer's Suggested section lists is lifted: it shows there,
  first (see "Mention opt-ins").
- When a search fails or times out, the "Suggestions unavailable · Retry" row shows under the
  tab's matches, never "No result". A bare `@` that fails lists this tab's opens and creations,
  the page being edited excepted.
- A page or database the user lost access to in the session never comes from the tab, nor does one
  below it, as far as the local index knows the pages above it; a provisional list leaves out a
  server item below it too. After an access change that names no page (`PERMISSION_CHANGED`), the
  outline reloads and decides for the pages it lists, and until the recent views reload, no page
  comes from them alone, as they may list one the user lost. Nor does a page this tab created
  before the change that neither the outline nor the recent views listed yet (such as one below a
  page whose children the outline has not loaded), until one of them lists it.

The picker loads nothing for the local lane: it reads the outline, recent views and roster the app
already loaded. With the v2 on, every request carries `section_degradation_v1` and
`typeahead_deadline_v1` (Cloud MEN-CLOUD-12 and -13) in `client_features` when the server lists them
in `mention_features`; to a server that lists none they are the requests released Web sends. Other
opt-ins follow their own switches (see "Mention opt-ins"). Answers to requests that carried
different opt-ins are kept apart in the cache, and an answer to a request that carried one of these
two is never cached when it is `partial` or has a `partial` or failed section, as they require. An
item the tab adds is inserted with the payload the server would send for it, so documents read the
same in every client. The one exception is a database whose view the tab does not know yet (one it
just created, or a container whose children the outline has not loaded): it is inserted as a page
reference to the view the tab lists it by, which every client opens, where the server's item would
name the database's first view. A database id there would open nothing.

## Mention local rows lane

With the local lane on, the @ picker of a Text cell or a row page also matches the rows of its
database by title (`mentionLocalRows.ts`; MEN-WEB-15). `localStorage.__mention_local_rows =
'false'` turns it off. The rows come from the database's rows source
(`src/application/database-yjs/mention-local-rows.ts`), which reads nothing until a picker
subscribes and lets everything go once the last one closes:

- Rows the tab has open (those the view rendered, a row page, a row this tab just created) are read
  from their live documents, which are observed while the picker is open, so a title typed into a
  row shows at once; a document the row cache replaces (after a version reset or a restore) is
  followed from the next refresh. Any other row is read from the seed the row walk downloaded,
  decoded off the keystroke path in slices of about 8 ms; only titles and creation times are kept,
  and a seed is decoded once.
- A typed query adds the rows whose primary-field text matches at T3 or better to Pages, where
  Search returns rows, ranked by the typeahead contract's rules with the other Pages items. A row
  created at most 15 minutes ago (its `created_at`) carries `data-fresh="true"`, as a page this tab
  created does, but with the item details on it shows no "Created" chip: chips read the local
  index, which holds no rows, so a row gets one only from a server's reason (see "Mention item
  details"). A row the server lists too keeps the server's payload and shows once: with its own
  title when the tab read it from the row's live document while syncing it (a rename typed or
  received here shows at once), with the server's when it came from the seed or a cached document
  the tab no longer syncs, either of which may be older than Search's. The lane never lists the row
  the editor is in (the request's `context.row_id`): a row page's title is saved as it is typed, so
  its title holds the query that opened the picker. Search's item for that row still shows. A bare
  `@` lists no row, as before.
- An inserted row is the mention a server row item gives: a page reference to the view the editor
  is in, with the database, the row and the view, so every client opens it. A row of a view the
  user lost access to in the session is not listed.

The picker keeps sending the rows request it sent before: Search matches a row by its whole text,
the lane by its title. `localStorage.__mention_local_rows_skip_server = 'true'` leaves that request
out while the database is complete: every row has a title and the tab holds every row of the
database (`holdsDatabaseSourceRows`). That is rare: only a cold or full walk makes a database
resident, a grid revisited after a reload walks only the rows that changed, and the row walk's seed
lookup holds 10,000 rows across all databases. Each typed query is decided once, when it is typed:
the database completing, or losing a row's title, while a query shows changes only the next
keystroke's requests, so the query on screen is never sent again. A typed query decided that way
lists no row the lane leaves out, such as the row the editor is in. The switch is off by default,
and the primary request still asks for no rows, so the request a server receives is the primary
request it already knew. `doc/MENTION_LOCAL_ROWS_SPIKE.md` gives the measurements behind these
rules.

## Mention picker sections

The @ picker titles each section of a server's answer by its kind, with the translation of
`document.mentionMenu.suggested`, `people`, `pages`, `databases`, `databaseRows`, `dates` or
`links`, never with the title the server sent, which is English whatever the user's language
(`mentionSectionTitle` in `mentionUtils.ts`; MEN-WEB-12). A Dates section that lists a reminder
takes `dateAndReminder` ("Date & Reminder") instead, as every released Cloud titles it
(`build_date_section`): a document's bare `@`, which asks for reminders, reads "Date & Reminder",
and a typed query that matches only dates reads "Dates". The picker decides by the items it shows,
after leaving out the reminders it does not offer, as in a database Text cell. So in English every
section reads as servers title it. A kind this client does not know keeps the server's title. The
local fallback, which lists the outline where no mention search is available, keeps its own titles
("Recent pages", "Date"). The "N more" row, the "Send notification" switch and the options to
create a page are translated too, and a create option shows the typed name as typed: i18next
escapes interpolated values by default, so the name is never passed through it. A language whose
locale file lacks a create option's label (today every one but English) keeps the label the picker
built before from words it translates, `button.create` and the slash menu's
`subPage.keyword1` ('Erstellen "foo" Unterseite'), rather than show it in English. Choosing a create
option again while its page is created does nothing, and a page created after the picker closed,
or closed and opened again, adds no mention (the page stays).

By default the sections show as before (the `folded` layout): databases and database rows inside
Pages, after its pages, and only Pages collapses to four results and "N more". The picker's sections
switch is off until product and design sign off on the structure. A browser opts in with
`localStorage.__mention_sections_v2 = 'true'`, read when a picker opens, with or without the
picker's v2. It changes three things:

- Every kind is a section of its own, in the canonical order (Suggested, People, Pages, Databases,
  Database rows, Dates, Links), as Desktop shows them, so a database viewed a minute ago is listed
  even when four or more pages are. Rows stay where the server puts them: Search sends typed rows
  inside Pages, and a server that answers with a Database rows section gets one.
- Each section of people or objects (Suggested, People, Pages, Databases, Database rows) shows four
  results and "N more", which expands that section alone until the query changes. Dates and Links
  list quick picks, which never collapse, as on Desktop.
- A typed query offers 'Create "name" sub-page' and 'Create "name" page in...' after its results, as
  the local fallback does, except in a database Text cell, whose picker never offers them (nor does
  Desktop's).

The switch changes no request or header, so every server, released or older self-hosted, receives
what it received before. The layout reads only each section's `kind`, which every released server
sends.

## Mention ranker replay gate

`pnpm mention:eval` (`scripts/mention-eval/run-eval.mjs`, MEN-X-07) replays 30 days of one user's
opens, creations and @-mention picks in a synthetic workspace through the picker's production client
ranking with pick memory, each prefix of each query as it was typed, and grades it against MRU
(recently used items whose title matches at a word start or better, the newest first) and today's
substring filter. Its files are in `mention-panel/__fixtures__/mention-eval/`, whose README gives
the sessions, the replay rules and the gates. Desktop keeps a byte-identical copy and replays it
through its Dart ranker.

- Each switch is graded in the configuration its default ships, and may default on only while that
  configuration passes: `mentionTypeaheadV2` alone by the ranking without pick memory (pick memory
  is off by default), pick memory by the ranking with it. The gates: MRR@8 at least MRU's in every
  prefix bucket, a unique exact title always first, no T0 or T1 title below a T3 or T4 title, the
  same rankings in Dart and TypeScript, and for pick memory, no prefix bucket's hit@1 more than
  0.5 pp below the ranking without it (MEN-X-04's ship-gate rule for a ranking change).
- The replay ranks the local lane alone, as the picker does before an answer arrives, offline, or for
  a one-letter query that stays local: no server answer, presence or page being edited. It is a
  regression guard on synthetic data, not a measure of quality, which online session reports decide.
- CI (`.github/workflows/mention_eval.yaml`) fails when the committed rankings or verdict are stale,
  and when `MENTION_TYPEAHEAD_V2_DEFAULT` or `MENTION_PICK_MEMORY_DEFAULT` is on while the
  configuration it ships fails a gate, as `mention-eval-fixtures.test.ts` does
  (`scripts/mention-eval/guard.ts`). A change to the ranker, pick memory or normalizer reruns
  `node scripts/mention-eval/run-eval.mjs --write` and copies the folder to Desktop.
- On the committed sessions (`verdict.json`), `mentionTypeaheadV2` alone passes every gate. Pick
  memory passes the gates against MRU but fails against the ranking without it: in the `7+` bucket
  hit@1 drops from 652 to 646 of 834 cases (78.18% to 77.46%, -0.72 pp) and MRR@8 from 0.841 to
  0.830, while it raises the other buckets' hit@1 by 4.9 to 11.0 pp. Of the 16 `7+` cases it loses
  (it wins 10), each is a sibling the user picked earlier, after typing something that starts with
  the query, staying ahead of the page they opened more recently (10 are an older
  `Weekly sync 2026-10-30` ahead of `Weekly sync 2026-11-02`), because pick memory's score comes
  before recency inside a tier. Both switches stay off by default until product sign-off and the
  rollout stages; pick memory also needs that decision or a ranker change.

The replay is test tooling: it sends nothing, and the picker and its requests do not change.

## Mention item details

The editor's @ picker can show more about each result than its title (`mentionItemDetails.ts`,
`MentionResultDetails.tsx`; MEN-WEB-13). It is off by default until design signs off on the
treatment and the picker has a shared image cache: without one, each row downloads an uploaded
avatar or view icon again whenever it mounts (see the end of this section). A browser opts in with
`localStorage.__mention_item_details = 'true'`, read when a picker opens, with or without the
picker's v2. While it is off the picker shows what it showed before.

- **Breadcrumbs.** A page, database or row shows its `path` as a muted line under the title, root
  first and joined by " / " ("Engineering / Specs"), with the whole path as its tooltip, so two
  "Meeting notes" pages read apart. Only a path whose `path_status` is `complete` shows. A path
  Search shed for load (`omitted_due_to_load`) or could not resolve (`omitted_unavailable`) shows
  nothing, and so does an item without one: Search sends none for databases, and the local lane's
  items have none. The `subtitle` servers send for these items (the same path joined, or
  "Database") is English and stays hidden.
- **Avatars.** A person shows the avatar of the workspace roster, found by person id: its image,
  or, for an avatar that is an emoji (the profile's emoji tab saves one), the emoji drawn as text;
  else initials. No server sets a person's `icon`. A picker that lists people loads the roster once
  per opening through the roster cache the person cells use: memory for 30 seconds, then IndexedDB
  for 30 minutes, then one `GET /api/workspace/{workspace_id}/mentionable-person`, which every
  server with mention search serves. Until it arrives, or when it cannot load, the person shows
  initials. The same roster resolves a Desktop collaborator on the page, whom awareness names only
  by uid (servers before 0.18.2 send no `uid`, so such a collaborator gets no chip), and the local
  lane reads it too.
- **Icons.** A page or database the local index holds shows its outline icon (emoji, image or icon
  set), else its layout's icon (board, calendar, list...); anything else keeps the kind's icon. A
  server's `icon` is never drawn: servers type it as an object whose `ty` is a string, where the
  outline numbers its icon types, and none sets it yet.
- **Reason chips.** At most one muted chip at the end of the row: "Opened 3 min ago", "Created just
  now" or "On this page". A page or database says when it was opened (this tab's open, the recent
  views' last view) or created (this tab's creation, else the outline's creation time): a creation
  in the last 15 minutes wins, as it is why the item is new, otherwise the newer of an open in the
  last 7 days and a creation in the last day. A person on the page (its awareness, as the comment
  pickers read it) is "On this page". The page or database view being edited shows none. A server
  that explains its items (Cloud MEN-X-09: `reason`, sent only to a request with
  `client_features: ['reasons_v1']`, which the picker sends while the switch is on and the server
  lists `reasons_v1`, see "Mention opt-ins") adds `viewed` and `created` with their times, for rows
  too, and `participant`; every other signal shows nothing, a value this client does not know
  included. Nothing ever says "Edited": the Folder's edit times, and the server's `changed` signal,
  reflect only metadata changes. The server's `mentioned` (the user's own mention) and `interaction`
  (a mention, comment, reply, share or assignment from that person, or a page the user was notified
  about) have no copy yet; "Mentioned you" would mislabel most interactions.

Whatever the switch, an `icon` that is not a string never reaches an image (a person's icon object
used to throw while rendering) or a saved mention's `data`. The details read `path` and
`path_status`, which servers since 0.17.6 send (an older server sends no path, and no breadcrumb
shows), and the optional `reason`. With the switch on, a picker that lists people loads the roster
once per opening (see Avatars), and the search requests carry `reasons_v1` (and their cache keys
hold it) only to a server that lists it; inserted payloads are unchanged. The picker also downloads
images it did not before: a row whose avatar or view icon was uploaded to AppFlowy's file storage
fetches it, with one authenticated GET, every time the row mounts. That is each opening and, with
the picker's v2 off, each keystroke whose query has no cached answer, as the list empties while the
answer loads. The server sends these files `Cache-Control: private, no-store`, so the browser keeps
none of them, and the picker has no shared image cache yet (one is needed before the switch's
default goes on); an image that finishes after its row left is revoked, not kept. Avatars and icons
hosted elsewhere load as plain images, cached as their hosts allow. With it off, the picker sends
and loads what it did before.

## Mention opt-ins: Suggested, reasons and pick feedback

The editor's @ picker sends a mention search opt-in in the request's `client_features` only while
the web server-info snapshot lists it in `mention_features`, and only on the requests that can use
what it changes (`mentionClientFeatures.ts`; MEN-WEB-11). Cloud serves an opt-in only when its
rollout flag is on for the workspace and otherwise answers as if the request named nothing, and
released servers list none, so to them the picker sends the requests released Web sends. Loading or
failed server info lists nothing either.

| Opt-in | Requests | Client switch | What the picker does with it |
| --- | --- | --- | --- |
| `section_degradation_v1`, `typeahead_deadline_v1` (MEN-CLOUD-12, -13) | every request | the picker's v2 | see "Mention local lane" |
| `reasons_v1` (MEN-X-09) | every request | the item details | shows a known reason as the item's chip (see "Mention item details") |
| `suggested_v1` (MEN-X-10) | the bare `@` of the `@` picker only | `localStorage.__mention_suggested = 'true'`, off by default | shows the Suggested section first |
| `selection_memory_v1` (MEN-CLOUD-20) | typed queries only, primary and rows requests | the selection memory switch: on by default, so the server's advertisement decides; `localStorage.__mention_selection_memory = 'false'` turns it off | reports each pick (below) |

- **Cache keys.** Each request's cache key holds the opt-ins it carries, sorted, so an answer shaped
  for one set never answers a request with another: opening the `@` picker with the Suggested switch
  on sends the bare `@` again even while an answer without Suggested is fresh, and each keeps its
  own entry. A lane's key holds only its own opt-ins: selection memory never splits the bare `@`
  entry, nor Suggested a typed one. Only the two degradation opt-ins keep `partial` answers out of
  the cache; the others cache as a request without opt-ins does.
- **Suggested.** Cloud's Suggested section holds at most three people, pages or databases, each
  moved out of the section it would be in. The picker shows it first in either layout, under the
  translated "Suggested" title, and lists each of its items once: an item another section lists too,
  from a server that copied it or from this tab's activity, shows in Suggested alone, and with the
  local lane on a bare `@` never lifts an item Suggested lists. A database row in Suggested is kept,
  though a bare `@` shows no other row. The "Send notification" switch heads the first section that
  lists a person, so it shows once. A pick from it reports `selected_section: suggested`. A `+` or
  `[[` picker never asks for it. The switch stays off until Suggested's precision reaches 25% (picks
  from it over the openings that showed it), and Cloud's `mention_flag_suggested` is off too.
- **Reasons.** The picker shows reasons only through the item details' chip, so it asks for them
  only while the item details are on. A signal the chip has no copy for, a value this client does
  not know included, shows nothing, and no reason ever shows with the item details off.
- **Selection memory switch.** Cloud keeps no opt-out of its own: a user declines through the
  client, which then sends neither `selection_memory_v1` nor pick reports (MEN-CLOUD-20). The
  switch, read when the picker opens, is that choice for the browser: on by default, so the server's
  advertisement decides, and `localStorage.__mention_selection_memory = 'false'` turns both off. No
  user-facing setting writes it yet: MEN-CLOUD-20's privacy review decides one, and Cloud keeps
  `mention_flag_selection_memory` `off` until that review.
- **Pick feedback.** While the server lists `selection_memory_v1` and the selection memory switch is
  on, inserting a person, page, database or row from a server's answer sends one
  `POST /api/workspace/{workspace_id}/mentions/feedback` (`mention-pick-feedback.ts`, Cloud
  `MentionPickFeedback`): `target_kind` and `target_id` (the item's `kind` and `object_id`),
  `position` (its 1-based place among the results on screen, across sections) and `query_len` (the
  characters typed after the trigger, counted after the typeahead contract's normalization, as Cloud
  counts the query of the answer it joins the pick to; 0 for a bare `@`). It is sent after the
  insertion and never awaited: one attempt with a 3-second timeout, no transport retry, no
  authentication recovery and no signal shared with a search; every error is swallowed, and a 404 (a
  server that lists the feature without the route, as after a rollback) stops reports for the rest
  of the tab. Dates, reminders, links, a page created from the picker, an item only this tab listed
  (the local lane, a picked target joined from the local index) and the local fallback send nothing,
  since Cloud keeps a pick only when one of its own answers of the last minute served the item. The
  body carries no query text, title or name. Cloud's optional `request_id` (the search response's
  `x-request-id`) is not sent: neither Cloud's CORS layer (`expose_headers`) nor its bundled nginx
  (`Access-Control-Expose-Headers`) exposes that header, so a web app on another origin than the API
  cannot read it; Cloud joins the pick to its answer by `query_len` and recency instead. Cloud lists
  `selection_memory_v1` only where it keeps selection memory and its rollout flag is past `off`,
  never in a self-hosted build, so self-hosted servers receive no feedback and no selection memory
  opt-in.

Everything above reads only fields released servers send, plus the optional `reason` and the
existing Suggested section kind, which no server sends without the opt-in. Servers before
MEN-CLOUD-05 send no `mention_features`, so they receive exactly what released Web sends.
