# AI apps (MCP) connect flow: screenshot evidence

| File | Shows |
| --- | --- |
| `01-owner-settings-ai-apps-off.png` | Settings → MCP after an administrator turns MCP off in Admin (MCP is on by default) |
| `02-consent-ai-apps-off.png` | The consent page when AI apps are turned off |
| `03-owner-consent.png` | A workspace owner approving and allowing an AI app that runs on their computer |
| `04-owner-settings.png` | Settings → MCP's Connect tab with the server URL copied, and a setup card per AI app, each with its one-click action: Add to Claude (Claude's prefilled Add custom connector link), Copy URL for ChatGPT, Copy command for Claude Code and Codex (the commands with the URL filled in), Install in VS Code, Copy URL for other apps |
| `05-web-pages-created-by-ai-app.png` | A document and a grid that the AI app created through MCP, open in AppFlowy Web |
| `06-member-request-sent.png` | A member's approval request for an unapproved AI app |
| `07-owner-reenable-approval-confirm.png` | The confirmation shown when an owner requires approval again; apps already connected keep working |
| `08-public-setup.png` | The signed-out setup page at `/oauth/mcp/setup` as a self-hosted server shows it (server-info `self_hosted: true`): the note that Claude and ChatGPT must reach the server from the internet or a vendor tunnel, and ChatGPT's steps, opened by its Copy URL, with Open ChatGPT plugins and Add custom MCP server |
| `09-owner-settings-off-connections-kept.png` | AI apps turned off again: the connection is kept and can still be disconnected |
| `10-owner-settings-license-required.png` | A self-hosted server whose license lacks MCP (server-info `mcp_status: "license_required"`): the upgrade prompt, with the connection kept |
| `11-owner-settings-claude-organization.png` | A workspace owner's Claude steps in Settings → MCP: the prefilled link's steps, the by-hand path, and in the Team and Enterprise note Add for your Claude organization, whose hint says only Owners of a Claude Team or Enterprise organization can use it |

Provenance: `capture.spec.ts` in this directory wrote all nine files in one run on 2026-11-04,
through its own config, `capture.config.ts` (headless Chromium, 1360×900, device scale 1). 03 grows
the viewport to the consent page's height (1360×1259), so the frame includes the approval notice and
Approve and allow. The run used a local stack on a single origin, `http://localhost:18180`, behind
nginx: AppFlowy Cloud and the MCP service built on 2026-11-03 at 17:48 UTC from AppFlowy-Cloud-Premium
PR #1521, right after its commit `d069a1111`, and AppFlowy Web from this branch's Vite dev server
with the design-system restyle of the MCP screens, on the merge of main `4b78f4cc` (the Figma colour
token sync, #713). The run signs up a fresh owner and a fresh member in a disposable
database. The owner's new workspace gets the Pro fixture subscription
(`grantWorkspaceProSubscription`), because the hosted build allows a Free workspace only one member.

The script switches AI apps through `PUT /api/admin/mcp/policy` with `expected_revision`. That
stack's Cloud is a hosted build, whose plan has no MCP tab, so the API answered 403
`mcp_not_entitled`. The script then wrote the same `af_system_config` row (`mcp_enabled`) through
`docker exec … psql`, and put the starting value back at the end (`true` on that stack). The owner
changes the workspace's approval policy (06, 07) in Settings → MCP. The journey:

1. AI apps off: Settings → MCP (01), and a consent request that reaches the page (02).
2. AI apps on: the owner approves and allows `Claude Code (e2e)`, a local app on a loopback
   redirect (03), copies the server URL in Settings → MCP (04), opens Claude's steps (11), and the
   app creates a document and
   a grid through `create-pages` that open in Web (05). Given no parent, `create-pages` puts them in
   the workspace's oldest space. A new workspace creates General and Shared in the same second, so
   they can land in either one (Shared in this run). The signed-out setup page (08), where
   ChatGPT's Copy URL opens its steps.
3. A member asks for approval of `Gemini CLI (e2e)` (06). The owner turns on Any app, the member
   connects it, and the owner requires approval again (07).
4. AI apps off again: the owner's connection is kept (09).
5. The owner's server-info says the license lacks MCP (10).

Frame 10 was added on 2026-11-05 by a second run of the same script with `MCP_CAPTURE_FRAMES=10`,
against the same stack and binaries, with AppFlowy Web from this branch at `fc60e5b1`. The run
writes only that file; the journey before it ran whole again. Only a self-hosted server whose
license is below One sends `mcp_status: "license_required"`, and that stack's Cloud is a hosted
build, so the step adds the status to the owner's `/api/server-info` responses in the browser
(`page.route`). Its MCP service reports itself off at that point, after 09, as an unlicensed
server's does, so the panel lists the connection under the prompt.

Frames 04 and 08 were recaptured, and frame 11 added, on 2026-11-05 by a third run of the same
script with `MCP_CAPTURE_FRAMES=04,08,11`, against the same stack and Cloud and MCP binaries, with
AppFlowy Web from this branch at `615a4e51` (the one-click connect actions), served by a freshly
started Vite dev server. The run writes only those files; the journey ran whole again. The frames
before it predated the Connect and Manage tabs. 11 expands the Claude card after 04 and scrolls the
organization link into view; it is the only frame that shows that owner-only link. That stack's
Cloud is a hosted build (`self_hosted: false`), so for 08 the step adds `self_hosted: true` to the
signed-out page's `/api/server-info` responses in the browser (`page.route`), as a self-hosted
server sends it; the public page reads server-info for that note even though this stack's Web names
the MCP service through its `APPFLOWY_MCP_BASE_URL` override. 08 grows the viewport to the page's
height (1360×1318) to include ChatGPT's steps and the cards under them. No link was opened: the
script checks the Claude links' `href`s instead.

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
