# Connections settings

Settings → Connections uses the same workspace-scoped integration API as desktop for Google Drive
and Google Calendar. It lists the current user's accounts, resolves email addresses through Cloud's
provider proxy, supports additional accounts, and asks for confirmation before disconnecting one.

The HTTP adapter is `src/application/services/js-services/http/integration-api.ts`. OAuth popup
handling lives in `src/application/integrations/oauth.ts`; the settings hook owns requests and
cancels them when the panel closes or the workspace changes. Provider credentials stay in Cloud.

The panel reads the configured provider keys from `/api/server-info` alongside the account list.
Existing servers expose those keys only with `x-platform: app`; this request reads just `connections`,
without adopting native feature flags. Providers absent from that list cannot open an OAuth popup.
The panel explains their availability and offers Refresh after an administrator enables them.
Connection errors remain visible in Settings, including when popups are blocked or the network fails.

## Local provider setup

The callback change does not configure a Google OAuth application. Cloud needs a Google client ID
and client secret for `google-drive` and/or `google-calendar`.

In AppFlowy Admin, open **Settings → Connections** (`/console/integrations` with the default base
path). Copy the callback URL into a Google Cloud Web application OAuth client's authorized redirect
URIs, enable the corresponding Google APIs, then configure each provider with the client ID and
secret. Keep **Enable connection** checked and save. Each provider needs an entry even when sharing
the same Google OAuth client. This configures connected accounts separately from Google sign-in.

The admin page saves credentials through `/api/admin/integrations/providers`; Cloud encrypts the
secret in its database. Leaving the secret blank when editing preserves it. Database entries
override file configuration, including disabled entries. Removing an entry restores any file
configuration; disable it instead to prevent new connections. This does not revoke existing grants
at Google. See the Admin project's `apps/super/docs/connections.md` for setup details.

Alternatively, use a private local copy of Cloud's `integrations-providers.example.json` and set
`INTEGRATIONS_PROVIDERS_FILE` to its path before starting Cloud. This file is optional when using
the admin page. Do not commit the populated file. The obsolete `NANGO_INTEGRATIONS_FILE` variable
does not configure the native integration engine.

Register the callback URI advertised by the admin provider API in the Google OAuth application.
With `APPFLOWY_BASE_URL=http://localhost:8000`, it is
`http://localhost:8000/api/integrations/connections/oauth/callback`.

`GET /api/server-info` with `x-platform: app` reports the configured keys in `data.connections`.
An empty array means no providers are available. File changes require restarting Cloud; admin
console changes are picked up by its provider cache (up to 30 seconds across replicas). Refresh the
Connections panel afterward.

## Cloud callback requirement

Deploy with the browser handoff in Cloud's
`libs/appflowy-cloud-integrations/assets/oauth_callback.html`. This template is embedded in the
Cloud binary, so changing the file requires rebuilding/deploying Cloud. Older callback pages only
open the desktop app and cannot finish web authorization.
Merging the Cloud PR alone does not update an already-running local binary.

Web opens a popup directly from the user's click, then navigates it to Cloud's `oauth_url`.
It sends `{type: 'appflowy:integration-oauth-request', state}` only to the origin in that URL's
`redirect_uri`. The callback page must verify `event.source === window.opener`, an HTTP(S) sender
origin, and the matching OAuth state before replying to `event.origin` with
`{type: 'appflowy:integration-oauth-callback', oauth_query}`. Never send authorization codes to `*`.

Web verifies the popup, origin, and state, then submits the query unchanged to the authenticated
`POST /api/integrations/connections/callback` API. Cloud validates its pending state binding and
exchanges the code. The popup listener accepts one callback, handles denial/closure, and times out
after two minutes. Cloud retains the desktop deep-link flow for desktop launches.

## Preview

![Available connections](images/connections-light.png)

![Connected accounts in dark mode](images/connections-dark.png)

## Verification

Run `pnpm type-check` and:

```sh
pnpm exec jest --runInBand --no-coverage src/application/integrations/__tests__/oauth.test.ts src/application/services/js-services/http/__tests__/integration-api.test.ts src/components/app/settings/__tests__/ConnectionsPanel.test.tsx src/components/app/settings/__tests__/Settings.workspaceImport.test.tsx src/components/app/settings/__tests__/Settings.connections.test.tsx
```

In Cloud, run `node --test libs/appflowy-cloud-integrations/tests/oauth_callback.test.cjs`.
Live Google authorization also requires the provider credentials and exact Cloud callback URI
to be configured on the deployed server.
