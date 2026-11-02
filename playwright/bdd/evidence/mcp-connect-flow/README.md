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

Provenance: 02, 05 and 08 were captured on 2026-11-01 by one end-to-end Playwright run (headless
Chromium). 01, 03, 04, 06, 07 and 09 were recaptured on 2026-11-02, after the Settings tab was
renamed to MCP, by one more run (1360×900). Both ran against a local stack on a single origin,
`http://localhost:18180`. AppFlowy Cloud and the MCP service
were built from AppFlowy-Cloud-Premium branch `feat/mcp-connect-flow` and served behind that
repository's bundled `nginx/nginx.conf`. AppFlowy Web came from this branch's Vite dev server. The
accounts and workspace are test fixtures in a disposable database. The run turned AI apps on and off
by writing the same system-configuration row as Admin → AI apps (MCP).
