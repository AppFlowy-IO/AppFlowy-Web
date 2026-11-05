import {
  buildClaudeCodeCommand,
  buildClaudeConnectorUrl,
  buildCodexCommand,
  buildGeminiCommand,
  buildMcpRemoteCommand,
  buildVsCodeCliCommand,
} from '../setup';
import { buildMcpSetupPrompt, MCP_SETUP_PROMPT_VERSION } from '../setupPrompt';

const URL = 'https://mcp.example.com/mcp';
const SETUP_PAGE = 'https://appflowy.example.com/oauth/mcp/setup';

describe('buildMcpSetupPrompt', () => {
  const prompt = buildMcpSetupPrompt(URL, { setupPageUrl: SETUP_PAGE });

  it('names its version and this deployment’s server URL', () => {
    expect(MCP_SETUP_PROMPT_VERSION).toBe(3);
    expect(prompt.split('\n')[0]).toContain('(AppFlowy setup prompt v3)');
    expect(prompt).toContain(`Server URL: ${URL}`);
    expect(prompt).toContain('There is no API key, and you never need my AppFlowy password.');
  });

  it('tells the agent how to add the server to its own app with the guide’s exact commands', () => {
    [
      buildClaudeCodeCommand(URL),
      buildCodexCommand(URL),
      'codex mcp login appflowy',
      buildGeminiCommand(URL),
      '/mcp auth appflowy',
      buildVsCodeCliCommand(URL),
      buildMcpRemoteCommand(URL),
      `{"mcpServers":{"appflowy":{"url":"${URL}"}}} to ~/.cursor/mcp.json`,
      `{"mcpServers":{"appflowy":{"serverUrl":"${URL}"}}}`,
    ].forEach((text) => expect(prompt).toContain(text));
    expect(prompt).toContain(
      `Claude Code: run \`${buildClaudeCodeCommand(URL)}\`, which makes it available in every project.`
    );
  });

  it('gives the VS Code command for the shells its quoting works in, and a config file for the others', () => {
    expect(prompt).toContain(`VS Code: in bash or zsh, run \`${buildVsCodeCliCommand(URL)}\`.`);
    expect(prompt).toContain(
      `In PowerShell or cmd, add {"servers":{"appflowy":{"type":"http","url":"${URL}"}}} to .vscode/mcp.json instead.`
    );
  });

  it('has the user sign in, choose a workspace and approve, and covers a required approval', () => {
    expect(prompt).toContain('I sign in to AppFlowy, choose a workspace and approve access.');
    expect(prompt).toContain('tell me to select Request approval');
  });

  it('verifies the connection with get-self and explains one workspace per connection', () => {
    expect(prompt).toContain('call the AppFlowy get-self tool and tell me the name and email it returns');
    expect(prompt).toContain('add the server again under another name, such as appflowy-work');
  });

  it('has the user add Claude through its prefilled link and ChatGPT as a custom MCP server', () => {
    expect(prompt).toContain(
      `in Claude with ${buildClaudeConnectorUrl(URL)}, which opens Add custom connector with AppFlowy filled in;`
    );
    expect(prompt).toContain(
      'in ChatGPT at https://chatgpt.com/plugins with + then Add custom MCP server, the URL above and OAuth;'
    );
  });

  it('points apps the agent cannot configure to the setup page, when known', () => {
    expect(prompt).toContain(`as a custom connector with the URL above, and point me to ${SETUP_PAGE}`);

    const withoutPage = buildMcpSetupPrompt(URL);

    expect(withoutPage).toContain('as a custom connector with the URL above.');
    expect(withoutPage).not.toContain('point me to');
  });

  it('quotes a URL with shell syntax in every command and escapes it in JSON', () => {
    const odd = "https://mcp.example.com/mcp?a=1&b='x'";
    const quoted = buildMcpSetupPrompt(odd);

    expect(quoted).toContain(buildClaudeCodeCommand(odd));
    expect(buildClaudeCodeCommand(odd)).toContain(`'https://mcp.example.com/mcp?a=1&b='\\''x'\\'''`);
    expect(quoted).toContain(JSON.stringify({ mcpServers: { appflowy: { url: odd } } }));
  });
});
