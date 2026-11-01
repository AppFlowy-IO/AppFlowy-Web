import { SettingMenuItem } from '@/application/types';

import {
  buildClaudeCodeCommand,
  buildCodexCommand,
  buildCodexConfigToml,
  buildCodexLoginCommand,
  buildCursorInstallUrl,
  buildGeminiCommand,
  buildMcpRemoteCommand,
  buildMcpRemoteJson,
  buildMcpSnippets,
  buildRemoteJson,
  buildServerUrlJson,
  buildVsCodeCliCommand,
  buildVsCodeInstallUrl,
  CHATGPT_SETTINGS_URL,
  CLAUDE_CONNECTORS_URL,
  describeRedirectUri,
  getMcpClientDisplayName,
  isLoopbackHost,
  isSafeMcpRedirectUrl,
  MCP_SERVER_NAME,
  MCP_SETTINGS_PATH,
  MCP_SETUP_PAGE_PATH,
  MCP_SNIPPET_IDS,
  parseScopes,
  safeHttpUrl,
  scopeLevel,
} from '../setup';

const URL = 'https://mcp.appflowy.com/mcp';

describe('MCP setup builders', () => {
  it('builds the Cursor install deeplink with a URL-encoded base64 config', () => {
    expect(buildCursorInstallUrl(URL)).toBe(
      'cursor://anysphere.cursor-deeplink/mcp/install?name=appflowy&config=eyJ1cmwiOiJodHRwczovL21jcC5hcHBmbG93eS5jb20vbWNwIn0%3D'
    );
    expect(buildCursorInstallUrl('http://localhost:8002/mcp')).toBe(
      'cursor://anysphere.cursor-deeplink/mcp/install?name=appflowy&config=eyJ1cmwiOiJodHRwOi8vbG9jYWxob3N0OjgwMDIvbWNwIn0%3D'
    );
  });

  it('names the Cursor server like every snippet, so a manual entry is not added twice', () => {
    const link = new globalThis.URL(buildCursorInstallUrl(URL));

    expect(link.searchParams.get('name')).toBe(MCP_SERVER_NAME);
    expect(Object.keys(JSON.parse(buildRemoteJson(URL)).mcpServers)).toEqual([MCP_SERVER_NAME]);
  });

  it('matches btoa(JSON.stringify({ url })) and still encodes non-Latin-1 hosts as UTF-8', () => {
    const config = (link: string) => decodeURIComponent(new globalThis.URL(link).searchParams.get('config') ?? '');

    expect(config(buildCursorInstallUrl(URL))).toBe(btoa(JSON.stringify({ url: URL })));
    expect(config(buildCursorInstallUrl('https://mcp.exämple.com/mcp'))).toBe(
      'eyJ1cmwiOiJodHRwczovL21jcC5leMOkbXBsZS5jb20vbWNwIn0='
    );
  });

  it('builds the VS Code install link and CLI command', () => {
    expect(buildVsCodeInstallUrl(URL)).toBe(
      'vscode:mcp/install?%7B%22name%22%3A%22appflowy%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.appflowy.com%2Fmcp%22%7D'
    );
    expect(buildVsCodeCliCommand(URL)).toBe(
      `code --add-mcp '{"name":"appflowy","type":"http","url":"https://mcp.appflowy.com/mcp"}'`
    );
  });

  it('builds the CLI commands for Claude Code, Codex and Gemini CLI', () => {
    expect(buildClaudeCodeCommand(URL)).toBe('claude mcp add --transport http appflowy https://mcp.appflowy.com/mcp');
    expect(buildCodexCommand(URL)).toBe('codex mcp add appflowy --url https://mcp.appflowy.com/mcp');
    expect(buildCodexLoginCommand()).toBe('codex mcp login appflowy');
    expect(buildGeminiCommand(URL)).toBe('gemini mcp add --transport http appflowy https://mcp.appflowy.com/mcp');
    expect(buildMcpRemoteCommand(URL)).toBe('npx -y mcp-remote https://mcp.appflowy.com/mcp');
    expect(buildMcpRemoteCommand("https://example.com/mcp?a=1&b='x'")).toBe(
      `npx -y mcp-remote 'https://example.com/mcp?a=1&b='\\''x'\\'''`
    );
  });

  it("builds Codex's config.toml entry as a valid TOML basic string", () => {
    expect(buildCodexConfigToml(URL)).toBe('[mcp_servers.appflowy]\nurl = "https://mcp.appflowy.com/mcp"');
    // Quotes, backslashes and control characters (DEL too, unlike JSON) are escaped.
    expect(buildCodexConfigToml('https://example.com/a"b\\c\u0001d\u007fe\tf')).toBe(
      '[mcp_servers.appflowy]\nurl = "https://example.com/a\\"b\\\\c\\u0001d\\u007fe\\u0009f"'
    );
    // Non-ASCII stays as typed: TOML files are UTF-8.
    expect(buildCodexConfigToml('https://mcp.exämple.com/mcp')).toBe(
      '[mcp_servers.appflowy]\nurl = "https://mcp.exämple.com/mcp"'
    );
  });

  it('quotes shell arguments only when a URL contains shell syntax', () => {
    expect(buildClaudeCodeCommand("https://example.com/mcp?a=1&b='x'")).toBe(
      `claude mcp add --transport http appflowy 'https://example.com/mcp?a=1&b='\\''x'\\'''`
    );
    expect(buildVsCodeCliCommand("https://example.com/it's")).toBe(
      `code --add-mcp '{"name":"appflowy","type":"http","url":"https://example.com/it'\\''s"}'`
    );
  });

  it('builds pretty-printed remote and mcp-remote JSON', () => {
    expect(buildRemoteJson(URL)).toBe(
      '{\n  "mcpServers": {\n    "appflowy": {\n      "url": "https://mcp.appflowy.com/mcp"\n    }\n  }\n}'
    );
    expect(buildMcpRemoteJson(URL)).toBe(
      '{\n  "mcpServers": {\n    "appflowy": {\n      "command": "npx",\n      "args": [\n        "-y",\n        "mcp-remote",\n        "https://mcp.appflowy.com/mcp"\n      ]\n    }\n  }\n}'
    );
  });

  it('builds the serverUrl JSON that Windsurf and Antigravity read', () => {
    expect(buildServerUrlJson(URL)).toBe(
      '{\n  "mcpServers": {\n    "appflowy": {\n      "serverUrl": "https://mcp.appflowy.com/mcp"\n    }\n  }\n}'
    );
  });

  it('offers one snippet per snippet id', () => {
    const snippets = buildMcpSnippets(URL);

    expect(Object.keys(snippets).sort()).toEqual([...MCP_SNIPPET_IDS].sort());
    expect(snippets['cursor-json']).toBe(buildRemoteJson(URL));
    expect(snippets['vscode-cli']).toBe(buildVsCodeCliCommand(URL));
    expect(snippets['codex-login']).toBe(buildCodexLoginCommand());
    expect(snippets['codex-toml']).toBe(buildCodexConfigToml(URL));
    expect(snippets['server-url-json']).toBe(buildServerUrlJson(URL));
    expect(snippets['mcp-remote-json']).toBe(buildMcpRemoteJson(URL));
  });

  it('links to the vendor pages and the public setup page', () => {
    expect(CLAUDE_CONNECTORS_URL).toBe('https://claude.ai/customize/connectors');
    expect(CHATGPT_SETTINGS_URL).toBe('https://chatgpt.com/#settings');
    expect(MCP_SETUP_PAGE_PATH).toBe('/oauth/mcp/setup');
  });
});

