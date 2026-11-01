/**
 * "Copy setup prompt": instructions an AI agent follows to connect itself to
 * this deployment's AppFlowy MCP server. The prompt is English on purpose: a
 * model reads it, like the commands it quotes. It is versioned so a pasted
 * prompt can be traced to the Web build that wrote it. See doc/MCP.md.
 */
import {
  buildClaudeCodeCommand,
  buildCodexCommand,
  buildCodexLoginCommand,
  buildGeminiCommand,
  buildMcpRemoteCommand,
  buildVsCodeCliCommand,
  MCP_SERVER_NAME,
} from './setup';

/** Bump whenever the prompt's instructions change. */
export const MCP_SETUP_PROMPT_VERSION = 1;

export interface McpSetupPromptOptions {
  /** Absolute URL of this deployment's setup page, for apps the agent can't configure itself. */
  setupPageUrl?: string;
}

/**
 * The prompt for one server URL: where the server is, how to add it to the
 * agent's own app, what the user does in the browser (sign in, choose a
 * workspace, approve, or request an owner's approval), and how to check the
 * connection (`get-self`, which returns the user's name and email).
 */
export function buildMcpSetupPrompt(url: string, { setupPageUrl }: McpSetupPromptOptions = {}): string {
  const name = MCP_SERVER_NAME;
  const config = (entry: Record<string, string>) => JSON.stringify({ mcpServers: { [name]: entry } });
  const claudeCode = buildClaudeCodeCommand(url);
  const codex = buildCodexCommand(url);
  const gemini = buildGeminiCommand(url);
  const vscode = buildVsCodeCliCommand(url);
  const bridge = buildMcpRemoteCommand(url);
  const setupPage = setupPageUrl ? `, and point me to ${setupPageUrl} for step-by-step instructions` : '';

  return [
    'Set up the AppFlowy MCP server so you can work with my AppFlowy workspace' +
      ` (AppFlowy setup prompt v${MCP_SETUP_PROMPT_VERSION}).`,
    '',
    `Server URL: ${url}`,
    'It uses Streamable HTTP with OAuth sign-in in my browser.' +
      ' There is no API key, and you never need my AppFlowy password.',
    '',
    `1. Add the server to the app you are running in, named "${name}". Use the first option that fits:`,
    `   - Claude Code: run \`${claudeCode}\`. Add \`--scope user\` to make it available in every project.`,
    `   - Codex: run \`${codex}\`, then \`${buildCodexLoginCommand()}\`.`,
    `   - Gemini CLI: run \`${gemini}\`, then \`/mcp auth ${name}\`.`,
    `   - VS Code: run \`${vscode}\`.`,
    `   - Cursor: add ${config({ url })} to ~/.cursor/mcp.json.`,
    `   - Windsurf or Antigravity: add ${config({ serverUrl: url })} to the app's MCP config (mcp_config.json).`,
    '   - Another app that supports remote MCP servers: add a Streamable HTTP server with the URL above.' +
      ` An app that only runs local (stdio) servers can use \`${bridge}\`.`,
    "   - Claude or ChatGPT, or any app whose configuration you can't change: don't guess. Tell me to add a" +
      ` custom connector (Claude) or app (ChatGPT) with the URL above${setupPage}.`,
    '2. Start the sign-in and ask me to finish it in my browser: I sign in to AppFlowy, choose a workspace and' +
      ' approve access. If AppFlowy says the app needs approval, tell me to select Request approval and to try' +
      ' again once a workspace owner approves it.',
    '3. Confirm the connection: call the AppFlowy get-self tool and tell me the name and email it returns. The' +
      ' connection covers the one workspace I chose; to use another one too, add the server again under another' +
      ` name, such as ${name}-work.`,
  ].join('\n');
}
