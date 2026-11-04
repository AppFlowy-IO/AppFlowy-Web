# AI apps (MCP)

AI apps such as Claude, ChatGPT, Claude Code, Cursor, VS Code, Codex and Gemini CLI connect to
AppFlowy through the AppFlowy MCP service (`appflowy_mcp`, a service separate from Cloud, on its own
origin or, in self-hosted deployments, on AppFlowy's own domain). The Web app owns three surfaces of
that flow:

| Surface | Route / place | Login |
| --- | --- | --- |
| Setup instructions | `/oauth/mcp/setup` (`src/pages/McpSetupPage.tsx`) | no |
| OAuth consent | `/oauth/mcp/authorize` (`src/pages/McpAuthorizePage.tsx`) | yes (bounces to `/login`) |
| Self-service and owner governance | Settings → MCP (`src/components/app/settings/mcp/McpPanel.tsx`, `?setting=AI_APPS`) | yes |

The server contract (endpoints, error reasons, client summary) is documented in AppFlowy Cloud's
`doc/context/integrations/mcp_context.md`.

At a glance (details in the sections below):

- **One connection per device**: every sign-in from an AI app is its own connection (token
  family) with the device the app described ("Claude Code 2.1 · macOS"), "Connected …" and
  "Last used …"; disconnecting ends one device's connection and leaves the others working
  ([Settings → MCP](#settings--mcp)).
- **Overview across workspaces**: "You have N apps connected across M workspaces" from
  `GET /api/mcp/me/connections`.
- **Verified apps**: the server's catalog names apps it recognizes and marks web apps whose
  identity it proves (Claude, ChatGPT) as **Verified app** ([App identity](#app-identity)).
- **Three approval policies per workspace**: Verified and approved apps (the default), Approved
  apps only and Any app, with app-level approvals ("All Cursor installs").
- **Enable MCP switch**: MCP is on by default, and an administrator can turn it off (or back on)
  for the whole server in AppFlowy-Admin; a self-hosted server serves it only with a One, Team or
  Enterprise license. While off the consent page and Settings say so, and Settings keeps Your
  connections for disconnecting ([Enable MCP switch](#enable-mcp-switch)).

## Flow

1. The user adds the server URL (`<MCP origin>/mcp`, shown by Settings and the setup page; see
   [MCP service URL](#mcp-service-url)) to an AI app. The app reads the server's OAuth metadata,
   registers itself (dynamic client registration, DCR) or presents a client ID metadata document
   URL (CIMD), and opens `GET /api/mcp/authorize` in the browser.
2. The MCP service validates the request and redirects the browser to the Web consent page,
   `<APPFLOWY_WEB_URL>/oauth/mcp/authorize?client_id=…&redirect_uri=…&response_type=code&code_challenge=…&code_challenge_method=S256[&state&scope&resource&workspace_id]`.
   The page shows a spinner until it knows the MCP service's URL (with server-info discovery, after
   one `/api/server-info` request), then "not configured" if neither source names one. While AI app
   connections are turned off for the server, the MCP service answers the authorization request
   itself with 503 `mcp_disabled` instead of redirecting (see [Enable MCP switch](#enable-mcp-switch)).
3. Signed-out users sign in through a flow-bound continuation (see
   [Sign-in continuation](#sign-in-continuation)): the login URL carries only an opaque flow ID,
   and password, magic link, SSO, OIDC, SAML and LDAP sign-in return to the consent request while
   is within the Web's 10-minute sign-in window, or land on an "expired" view after that.
4. The page loads the public client description (`GET /api/mcp/clients?client_id=`), the user's
   workspaces with their roles (`UserService.getWorkspaceInfo`, as the app shell does), and for the
   chosen workspace the member status (`GET /api/mcp/me/workspaces/{id}?client_id=`): whether AI app
   connections are on (`enabled`), role, eligibility, approval requirement and the client's state
   there.
5. The user picks a workspace (the requested one, else the current one, else the first; each shows
   the user's role, Owner or Member, so same-named workspaces can be told apart; guest workspaces are
   listed but disabled) and the permissions. `read` is always granted and includes the workspace
   member list with names and emails; `write` and `admin` (destructive tools) start checked when the
   app requested them and can be turned off. Unknown requested scopes are ignored. When the app asked
   for neither `write` nor `admin` (apps that send no scope included) and the user has not ticked
   either, `mcp-consent-read-only-hint` says so ("{app} asked only to view and search. To let it make
   changes, tick Create and add."; `isReadOnlyConsentRequest`). "Learn more about AppFlowy MCP"
   (`mcp-consent-learn-more`) opens `/oauth/mcp/setup` in a new tab with `rel="noopener noreferrer"`,
   so the request stays open and its OAuth parameters stay out of the referrer.
   An app the server's verified catalog recognizes (`verified_app`, see
   [App identity](#app-identity)) is named by the catalog's `app_name`. Its publisher row shows
   **Verified app** only when the catalog also proves the app (`identity_verified`: a web app such
   as Claude or ChatGPT). A catalog app that runs on the user's computer (Claude Code, Cursor) gets
   the publisher row of any other client (Verified domain / Not verified), and its loopback redirect
   gets "Runs on your computer" and the warning.
   When the user already has a connection with the app in that workspace (`client.connected`),
   `mcp-consent-already-connected` says that allowing again adds another connection and the existing
   ones keep working: every authorization is its own connection (one per device, see
   [Settings → MCP](#settings--mcp)).
6. The primary button follows the member status, decided by `client.approved` (approved here, or
   approval not required). `requires_approval` is not consulted: it mirrors the workspace setting,
   which the decision `/authorize/code` enforces can trail by up to 30 seconds after an owner turns
   the requirement off, so trusting it could offer an Allow the server still refuses.
   For a self-registered (DCR) app the catalog does not recognize whose `redirect_uri` is https on a
   host other than this computer (`consentHostToAcknowledge`), Allow and Approve and allow stay
   disabled until the user ticks "I recognize {host} and started this connection"
   (`mcp-consent-acknowledge`): the app's name is self-asserted, so the return host is the one fact
   that says where the access goes. Owners see it too, since their approval covers the workspace.
   Request approval needs no tick (it grants nothing); loopback redirects keep their own warning.
   - **Allow access** posts `POST /api/mcp/authorize/code` with the AppFlowy access token, shows
     the done view and navigates to the returned `redirect_url` (it carries `code`, `state` and
     `iss`; codes expire after 60 seconds).
   - **Approve and allow** (an owner, for an app not approved in the workspace) approves the app
     (`PUT /api/mcp/admin/workspaces/{id}/approvals?client_id=`), then allows.
   - **Request approval** (a member in the same situation) sends an access request
     (`POST /api/mcp/me/workspaces/{id}/access-requests`) that owners see in Settings → MCP. A
     pending request disables the button.
7. **Cancel** posts `POST /api/mcp/authorize/deny`; the server validates the client and redirect URI
   and returns the `access_denied` redirect (with `state` and `iss`), so a crafted link cannot turn
   the page into an open redirect. If that call fails, the page shows an error and stays put.

How the consent page reacts to a failure (`McpApiError.reason`):

| Reason | Result |
| --- | --- |
| `client_not_approved`, `already_approved` | The member status is reloaded and the matching approval controls appear |
| `not_workspace_owner` (approving) | The status is reloaded; inline message |
| `rate_limited`, `temporarily_unavailable`, `server_error`, `request_limit`, no response | Inline message; the consent view and its buttons stay |
| `invalid_session` | Sign in again when the stored session ended (its refresh was rejected); otherwise an error view, since redirecting a still-signed-in user to `/login` would bounce straight back |
| `email_not_allowed`, `guest_not_allowed`, `not_workspace_member`, `unknown_client`, `invalid_redirect_uri`, `invalid_target`, `invalid_scope`, `client_blocked`, `invalid_request` | Error view (`data-testid="mcp-consent-error"`, `data-reason`) |
| `mcp_disabled` (HTTP 503 from the client lookup, the member status or any action, or a member status with `enabled: false`, which wins over every other status blocker) | Error view "AI app connections are turned off on this AppFlowy server. Ask your administrator." without Try again, Cancel or another account (see [Enable MCP switch](#enable-mcp-switch)) |

Messages come from `mcp.consent.errors.<reason>` through `consentErrorMessageKey` in
`src/components/mcp/consent/consentModel.ts` (`generic` for anything else). A malformed request
(missing or repeated parameter, `response_type` other than `code`, PKCE other than `S256`, or a
`redirect_uri` the browser must not open) shows `invalid_request` and never redirects: its
`redirect_uri` has not been validated by the server. Inside a frame the page renders only the
`framed` message and loads nothing.

Error views of a request that parsed (for example `email_not_allowed`, `guest_not_allowed`,
`not_workspace_member`, `no_workspace`, `client_blocked`, `invalid_scope`, `invalid_target`, or a
load failure) also offer **Cancel and return to {app}** (`mcp-consent-error-cancel`; just "Cancel"
when the app's name is unknown). It posts the same server-validated deny as the consent view's
Cancel, shows **Request cancelled** and follows the returned `access_denied` redirect, so the AI
app stops waiting instead of timing out. It is not offered for `unknown_client` and
`invalid_redirect_uri` (the deny refuses both), for `mcp_disabled` (while AI app connections are
off the server refuses the deny too), without an MCP service, or on the error of a failed Cancel
from the consent view. If the server refuses the deny because of the request itself, the button
disappears for the rest of the flow and the message stays; a transient failure (`rate_limited`,
`temporarily_unavailable`, `server_error`, generic) keeps the button with a note
(`classifyDenyFailure`, `isCancellableConsentReason`, `useMcpConsent.cancelFromError`).

The page is split into `src/pages/McpAuthorizePage.tsx` (framing, request parsing, configuration,
sign-in, the expired view), `src/application/mcp/consentUrl.ts` (the consent path and the expired
view's URL, built by the sign-in continuation and parsed by the page) and
`src/components/mcp/consent/`: `consentModel.ts` (pure rules),
`useMcpConsent.ts` (loading, one action at a time, the done view before `window.location.assign`)
and the views.

### Sign-in continuation

A consent request must survive one sign-in but not resurface after a later, unrelated one, so it
never goes through the generic `redirectTo` persistence (localStorage, no expiry). It reuses the
public Forms continuation in `src/application/session/sign_in.ts`, generalized to flow-bound
destinations (`AuthContinuationKind`: public Form links and MCP consent requests):

- `saveMcpConsentRedirectTo(consentUrl)` keeps the whole consent URL in this tab's
  `sessionStorage` (`mcpConsentAuthContinuation`) behind a random 128-bit flow ID, for
  `MCP_CONSENT_AUTH_CONTINUATION_TTL_MS` (10 minutes). That bound is the Web's own: the MCP service
  keeps nothing for a request on its way to the consent page (Allow revalidates every parameter),
  so the TTL only guesses when the AI app has given up on its authorization.
  `buildLoginUrl({ redirectTo: consentUrl })` then yields `/login?force=true&mcpAuth=<flowId>`:
  the OAuth parameters stay out of login and auth callback URLs (history, access logs, referrers).
  `force` keeps the login form up for a cached session, as when switching accounts.
- Only a URL carrying the flow ID resumes it: the login steps, and `/auth/callback?mcpAuth=…` for
  SSO, OIDC, SAML and magic links (`getAuthCallbackUrl`). A magic link opened in another tab has no
  session storage; it tells the originating tab over a `BroadcastChannel`
  (`appflowy-mcp-consent-auth`), which then continues. A recovery code entered during the flow
  continues through the new-password form, and the sign-in after the reset returns to the request.
- After sign-in, `afterAuth` returns to the consent URL only while the flow is valid. Past the TTL
  it lands on the consent page's expired view, `/oauth/mcp/authorize?expired=1&client_id=…`
  (`mcp-consent-expired`): "This request expired. Return to {app} and start again.", naming the
  app from the public client description, or "your AI app". The login stays bound to an expired
  request (`getRedirectTo`) precisely so this view can be shown.
- A login from a URL without the flow ID (a plain `/login`, another destination) cancels the
  continuation; a consent URL that an older build left in `localStorage` is discarded. One
  flow-bound sign-in exists per tab: starting one replaces any other.

## Setup guide

`McpSetupGuide` (`src/components/mcp/McpSetupGuide.tsx`, parts in `src/components/mcp/setup/`)
is the same on Settings → MCP and on the public `/oauth/mcp/setup` page. From the top:

- **Server URL** with Copy (`mcp-endpoint-value`, `mcp-copy-endpoint`).
- No **Copy setup prompt** row: the guide does not offer it. `buildMcpSetupPrompt` in
  `src/application/mcp/setupPrompt.ts` stays (versioned by `MCP_SETUP_PROMPT_VERSION`), because the
  golden file Desktop checks against (`__tests__/setupGolden.test.ts`) still covers it.
- No separate list of connected apps: the cards' **Connected** badges (below) say which gallery
  apps are connected, and Settings lists every connection under Your connections. The badges
  appear only when the caller's connections are passed (Settings; the public page knows no
  workspace). `summarizeConnectedApps` in `src/application/mcp/setupApps.ts` counts every device
  and registration of a recognized app once (`app:<app_id>`); other clients group by their own
  name, else their client ID.
- **App gallery** (`mcp-setup-gallery`): Claude, ChatGPT, Claude Code, Codex, VS Code and Other
  app (`MCP_SETUP_APPS`). Cursor, Gemini CLI and Windsurf / Antigravity have no card on Web (they
  connect through Other app); Desktop still shows them, and their builders stay in
  `src/application/mcp/setup.ts` for the golden file. Each card has a lettered
  tile (no third-party logos), a one-line description, one primary action (Open Claude / Open
  ChatGPT in a new tab, the VS Code install deeplink, or Copy command / URL)
  and a **Connected** badge when one of the connections has the card's verified catalog `app_id`
  (`claude`, `chatgpt`, `claude-code`, `codex`, `vscode`) with `verified_app: true`
  (see [App identity](#app-identity)). A self-asserted client name never earns the badge, Other
  app never shows it (its clients are not recognizable), and a catalog app without a card (Cursor)
  badges nothing. Clicking a card (or its action) expands its steps below the
  card's row, one card at a time (`mcp-client-tab-<app>` with `aria-expanded`,
  `mcp-client-panel-<app>`); the grid packs densely so the rest of the row stays in place.
- No **Having trouble?** section.

The vendor steps follow each vendor's documentation as of 2026-11 (the Notion parity research
lists the sources): Claude's Customize → Connectors → + Add → Add custom connector with "Sign in
now" and "Use Claude's published identity (Recommended)", plus Organization settings → Connectors
→ Add → Custom → Web for Team and Enterprise owners; ChatGPT's custom app or custom MCP server
under Settings → Apps (Plugins on some plans), worded loosely because the labels vary by plan,
plus the admin note for Business, Enterprise and Edu; Claude Code's `--scope user` / `--scope
project`; Codex's `codex mcp login`, `config.toml` (user and project) and the app/IDE path.
Re-check them with vendor releases. Translated text
marks commands and paths with backticks, which `RichText` renders as inline code.

## Settings → MCP

The menu item appears once the MCP service's URL is known (`useMcpConfiguration`, see
[MCP service URL](#mcp-service-url)). `?setting=AI_APPS` opens it, also through
`/app?setting=AI_APPS` (`MCP_SETTINGS_PATH`, which `AppWorkspaceRedirect` keeps); while server-info
is still loading the deep link waits with a spinner, and it falls back to Account on a server
without MCP (see [MCP service URL](#mcp-service-url); a server that turned MCP off still names
the service, and the panel shows that it is off). `McpPanel` renders lazily with
`key={workspaceId}` and loads the member status together with the caller's own connections and
their summary across workspaces, which need nothing from it (a failed status pauses those two, and
its Retry loads them again); the owner lists wait for the status. What the panel shows follows the
member status:

- Loading shows a spinner. When the MCP service cannot answer (no response, 5xx, or a 404 without a
  reason, as from a server without these endpoints) the panel shows `mcp-panel-unavailable` with
  Retry; other failures show `mcp-panel-error` with the reason's message and Retry.
- **Turned off** (see [Enable MCP switch](#enable-mcp-switch)): when the member status says
  `enabled: false`, or its request fails with 503 `mcp_disabled`, the panel shows
  `mcp-panel-disabled` ("AI app connections are turned off": ask your administrator; your
  connections are kept and work again as soon as AI app connections are back on) and **Your
  connections** below it, always, with its empty state when there are none, so anyone can still
  disconnect. Nothing else: no setup guide, approval notice, approved apps or Workspace access, and
  the owner lists are not loaded.
  This wins over an ineligible account, a 503 `mcp_disabled` gets no "unavailable" state or Retry,
  and the panel clears the owner's pending-request menu badge (approving is refused while off).
- An ineligible account (email gate or guest) sees `mcp-panel-ineligible`. Its own connections stay
  listed when it has any, so it can still revoke them, and once their list fails to load the section
  stays with its error and Retry. An owner the email gate excludes gets no Workspace access (see
  [Not in v1](#not-in-v1)), and the panel clears their pending-request menu badge.
- **Two tabs** (`mcp-tabs`, Figma Tab button as on Settings → People), for an eligible account
  only: **Connect AI apps** (`mcp-tab-connect`, the default) and **Manage AI apps**
  (`mcp-tab-manage`). Both panels stay mounted and the inactive one gets the `hidden` attribute, so
  switching keeps an expanded card, a typed client ID and scroll positions. An owner's Manage tab
  shows the pending approval request count (`mcp-tab-manage-badge`, read as "N pending approval
  requests"), like the menu badge; the panel always opens on Connect.
- **Connect AI apps**: `McpSetupGuide` with `status.endpoint` and the caller's connections in this
  workspace (for the cards' Connected badges), then "Want to bring Google Drive or Google Calendar
  into AppFlowy? Connections →" (`mcp-connections-hint`, `mcp-open-connections`), which switches
  Settings to Connections (`onOpenConnections`; left out without it); members also see a notice
  when some apps need an owner's approval. Under `verified_and_approved` (the member status's
  `approval_mode`) it says that verified web apps like Claude and ChatGPT connect without approval
  and other apps, including ones on the member's computer, need one (`approvalNoticeVerified`).
- **Manage AI apps** holds Your connections, then Approved for this workspace (members) or
  Workspace access (owners).
- **Your connections**: one row per connection, that is per device or account (token family).
  Every Settings row (`McpClientIdentity`, `app` variant) reads as three groups: the app's name
  with its trust badge beside it; its host, then the device label the app sent at sign-in
  (`mcp-my-connection-device`), as "chatgpt.com · codex-mcp-client 0.166"; then the row's own
  caption lines, here "Connected …" and "Last used …" (`last_used_at`, updated at most every 5
  minutes). The scope badge sits with Disconnect on the right; its
  tooltip says "To change access, reconnect the app" (`PanelScopeBadge`). Disconnect asks first and
  removes that device only (`DELETE /api/mcp/me/workspaces/{id}/connections?client_id=&family_id=`);
  the confirmation says other connections keep working when there are any. A legacy record without
  a family disconnects by `client_id` alone (all of that app's connections). `format.ts` holds this
  rule once for both lists and both confirmations (`mcpDisconnectRemoves`, `mcpOthersKeepWorking`;
  an owner's disconnect stays within the member). Above the list,
  "You have N apps connected across M workspaces" comes from `GET /api/mcp/me/connections`, with
  apps grouped like the setup guide's Connected badges (`summarizeConnectedApps`: once per
  recognized app, an unrecognized app once per name). The guide only knows this workspace, so the
  summary can count apps whose cards are not badged here; that is not a mismatch to fix. The summary is left out when that call fails and for an account the member
  status calls ineligible.
- **Approved for this workspace**, for members while some apps need approval and the server sends
  `approved_apps` (C5): the approved apps by name only, with "All {app} installs" for app-level
  approvals. Under `verified_and_approved` an empty list says verified web apps need no approval
  (`approvedForWorkspaceEmptyVerified`). Owners get the full list under Workspace access instead.
- **Workspace access**, for eligible owners only: the approval policy (three radios, below; the
  change can take up to 30 seconds to apply), approval requests (Approve, Dismiss), approved apps
  with their active connection counts (Revoke asks first and disconnects everyone using what the
  approval covered), every member's connections grouped by member (a header with name, email and a
  connection count, then one row per device; Disconnect filters by `client_id`, `user_uuid` and
  `family_id`; the email line is left out when the member's name is the email), approval by client
  ID, and **Disconnect all AI apps** (`mcp-disconnect-all`, asks first, then
  `DELETE .../connections?all=true`; disabled while the loaded list is empty).
  - The policy (`approval_mode`): **Verified and approved apps** (`verified_and_approved`, the
    default for a workspace that never chose: the catalog's web apps, `identity_verified`, connect
    without approval; catalog apps that run on members' computers, like Claude Code and Cursor,
    need one like any other app), **Approved apps only** (`approved_only`) and **Any app** (`any`).
  - Loosening asks first: "Allow any AI app?" for `any`, "Allow verified apps without approval?"
    for `verified_and_approved` from `approved_only`.
  - Tightening keeps working connections working: the server approves (by the acting owner) every
    app members are connected to that the new policy would refuse and returns them as
    `auto_approved_clients` in the `PUT .../settings` response. When the loaded member connections
    include such apps (`mcpClientsKeptApproved`: not covered by an approval, and for
    `verified_and_approved` not `identity_verified`), a confirmation names them first ("These apps stay
    approved so members keep working: …"); otherwise the change applies at once. After the PUT, a
    toast names the apps the server approved and the approved list reloads.
  - Approvals: approving a client the catalog recognizes approves its app (`approval_key`
    `app:<app_id>`), shown as "All {app} installs"; requests for such an app are merged and say
    "Approving covers all {app} installs." Approve sends the request's `approval_key` when it is an
    app key (`app:<app_id>`, which the server approves without looking up the registration that
    asked last, so an unreachable CIMD document cannot block it), else the request's `client_id`;
    Dismiss and Revoke send the `approval_key` the server listed. Revoking an app-level approval
    disconnects every registration of the app. The Revoke confirmation says when members can still
    connect the app: through the policy (any app, or an `identity_verified` app under
    `verified_and_approved`), or, for a per-client approval of a recognized app, through a
    remaining approval of all its installs (`mcpRemainingAppApproval`: the row whose
    `approval_key` is `app:<app_id>`), which the server keeps admitting it through.
- **Menu badge**: for owners (`Role.Owner` in the workspace list) with the MCP service known, the
  MCP menu item shows the pending request count (`settings-menu-ai_apps-badge`). When Settings
  opens it loads `GET .../access-requests` with the member status, and counts the requests only
  when the panel would show them (`mcpManagesApprovals`: AI apps on, an owner the email gate
  admits). That route answers any owner, and requests stay for 30 days, so without the status
  leftover requests would show while AI apps are off or to an excluded owner. The panel publishes
  every request list it loads or changes (`pendingRequestCount.ts`), so Approve and Dismiss update
  the badge at once, and clears it whenever its member status says the caller does not manage AI
  apps there (the same `mcpManagesApprovals` rule). The latest write wins: a publish, or a load
  started later, drops a menu load still in flight. A failed load shows no badge. Desktop's
  `McpPendingRequestCounts` follows the same rules.

An owner endpoint that answers 403 `not_workspace_owner`, `not_workspace_member` or
`email_not_allowed` (only approving and loosening the policy check the email gate) reloads the
member status, so the owner section disappears; so does any
`mcp_disabled` (`isMcpAccessLost`), which turns the panel into the turned-off view. Failed actions show
a toast: `settings.mcp.actionFailed` with the reason's consent message (the reason read as the
consent page reads it, `toConsentErrorReason`, also for errors without one), except where Settings
needs its own words (`mcpErrorText`): `not_workspace_owner` (`settings.mcp.notOwner`), and the reasons
whose consent text sends the user back to the AI app: `unknown_client`
(`settings.mcp.unknownClientId`), `invalid_request` (`settings.mcp.invalidRequest`, for example a
typed client ID over the server's 2048 bytes; the Approve by client ID input stops at 2048
characters), and the consent-only `invalid_redirect_uri` and `invalid_target` (the generic
message). A table test in `format.test.ts` checks that no reason's Settings text says "your AI
app". Tooltips render inside the panel so they stay above the MUI dialog. The hooks
(`useMcpMemberStatus`, `useMyMcpConnections`, `useMcpConnectionsOverview`,
`useMcpGovernance`) share `useMcpRequest.ts`: a new load aborts the previous one, an action's result
wins over a load still in flight and clears an earlier load's failure, and one action runs at a time.

### App identity

The server's verified app catalog (AppFlowy Cloud `mcp_context.md`) adds `app_id`, `app_name`,
`verified_app` and `identity_verified` to every client summary. A client is a catalog app only when
its CIMD client ID is one the catalog lists, or every redirect it registered is https on one
entry's hosts (an app that runs on the user's computer, like Cursor, may add loopback ones; next to
a web app's callback a loopback redirect means some local program, which is never recognized);
loopback-only registrations never are. The Web trusts `app_name` and `app_id` only with
`verified_app: true`, everywhere: the display name (`getMcpClientDisplayName`, `McpClientIdentity`),
the approval key derived for a connection (`mcpApprovalKey`) and the setup guide's Connected badges
and app grouping (`summarizeConnectedApps`). Approvals and access requests of a recognized app use
the key `app:<app_id>` (`isMcpAppApprovalKey`); every other client keeps its client ID as the key.
Approvals and requests carry their `approval_key`, which the panel reads as sent; connections carry
none, so `mcpApprovalKey` derives theirs.

Recognition alone does not prove who is asking. Claude Code, Codex, Cursor, VS Code and Raycast run
on the user's computer and receive their sign-in there (loopback or custom-scheme redirects), so any
program on that computer can use their identity (RFC 8252 §8.6). Only a web app whose sign-ins
return to its publisher's own website (Claude, ChatGPT, Perplexity) has `identity_verified: true`.
`McpClientIdentity` shows **Verified app** (with a tooltip) only for those. A recognized app that
runs on the computer keeps its catalog name but shows **Runs on your computer** with a tooltip
(`mcp-client-native-app-badge`, `settings.mcp.nativeAppTooltip`) instead, and policy previews
(`mcpModeAdmitsWithoutApproval`) treat it like any other app needing approval.

## Configuration

### MCP service URL

The Web finds the MCP service's public origin (without `/mcp`) in this order
(`getMcpConfiguration` in `mcp-api.ts`, `useMcpConfiguration` in React):

1. **`APPFLOWY_MCP_BASE_URL`** in the Web's own runtime config: an explicit override, used at once
   without asking the server. It is a runtime config key like `APPFLOWY_BASE_URL`: `dev.env`
   (`http://localhost:8002`; copy it to `.env` for `pnpm dev`), `deploy.env` (empty),
   `docker/entrypoint*.sh` (injected into `window.__APP_CONFIG__`), `src/utils/runtime-config.ts`,
   and the CI check in `.github/workflows/web_ci.yaml`. A value that is not an http(s) origin (it has
   a path such as `/mcp`, a query, a fragment or credentials) is ignored with a console warning, as
   Cloud ignores it. AppFlowy Cloud's bundled Docker Compose (`appflowy_web`) and
   Helm (`appflowy-web`) deployments set it to the MCP origin, so the Web finds the service without
   waiting for server-info; elsewhere it is optional, since server-info names the service whether
   MCP is on or off.
   It must name the origin Cloud advertises: the override wins without asking server-info, and when
   server-info is loaded anyway (inside `/app`) and names a different origin, the Web keeps the
   override and logs a console warning naming both.
2. **`mcp_url` from AppFlowy Cloud's `/api/server-info`** (web projection), set from Cloud's
   `APPFLOWY_MCP_BASE_URL` only, the same variable the MCP service reads, so one compose `.env`
   serves both. Unlike the MCP service, which falls back to `APPFLOWY_BASE_URL` for its own origin,
   Cloud never does: without the variable it knows no MCP service and advertises none.
   Cloud advertises it whenever it knows that origin and has loaded its MCP policy, whether MCP is
   on or off ([Enable MCP switch](#enable-mcp-switch)), so it is auto-discovery like `web_url`:
   while MCP is off the Web still reaches the service to show that and to let members disconnect.
   A deployment without the MCP service leaves the variable off Cloud and the Web (AppFlowy
   Cloud's bundled Compose and Helm files set both wherever they deploy MCP), so the Web treats
   MCP as not configured (item 3) and hides it.
   Settings → MCP shows the service as unavailable only when Cloud, or the Web's own override,
   names an origin where nothing answers. The value is read through
   the shared server-info snapshot (`src/utils/server-info.ts`): inside `/app` the auth layer's
   refresh loop provides it, and the public consent and setup pages run the loop themselves
   (`useMcpConfiguration({ loadServerInfo: true })`).
3. Otherwise **not configured**: Settings hides the MCP tab, both `/oauth/mcp/*` pages say AI app
   connections are not configured. A Web that relies on server-info lands here when Cloud knows no
   MCP origin, or briefly after Cloud starts, before it has loaded its MCP policy.

The answer is `loading` until server-info responds, and the consent and setup pages show a spinner
meanwhile. A failed request keeps it loading while the loop retries, with `retrying` set, and the
spinner then says the AppFlowy server can't be reached and the page keeps trying
(`mcp.serverInfoRetrying`); a signed-out user is sent to sign in only once it answers.
`unsupported` (a server without `/api/server-info`) means not configured. Once server-info has
answered, a later refresh that fails or is pending keeps that answer, so an open page does not lose
the service on a transient error. The Web never derives the URL from its own `APPFLOWY_BASE_URL`,
and neither does Cloud.

**MCP service** — for the browser flow to work:

- `APPFLOWY_MCP_BASE_URL` is the service's own public origin: the OAuth issuer (`iss`) and the
  canonical resource `<origin>/mcp`. AppFlowy Cloud reads the same variable, and only that one,
  to advertise `mcp_url`; a Web override, if any, must name the same origin.
- `APPFLOWY_WEB_URL` must be the Web origin. Unset, it defaults to the MCP origin, consent redirects
  land on the MCP service itself and the service logs a startup warning. It also builds the
  `resource_documentation` link (`/oauth/mcp/setup`) and the server icon.
- `APPFLOWY_CORS_ALLOWED_ORIGINS` must include the Web origin when it is set (empty or `*` mirrors
  any origin and logs a warning). The service exposes `Retry-After` to the browser.
- Self-hosted compose and Helm deployments serve the MCP service on AppFlowy's own domain (the
  bundled nginx sends `/mcp`, `/api/mcp` and the OAuth discovery documents to `appflowy_mcp`;
  `/oauth/*` stays on the Web), so AppFlowy Cloud's `deploy.env` sets
  `APPFLOWY_MCP_BASE_URL=${APPFLOWY_BASE_URL}` and users paste `https://<domain>/mcp`. See
  AppFlowy Cloud's deployment docs. A separate MCP origin also works with the `APPFLOWY_WEB_URL`
  and `APPFLOWY_CORS_ALLOWED_ORIGINS` settings above.
- Who can use AI apps (the email gate) is set in AppFlowy-Admin → AI apps (MCP): **Everyone** or
  **Only these domains and people** (allowed email domains and exact emails). Until an admin saves
  it there, `APPFLOWY_MCP_ALLOWED_EMAIL_DOMAINS` and `APPFLOWY_MCP_ALLOWED_EMAILS` bootstrap it; with
  both empty (the default) every account may connect AI apps. Accounts outside the lists see "AI
  apps aren't available for your account" in Settings and `email_not_allowed` on the consent page.
  The gate fails closed: a server that cannot load its MCP policy answers 503 (reason
  `policy_unavailable`, which the Web reads as temporarily unavailable) instead of admitting
  everyone. (Servers before 2026-11 defaulted to the `appflowy.io` domain.)
- `MCP_ALLOWED_CLIENT_IDS`, when set, blocks every other client (`client_blocked`).
- A workspace that never chose an approval policy admits verified and approved apps
  (`verified_and_approved`: the catalog's web apps without approval, every other app once approved);
  one that turned "require approval" on before policies existed reads as approved apps only, and one
  that turned it off as any app.

### Enable MCP switch

MCP has one server-wide switch, **Enable MCP** on AppFlowy-Admin's MCP page (`/mcp-server`), next
to the email gate and the MCP rate limits. MCP is on by default, and an administrator can turn it
off (or back on) there. Cloud keeps the choice as `mcp_enabled` in its system config (section
`mcp`, written only through `PUT /api/admin/mcp/policy`, with a change history): a saved value
always decides, a saved value Cloud cannot read keeps MCP off, and the MCP service picks a change up
within seconds. No environment variable turns MCP on or off.

A self-hosted server serves MCP only with a One, Team or Enterprise license, and Admin shows the
MCP page only then. Without one (no license, Seed, or an expired license) MCP refuses exactly as
while it is turned off, below, with an `error_description` that names the license. Hosted AppFlowy
Cloud is always licensed.

Cloud's server-info says so in `mcp_status` (`enabled`, `disabled`, or `license_required`;
`getMcpServerStatus` reads it and treats a value it does not know as unknown). Cloud sends
`mcp_status` only where MCP is deployed (it knows an MCP origin): a deployment without the MCP
service sends neither `mcp_url` nor `mcp_status`, so Settings hides the MCP tab there whatever the
license. With `license_required`, Settings shows the MCP tab even without an MCP URL (as before
Cloud has loaded its MCP policy), and the panel asks for a
license upgrade ("Upgrade required", as for the other features a license unlocks) instead of
offering setup or the turned-off notice. The member's own connections stay listed when the MCP
service answers, so they can still be disconnected.

After an upgrade, MCP is on (self-hosted: only with a One, Team or Enterprise license) unless an
administrator saved the switch in Admin, which keeps deciding. No environment variable turns MCP
on or off; to keep it off, turn it off in Admin.

While it is off:

- The MCP service answers HTTP 503
  `{ "error": "mcp_disabled", "error_description": "AI app connections are turned off on this AppFlowy server.", "reason": "mcp_disabled" }`
  on the MCP transport, discovery documents, client registration, authorization (including
  `/authorize/code` and `/authorize/deny`), tokens, the public client lookup, access-request
  creation and approvals. Calls that only take access away keep working: the member status (with
  `enabled: false`), listing and disconnecting your own connections, owners listing and
  disconnecting member connections and revoking approvals, and token revocation.
- Connections are kept, not revoked: AI apps stop working at once and resume when MCP is turned back
  on (a token refresh while off is a temporary 503 that does not use up the refresh token).
- Cloud's server-info keeps advertising `mcp_url`, so the Web still reaches the service, through
  server-info or its own `APPFLOWY_MCP_BASE_URL`, and shows the turned-off states: the consent
  page's `mcp_disabled` error view (see the reasons table above) and the Settings notice with Your
  connections (see [Settings → MCP](#settings--mcp)).

The Web reads the state from the member status's `enabled` and from the `mcp_disabled` reason
(`isMcpDisabledError`), never from the description text.

## HTTP client

`src/application/services/js-services/http/mcp-api.ts` (re-exported from
`src/application/services/domains/mcp.ts` and as `McpService` from `src/application/services/domains`):

- Uses `fetch`, not the shared axios instance, whose interceptor treats any 401 as an expired
  AppFlowy session and rotates the refresh token. The MCP service answers 401 only for a bad token
  (`reason: "invalid_session"`) and refuses with other 4xx/5xx statuses and a machine `reason`.
- Sends `Authorization: Bearer <GoTrue access token>`, refreshing the session first when the token
  expires within 30 seconds, and refreshes once more and retries once on 401 `invalid_session`.
  Every token it sends must belong to the user who sent the first attempt: the token store is
  shared between tabs, so after another tab signs in as someone else the call fails with
  `invalid_session` instead of acting as them. A confirmed refresh-token rejection ends the session
  like the axios interceptor does.
- Reads responses as the MCP service serializes them (the wire types mirror its structs): a
  missing or malformed list is an `invalid_response` failure, never an empty list, and an approval
  policy this Web does not know reads as undefined (Workspace access then says so instead of
  showing the policy choices). Timestamps have one form per field, Unix
  seconds or RFC 3339 (`mcpTimestampToDate`).
- Never sends the GoTrue refresh token. (Earlier prototypes forwarded it; MCP refreshing the same
  rotating token triggers GoTrue reuse detection and logs the user out of the Web app.)
- Client IDs travel in the query string (`?client_id=`), never in a path segment: CIMD client IDs are
  URLs, and some proxies decode `%2F`.
- Errors are `McpApiError { status, error, reason, description }`. `status` 0 means no
  response (`error`: `network_error`, `timeout`, `not_configured`, `session_refresh_failed`) or a call
  refused before sending (`invalid_request`). Show localized text for `reason`, never `description`.
  Reasons this Web does not know are dropped; a body without a known one gets its reason from its
  `error` (`mcp_disabled`) or its status (429 `rate_limited`, 502/503/504 `temporarily_unavailable`,
  other 5xx `server_error`), so a 503 `policy_unavailable` reads as temporarily unavailable.
  Helpers: `isMcpServiceUnavailable` (false for `mcp_disabled`, where the service answered, and for
  `session_refresh_failed`, where it was never asked), `isMcpDisabledError`, `isMcpAbortError`.
  Every call takes an optional `{ signal }`; aborting rejects with the fetch `AbortError`.
- `redirect_url` responses are rejected unless `isSafeMcpRedirectUrl` accepts them (no
  `javascript:`, `data:` and similar), because CIMD documents may register any redirect URI.

| Function | Request |
| --- | --- |
| `getMcpClientInfo` | `GET /api/mcp/clients?client_id=` (public) |
| `createMcpAuthorizationCode` | `POST /api/mcp/authorize/code` |
| `denyMcpAuthorization` | `POST /api/mcp/authorize/deny` (public) |
| `getMcpMemberStatus` | `GET /api/mcp/me/workspaces/{id}[?client_id=]` |
| `listMyMcpConnections`, `disconnectMyMcpConnection` | `GET`, `DELETE /api/mcp/me/workspaces/{id}/connections[?client_id=&family_id=]` (`{ familyId }` disconnects one device) |
| `listMyMcpConnectionsAcrossWorkspaces` | `GET /api/mcp/me/connections` → `{ connections (+ workspace_id), workspace_count, connection_count }` |
| `createMcpAccessRequest` | `POST /api/mcp/me/workspaces/{id}/access-requests` |
| `getMcpWorkspaceSettings`, `updateMcpWorkspaceSettings` | `GET`, `PUT /api/mcp/admin/workspaces/{id}/settings`. The PUT sends `{ approval_mode }` alone and also returns `auto_approved_clients`, with their approval keys |
| `approveMcpClient`, `revokeMcpClientApproval` | `PUT`, `DELETE /api/mcp/admin/workspaces/{id}/approvals?client_id=` (approve takes the request's `client_id`, or its app-level `approval_key` `app:<app_id>`; revoke takes the entry's `approval_key`, e.g. `app:cursor`) |
| `listMcpWorkspaceConnections`, `disconnectMcpWorkspaceConnections` | `GET`, `DELETE /api/mcp/admin/workspaces/{id}/connections[?client_id=&user_uuid=&family_id=]` (refuses to send without `client_id` or `user_uuid`) |
| `disconnectAllMcpWorkspaceConnections` | `DELETE /api/mcp/admin/workspaces/{id}/connections?all=true` |
| `listMcpAccessRequests`, `dismissMcpAccessRequest` | `GET`, `DELETE /api/mcp/admin/workspaces/{id}/access-requests[?client_id=]` (dismiss takes the request's `approval_key`) |

Pure helpers live in `src/application/mcp/setup.ts`: install links, commands and configs per client,
scope parsing (`parseScopes`, `scopeLevel`), `safeHttpUrl`, `describeRedirectUri`,
`getMcpClientDisplayName`, and the Web paths `MCP_SETUP_PAGE_PATH` (`/oauth/mcp/setup`, used by the
setup prompt and the consent page's Learn more link) and `MCP_SETTINGS_PATH`; the setup gallery's
cards and connected-app summary in `setupApps.ts`; the setup prompt in `setupPrompt.ts`. Shared UI
lives in `src/components/mcp/`: `McpClientAvatar`, `McpClientIdentity` (name, host, Verified app /
Verified domain / Not verified, Runs on your computer), `McpScopeBadge` and `McpSetupGuide` (see
[Setup guide](#setup-guide)).

## Security notes

- `/oauth/*` HTML is served with `X-Frame-Options: DENY` and
  `Content-Security-Policy: frame-ancestors 'none'` by the Bun server (`deploy/routes.ts`,
  `FRAME_DENY_PATHS` in `deploy/app-paths.ts`), by the nginx-only image (`location ^~ /oauth/` in
  `docker/nginx.conf`) and by `vercel.json`. The SSR image's nginx proxies `/oauth/*` to Bun. The
  consent page also refuses to render inside a frame. Any other hosting must add the same headers.
- The consent page renders only at its canonical path, `/oauth/mcp/authorize` with optional
  trailing slashes (`isMcpConsentPathname`), and NotFound at any other spelling React Router would
  match, such as `/%6Fauth/mcp/authorize`: a host's header rule (Vercel's `/oauth/(.*)`) may not
  cover it. Sign-in treats only the canonical path as a consent request. The MCP service always
  redirects to the canonical path.
- `/oauth` is an app path: SSR serves the SPA shell instead of looking up a publish namespace, and
  the indexing policy refuses to server-render a namespace named `oauth`. Cloud should reserve that
  publish namespace: a workspace that already claimed it loses its default page (`/oauth`) and
  server rendering; its `/oauth/<page>` pages still render client-side.
- The consent page only navigates to URLs the server returned: the code redirect, or the validated
  `access_denied` redirect. It never falls back to the request's raw `redirect_uri`.
- A consent request waiting for sign-in lives only in that tab's session storage, for 10 minutes,
  behind an opaque flow ID; login and callback URLs never carry its OAuth parameters, and a login
  outside that flow cancels it (see [Sign-in continuation](#sign-in-continuation)).
- The GoTrue refresh token never leaves the browser's session (see HTTP client).
- Client logos are third-party URLs: only http(s) is loaded, with `referrerPolicy="no-referrer"`
  (the consent URL carries OAuth parameters).
- A DCR client's name is self-asserted; the UI shows the host and "Not verified" for it. CIMD
  clients show "Verified domain" because their metadata comes from the client ID's own https host.
  Only the server's catalog lets an app's `app_name` replace the registered name, and only a
  catalog app whose identity the server proves (`identity_verified`) reads "Verified app"; one
  that runs on the user's computer reads "Runs on your computer". A redirect to this computer
  (loopback) shows "Runs on your computer" and a
  warning to continue only when the user started the connection; an unrecognized DCR app returning
  to another https host needs the "I recognize {host}" tick before Allow or Approve and allow.
- App and member names are server data: React renders them as text, and the i18next calls that
  interpolate them disable i18next's own escaping instead of rendering HTML (`RAW_INTERPOLATION`,
  defined once in `src/components/mcp/rawInterpolation.ts` for the consent page, the setup guide
  and Settings → MCP).

## Testing

Unit tests (Jest, colocated `__tests__`):

```bash
pnpm exec jest --runInBand --no-coverage \
  src/application/mcp \
  src/application/session \
  src/application/services/js-services/http/__tests__/mcp-api.test.ts \
  src/components/mcp \
  src/components/app/settings/mcp \
  src/components/app/settings/__tests__/Settings.mcp.test.tsx \
  src/components/app/__tests__/AppWorkspaceRedirect.test.tsx \
  src/components/main/__tests__/MainAppRoutes.mcp.test.tsx \
  src/pages/__tests__/McpAuthorizePage.test.tsx \
  src/pages/__tests__/McpSetupPage.test.tsx \
  src/pages/__tests__/LoginPage.mcp-consent.test.tsx \
  src/pages/__tests__/LoginPage.form-redirect.test.tsx \
  deploy/routes.test.ts deploy/publish-ssr.test.ts
```

Jest only transpiles test files, and `pnpm type-check` leaves them out, so `pnpm
type-check:mcp-tests` (`tsconfig.mcp-tests.json`, also run by Web-CI) type-checks the MCP test files
against the wire types: a fixture missing a field the server always sends fails there.

| Suite | Covers |
| --- | --- |
| `src/application/mcp/__tests__/setup.test.ts` | Install links, commands and configs (exact strings, TOML escaping, Cursor's `appflowy` name), scopes, URL helpers |
| `setupApps.test.ts`, `setupPrompt.test.ts` | Card order and catalog mapping; connected apps counted per app, never matched by a self-asserted name; the setup prompt's version, commands, browser steps, `get-self` check and setup page link |
| `mcp-api.test.ts` | Bearer header, no refresh token in any body, query-form client IDs, error mapping, refresh and retry once on 401, owner disconnect refusing an empty filter, URL resolution order (override, server-info `mcp_url`, not configured), loading, keeping the answer through failed refreshes, `auto_approved_clients`, the approval policy body (`approval_mode` alone), server-shaped fixtures, a missing list rejected as `invalid_response`, an unknown approval policy read as undefined in the member status and the settings, retries bound to the same user, per-device (`family_id`) and `all=true` disconnects, app-level keys (approve, revoke, dismiss), connections across workspaces, `approved_apps`, `mcpApprovalKey`, `mcp_disabled` (from the reason or the error code) kept apart from outages |
| `src/application/session/__tests__/sign_in.test.ts` | Form and MCP consent continuations: OAuth parameters kept out of login and callback URLs, return within the TTL, expired view after it, unrelated later login, cross-tab magic link, password recovery, legacy cleanup, only the canonical consent path (not case or percent-encoded variants) |
| `src/components/mcp/**` | Identity badges; setup guide: cards and their actions, one expanded card after its own card, every snippet and copy, Connected badges, no setup prompt or Having trouble?, inline code in translated text; consent model rules (`mcp_disabled`: fatal, first status blocker, no retry, Cancel or account switch), `useMcpConfiguration` |
| `McpAuthorizePage.test.tsx` | Invalid requests, not configured, waiting for server-info, flow-bound sign-in, expired view, identity, read-scope disclosure, workspace roles, guest workspaces, approve and allow, access requests, deny, Cancel from error views, allow body, reason views, framing, NotFound at a percent-encoded path, Learn more link, read-only hint, Verified app (web apps only; an app on the computer is not called verified), the "I recognize {host}" tick (Allow, Approve and allow, not Request approval or loopback), the turned-off view (client lookup, member status `enabled: false` or 503, Allow, Request approval, Cancel) |
| `src/components/app/settings/mcp/**` | Panel states, the Connect and Manage tabs (both mounted, the owner's pending-request count, the Connections hint), member and owner views, per-device rows (device, last used, scope tooltip), summary across workspaces (counted per app by `summarizeConnectedApps`), the setup guide's Connected badges from this workspace's connections only, members' approved apps and the policy-aware notice, approval policy radios and their confirmations (loosening, tightening with kept apps, apps on members' computers kept), app-level approvals (approving a merged request by its app key, revoking one install next to all installs), grouped member connections, Disconnect all, menu badge publication, toasts, formatting, the turned-off notice (status `enabled: false` or 503 `mcp_disabled`, Your connections kept and disconnectable, owner lists not loaded, an owner action or list answering `mcp_disabled` switching to it, menu badge cleared), the license upgrade prompt (server-info `mcp_status: license_required`, with or without a reachable MCP service) |
| `Settings.mcp.test.tsx`, `MainAppRoutes.mcp.test.tsx`, `AppWorkspaceRedirect.test.tsx` | Menu item once the URL is known, the owner's pending-request badge (gated on the member status, never overwriting the panel's count or a newer load's), deep links that wait for server-info, routes |
| `LoginPage.mcp-consent.test.tsx`, `LoginPage.form-redirect.test.tsx` | The login page resuming only its own flow, legacy `redirectTo` queries moved into the continuation |
| `deploy/routes.test.ts`, `deploy/publish-ssr.test.ts` | `/oauth` as an app path and its anti-framing headers (Web-CI's docker-runtime-test also fetches `/oauth/mcp/authorize` from both images and checks them) |

`jest.config.cjs` ignores test paths containing `/.claude/`; when running from a checkout under such
a directory (an agent worktree), add `--testPathIgnorePatterns '/node_modules/'` after the test
paths. Placed before them, the option swallows the paths and Jest runs the whole suite.

End to end, `playwright/e2e/mcp/oauth-consent.spec.ts` signs up an owner, registers a DCR client
with a loopback callback, consents through the Web page (narrowing the scope to read, approve and
allow), exchanges the code with `resource`, lists tools, finds the connection in Settings → MCP,
disconnects it and checks that the old token is refused. A second test cancels and expects
`access_denied` with `state` and `iss`. It needs:

- A running Cloud stack (Cloud API, GoTrue) plus the MCP service, with MCP on (the default, unless
  an administrator turned it off in AppFlowy-Admin; a self-hosted build also needs a One, Team or
  Enterprise license). The MCP service's `APPFLOWY_WEB_URL` must be the Web origin under test, its
  CORS must allow that origin, and its email gate must admit the test users
  (`<uuid>@appflowy.io`): leave both allowlists empty (the default) or include `appflowy.io`.
- The Web app at `BASE_URL` (default `http://localhost:3000`) that knows the MCP URL: from Cloud
  server-info (`mcp_url`), or from `APPFLOWY_MCP_BASE_URL`, either in `.env` (`pnpm dev`) or at
  runtime: when `APPFLOWY_BASE_URL`, `APPFLOWY_GOTRUE_BASE_URL` and `APPFLOWY_WS_BASE_URL` are set
  for the test run, the sign-in helper injects them, and `APPFLOWY_MCP_BASE_URL` too, into
  `window.__APP_CONFIG__`.
- For the runner (`playwright.config.ts` also reads `.env`): the usual `APPFLOWY_BASE_URL`,
  `APPFLOWY_GOTRUE_BASE_URL`, `GOTRUE_ADMIN_EMAIL` and `GOTRUE_ADMIN_PASSWORD` for creating test
  users, plus `APPFLOWY_MCP_BASE_URL` (default `http://localhost:8002`).

```bash
APPFLOWY_MCP_BASE_URL=http://localhost:8002 \
  pnpm exec playwright test playwright/e2e/mcp/oauth-consent.spec.ts --workers=1
```

`playwright/e2e/mcp/connect-and-create-pages.spec.ts` walks the whole user journey from what Web
shows. It copies the MCP server URL from Settings → MCP (checking the clipboard), then connects
with that URL alone, the way an AI app does:

1. `401` from the copied URL, then the `resource_metadata` in its `WWW-Authenticate` header.
2. The protected-resource metadata, whose `resource` must be the copied URL.
3. The authorization-server metadata.
4. Dynamic client registration.
5. The Web consent page (approve and allow), then the token exchange.
6. An MCP session (`initialize`, `notifications/initialized`, `tools/list`) on the copied URL.

It then calls `create-pages` (a document with content and a grid) and finds both in Web, the
document open with its content and both in the sidebar. Last, it checks the app is listed under
"Your connections". The spec itself reads no `APPFLOWY_MCP_BASE_URL`: it uses whatever URL the
Web under test shows, so it needs the same stack as above with Web knowing that stack's MCP origin.
A stray value wins over server-info there: the runner and a Vite-served Web both read `.env`, and a
`.env` copied from `dev.env` points at `http://localhost:8002`. Set `APPFLOWY_MCP_BASE_URL` to the
stack's MCP origin for the run; the sign-in helper injects it at runtime, over the `.env` and build
values. For one origin behind the bundled Nginx (Web, Cloud and MCP all on
`http://localhost:18180`):

```bash
BASE_URL=http://localhost:18180 APPFLOWY_BASE_URL=http://localhost:18180 \
  APPFLOWY_GOTRUE_BASE_URL=http://localhost:18180/gotrue \
  APPFLOWY_WS_BASE_URL=ws://localhost:18180/ws/v2 \
  APPFLOWY_MCP_BASE_URL=http://localhost:18180 \
  pnpm exec playwright test playwright/e2e/mcp/connect-and-create-pages.spec.ts --workers=1
```

CI does not run these: `playwright/e2e/mcp` is in none of the groups in
`.github/playwright-groups.json`, and the CI backend has no MCP service. Both specs take the
client side of OAuth (loopback callback, PKCE, metadata reads that fail unless served, code
exchange) from `playwright/support/mcp-oauth-helpers.ts`, whose Jest test does run in CI.

## Not in v1

Mobile UI (Desktop has Settings → MCP in AppFlowy-Premium #1555); inbox or email notifications for
approval requests (owners get the Settings menu badge); audit events for consent and workspace
governance (changes to the server-wide MCP policy are recorded by Cloud and shown in
AppFlowy-Admin); approvals by publisher domain for apps outside the verified catalog; renaming apps;
sorting member connections by last use; owners' member connections and approvals in Settings while
AI app connections are turned off or for an owner the MCP email allowlist excludes (the server
still lets owners list and disconnect member connections and revoke approvals then, but the panel
shows only the caller's own connections).
