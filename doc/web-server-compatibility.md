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

The policy is maintained by hand and never blocks a build. When a web release
needs a newer AppFlowy-Cloud, add a row with the release's `client_from` and the
new `min_server`. A build whose version is newer than
`reviewed_through_client_version` uses the last row, so leaving the file
untouched means the current requirements still apply. Advance
`reviewed_through_client_version` when you review the table for a release; it is
also the version source builds report. The initial policy requires server 0.18.1
for web 0.17.1. Web versions that cannot be parsed do not produce old-server
warnings. There is no appcast or native update gate on web.

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

## Database page loading

The authenticated view loader requests
`GET /api/workspace/{workspace_id}/page-view/{view_id}?include_rows=false`.
It applies only the page's `encoded_collab`; database row snapshots are loaded by
the existing seed/realtime pipeline. The response retains the full database
metadata, including all view row orders, and returns an empty `row_data` map.
View authorization and database identity resolution remain on the page-view
endpoint. This transport option does not change the loader's view ownership or
sync binding behavior.

Omitting the parameter keeps the full row response for other callers. Request
deduplication includes the normalized row option so a legacy caller cannot
receive an empty-row response from a simultaneous optimized load. Older servers
that ignore the query continue returning rows, which this loader already ignores.
Published pages keep their separate static row payloads. Writable database pages
still walk blob-diff pages (256 items / 16 MiB per page) before exposing a complete
seed set for filtering, sorting, grouping and row counts; only visible rows acquire
realtime subscriptions. This change removes duplicate page-view reads and does
not introduce partial database semantics or change read-only/guest fallback behavior.

The blob-diff binary endpoint can also return JSON application errors, including
HTTP 200 with code 1079 when the server's admission queue is full. Web detects the
JSON envelope before protobuf decoding and retries admission overload (1079 or
HTTP 429) at most three times per page request. Backoff bases are 1/2/4 seconds,
with 100–200% jitter and a server retry hint as a minimum. Hints over 30 seconds
surface the retry action immediately rather than retaining the walk or retrying
early. Cursor, original RID and provisional pages stay unchanged across retries;
seeds and the RID become visible only after the terminal Ready page. Concurrent
views of the same database share the prefetch, and the last owner's release
cancels unfinished network/backoff work. After overload exhaustion, the database
shows a retry action and keeps its row seed gate closed, avoiding a second wave
of individual row-sync requests. Permission and protocol failures retain their
existing handling.
