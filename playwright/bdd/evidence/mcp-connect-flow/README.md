# AI apps (MCP) connect flow: screenshot evidence

| File | Shows |
| --- | --- |
| `01-owner-settings-ai-apps-off.png` | Settings → MCP while AI apps are turned off, the default until an administrator turns them on |
| `02-consent-ai-apps-off.png` | The consent page when AI apps are turned off |
| `03-owner-consent.png` | A workspace owner approving and allowing an AI app that runs on their computer |
| `04-owner-settings.png` | Settings → MCP with the server URL copied, and setup cards for each AI app |
| `05-web-pages-created-by-ai-app.png` | A document and a grid that the AI app created through MCP, open in AppFlowy Web |
| `06-member-request-sent.png` | A member's approval request for an unapproved AI app |
| `07-owner-reenable-approval-confirm.png` | The confirmation shown when an owner requires approval again; apps already connected keep working |
| `08-public-setup.png` | The signed-out setup page at `/oauth/mcp/setup` |
| `09-owner-settings-off-connections-kept.png` | AI apps turned off again: the connection is kept and can still be disconnected |

Provenance: `capture.spec.ts` in this directory wrote all nine files in one run on 2026-11-03,
through its own config, `capture.config.ts` (headless Chromium, 1360×900, device scale 1). 03 grows
the viewport to the consent card's height (1360×1189), so the frame includes the approval notice and
Approve and allow. The run used a local stack on a single origin, `http://localhost:18180`, behind
nginx: AppFlowy Cloud and the MCP service built from AppFlowy-Cloud-Premium PR #1521 at commit
`97d942b1a`, and AppFlowy Web from this branch's Vite dev server at `b7a6772a`, after the branch was
rebased onto main (`75584790`). The run signs up a fresh owner and a fresh member in a disposable
database. The owner's new workspace gets the Pro fixture subscription
(`grantWorkspaceProSubscription`), because the hosted build allows a Free workspace only one member.

The script switches AI apps through `PUT /api/admin/mcp/policy` with `expected_revision`. That
stack's Cloud is a hosted build, whose plan has no MCP tab, so the API answered 403
`mcp_not_entitled`. The script then wrote the same `af_system_config` row (`mcp_enabled`) through
`docker exec … psql`, and put the starting value back at the end (`true` on that stack). The owner
changes the workspace's approval policy (06, 07) in Settings → MCP. The journey:

1. AI apps off: Settings → MCP (01), and a consent request that reaches the page (02).
2. AI apps on: the owner approves and allows `Claude Code (e2e)`, a local app on a loopback
   redirect (03), copies the server URL in Settings → MCP (04), and the app creates a document and
   a grid through `create-pages` that open in Web (05). Given no parent, `create-pages` puts them in
   the workspace's oldest space. A new workspace creates General and Shared in the same second, so
   they can land in either one (Shared in this run). The signed-out setup page (08).
3. A member asks for approval of `Gemini CLI (e2e)` (06). The owner turns on Any app, the member
   connects it, and the owner requires approval again (07).
4. AI apps off again: the owner's connection is kept (09).

To rerun it (only against a disposable stack: it turns AI apps off and on for the whole server):

```sh
BASE_URL=http://localhost:18180 APPFLOWY_BASE_URL=http://localhost:18180 \
APPFLOWY_GOTRUE_BASE_URL=http://localhost:18180/gotrue APPFLOWY_WS_BASE_URL=ws://localhost:18180/ws/v2 \
APPFLOWY_MCP_BASE_URL=http://localhost:18180 GOTRUE_ADMIN_EMAIL=… GOTRUE_ADMIN_PASSWORD=… \
APPFLOWY_TEST_POSTGRES_CONTAINER=<the stack's postgres container> \
pnpm exec playwright test -c playwright/bdd/evidence/mcp-connect-flow/capture.config.ts
```

No CI job or e2e suite runs it: no other Playwright config reaches this directory.

Also rerunnable: the specs in `playwright/e2e/mcp` (see `doc/MCP.md`) cover an owner approving,
connecting, using and disconnecting a local app, Cancel returning `access_denied`
(`oauth-consent.spec.ts`), and copying the URL from Settings → MCP, connecting with it and creating
pages that appear in Web (`connect-and-create-pages.spec.ts`). They capture none of these files.
