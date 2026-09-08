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

When releasing web, review the JSON policy's server requirements and advance
`reviewed_through_client_version`; builds reject newer release versions until this
reviewed boundary is advanced. The initial policy requires server 0.18.1 for
web 0.17.1. Unknown/unreviewed web versions do not produce old-server warnings.
There is no appcast or native update gate on web.

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