describe('MCP scopes', () => {
  it.each([
    [undefined, []],
    [null, []],
    ['', []],
    ['   ', []],
    ['read', ['read']],
    ['admin write', ['write', 'admin']],
    ['write read write', ['read', 'write']],
    ['  read\twrite\nadmin  ', ['read', 'write', 'admin']],
    ['read workspace profile', ['read']],
    ['READ Write', []],
  ])('parseScopes(%p) is %p', (scope, expected) => {
    expect(parseScopes(scope)).toEqual(expected);
  });

  it.each([
    [undefined, 'read'],
    [null, 'read'],
    ['', 'read'],
    ['read', 'read'],
    ['write', 'write'],
    ['read write', 'write'],
    ['admin', 'full'],
    ['read write admin', 'full'],
    [['read', 'write'], 'write'],
    [['admin'], 'full'],
  ])('scopeLevel(%p) is %p', (scope, expected) => {
    expect(scopeLevel(scope as string | string[] | null | undefined)).toBe(expected);
  });
});

describe('MCP URL helpers', () => {
  it.each([
    ['https://claude.ai/logo.png', 'https://claude.ai/logo.png'],
    ['http://localhost:3000/logo.png', 'http://localhost:3000/logo.png'],
    ['javascript:alert(1)', undefined],
    ['data:image/png;base64,AAAA', undefined],
    ['//claude.ai/logo.png', undefined],
    ['/logo.png', undefined],
    ['ftp://example.com/logo.png', undefined],
    ['', undefined],
    [null, undefined],
    [undefined, undefined],
  ])('safeHttpUrl(%p) is %p', (value, expected) => {
    expect(safeHttpUrl(value)).toBe(expected);
  });

  it.each([
    ['localhost', true],
    ['LOCALHOST', true],
    ['app.localhost', true],
    ['127.0.0.1', true],
    ['127.1.2.3', true],
    ['[::1]', true],
    ['::1', true],
    ['claude.ai', false],
    ['localhost.evil.com', false],
    ['127.0.0.1.evil.com', false],
  ])('isLoopbackHost(%p) is %p', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });

  it('describes where a redirect URI returns to', () => {
    expect(describeRedirectUri('https://claude.ai/api/mcp/auth_callback')).toEqual({
      host: 'claude.ai',
      scheme: 'https',
      loopback: false,
    });
    expect(describeRedirectUri('http://127.0.0.1:33418/callback')).toEqual({
      host: '127.0.0.1',
      scheme: 'http',
      loopback: true,
    });
    expect(describeRedirectUri('http://[::1]:8787/callback')).toEqual({ host: '[::1]', scheme: 'http', loopback: true });
    expect(describeRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback')).toEqual({
      host: 'anysphere.cursor-mcp',
      scheme: 'cursor',
      loopback: false,
    });
    expect(describeRedirectUri('com.example.app:/callback')).toEqual({
      host: 'com.example.app',
      scheme: 'com.example.app',
      loopback: false,
    });
    expect(describeRedirectUri('not a url')).toBeNull();
    expect(describeRedirectUri(undefined)).toBeNull();
  });

  it.each([
    ['https://claude.ai/api/mcp/auth_callback?code=1', true],
    ['http://localhost:3118/callback?code=1', true],
    ['cursor://anysphere.cursor-mcp/oauth/callback?code=1', true],
    ['javascript:alert(document.cookie)', false],
    ['  JaVaScRiPt:alert(1)', false],
    ['java\tscript:alert(1)', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['vbscript:msgbox(1)', false],
    ['file:///etc/passwd', false],
    ['blob:https://appflowy.com/1234', false],
    ['/relative/path', false],
  ])('isSafeMcpRedirectUrl(%p) is %p', (url, expected) => {
    expect(isSafeMcpRedirectUrl(url)).toBe(expected);
  });

  it('deep-links to the AI apps settings panel', () => {
    expect(MCP_SETTINGS_PATH).toBe(`/app?setting=${SettingMenuItem.AI_APPS}`);
  });

  it('names a client by its name, then its host', () => {
    expect(getMcpClientDisplayName({ client_name: ' Claude ', client_host: 'claude.ai' })).toBe('Claude');
    expect(getMcpClientDisplayName({ client_name: '  ', client_host: 'claude.ai' })).toBe('claude.ai');
    expect(getMcpClientDisplayName({ client_name: null, client_host: null })).toBeUndefined();
    expect(getMcpClientDisplayName(null)).toBeUndefined();
  });
});
