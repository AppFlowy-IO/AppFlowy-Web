/** @jest-environment node */

/**
 * The setup texts are a byte-for-byte contract with AppFlowy Desktop, which
 * ports these builders (frontend/appflowy_flutter/lib/features/mcp/logic/
 * mcp_setup.dart) and checks them against a copy of this golden file
 * (test/features/mcp/web_setup_golden.json). Any change to a snippet, install
 * link or the setup prompt fails here first. Then:
 *
 * 1. Bump MCP_SETUP_PROMPT_VERSION if the prompt's instructions changed.
 * 2. Regenerate: UPDATE_GOLDEN=1 pnpm exec jest src/application/mcp/__tests__/setupGolden.test.ts
 * 3. Copy the file to Desktop's web_setup_golden.json and port the change there.
 */
import fs from 'fs';
import path from 'path';

import {
  buildCursorInstallUrl,
  buildMcpRemoteCommand,
  buildMcpSnippets,
  buildVsCodeInstallUrl,
  MCP_SNIPPET_IDS,
} from '../setup';
import { buildMcpSetupPrompt, MCP_SETUP_PROMPT_VERSION } from '../setupPrompt';

const GOLDEN_PATH = path.join(__dirname, '__golden__', 'setup-texts.json');

const SETUP_PAGE_URL = 'https://appflowy.com/oauth/mcp/setup';

// An ordinary URL, then ones that need shell quoting, a non-ASCII host, and
// characters that JSON and TOML escape differently.
const SERVER_URLS = [
  'https://mcp.appflowy.com/mcp',
  "https://example.com/mcp?a=1&b='x'",
  'https://mcp.exämple.com/mcp',
  'https://example.com/a"b\\c\u0001d\u007fe\tf',
];

function buildGolden() {
  return {
    source:
      "Output of AppFlowy Web's src/application/mcp/setup.ts and setupPrompt.ts for these server URLs." +
      ' Regenerate with UPDATE_GOLDEN=1 (see setupGolden.test.ts) and copy to Desktop.',
    promptVersion: MCP_SETUP_PROMPT_VERSION,
    setupPageUrl: SETUP_PAGE_URL,
    cases: Object.fromEntries(
      SERVER_URLS.map((url) => {
        const snippets = buildMcpSnippets(url);

        return [
          url,
          {
            snippets: Object.fromEntries(MCP_SNIPPET_IDS.map((id) => [id, snippets[id]])),
            cursor: buildCursorInstallUrl(url),
            vscode: buildVsCodeInstallUrl(url),
            mcpRemote: buildMcpRemoteCommand(url),
            promptWithPage: buildMcpSetupPrompt(url, { setupPageUrl: SETUP_PAGE_URL }),
            promptWithoutPage: buildMcpSetupPrompt(url),
          },
        ];
      })
    ),
  };
}

describe('MCP setup texts shared with AppFlowy Desktop', () => {
  it('match the golden file Desktop copies', () => {
    const golden = buildGolden();

    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`);
    }

    expect(JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'))).toEqual(golden);
  });
});
