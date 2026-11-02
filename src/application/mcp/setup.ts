/**
 * Pure helpers for connecting AI apps to the AppFlowy MCP server.
 *
 * Every builder takes the canonical server URL (`<APPFLOWY_MCP_BASE_URL>/mcp`,
 * or the `endpoint` the server reports for a workspace) and returns the exact
 * text a user pastes or the link a button opens. See doc/MCP.md.
 */

/** The name AI apps register the AppFlowy server under. */
export const MCP_SERVER_NAME = 'appflowy';

/** OAuth scopes the AppFlowy MCP server supports, in canonical order. */
export const MCP_SCOPES = ['read', 'write', 'admin'] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/** How much a grant allows: `full` includes destructive tools (`admin`). */
export type McpScopeLevel = 'read' | 'write' | 'full';

/** Copyable snippets of the setup guide; each id is also its copy button's test id suffix. */
export const MCP_SNIPPET_IDS = [
  'claude-code',
  'cursor-json',
  'vscode-cli',
  'codex',
  'codex-login',
  'codex-toml',
  'gemini',
  'server-url-json',
  'remote-json',
  'mcp-remote-json',
] as const;

export type McpSnippetId = (typeof MCP_SNIPPET_IDS)[number];

/** Where Claude (web and desktop) manages custom connectors. */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';

/**
 * ChatGPT on the web. `#settings` has opened its settings dialog (not re-verified
 * for current builds); a fragment ChatGPT ignores still opens ChatGPT.
 */
export const CHATGPT_SETTINGS_URL = 'https://chatgpt.com/#settings';

/**
 * Deep link to Settings > MCP (`SettingMenuItem.AI_APPS`). `/app` keeps the
 * query through its redirect to the current workspace.
 */
export const MCP_SETTINGS_PATH = '/app?setting=AI_APPS';

/** The public "Connect AI apps" page (`McpSetupPage`), also the MCP server's `resource_documentation`. */
export const MCP_SETUP_PAGE_PATH = '/oauth/mcp/setup';

// Characters a POSIX shell or zsh leaves alone in an unquoted argument.
const SHELL_SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Quotes a shell argument only when needed, so ordinary URLs stay readable. */
function shellArg(value: string): string {
  return SHELL_SAFE_ARGUMENT.test(value) ? value : shellQuote(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Base64 of the UTF-8 bytes of `value`. Identical to `btoa(value)` for ASCII,
 * but does not throw on other characters (an internationalized host name).
 */
function toBase64(value: string): string {
  const binary = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );

  return btoa(binary);
}

/**
 * One-click install link for Cursor (https://cursor.com/docs/mcp/install-links).
 * The server is named `appflowy` like in every snippet: `mcp.json` keys are
 * case-sensitive, so another name would add a second entry next to a manual one.
 */
export function buildCursorInstallUrl(url: string): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(
    toBase64(JSON.stringify({ url }))
  )}`;
}

/** One-click install link for VS Code. */
export function buildVsCodeInstallUrl(url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_SERVER_NAME, type: 'http', url }))}`;
}

export function buildVsCodeCliCommand(url: string): string {
  return `code --add-mcp ${shellQuote(JSON.stringify({ name: MCP_SERVER_NAME, type: 'http', url }))}`;
}

export function buildClaudeCodeCommand(url: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${shellArg(url)}`;
}

export function buildCodexCommand(url: string): string {
  return `codex mcp add ${MCP_SERVER_NAME} --url ${shellArg(url)}`;
}

/** Starts Codex's OAuth sign-in for the server added by `buildCodexCommand` or `buildCodexConfigToml`. */
export function buildCodexLoginCommand(): string {
  return `codex mcp login ${MCP_SERVER_NAME}`;
}

/**
 * A TOML basic string: quotes, backslashes and control characters escaped.
 * `JSON.stringify` is not enough: TOML also forbids a raw DEL (U+007F).
 */
function tomlString(value: string): string {
  // eslint-disable-next-line no-control-regex
  const escaped = value.replace(/["\\\u0000-\u001f\u007f]/g, (char) => {
    if (char === '"' || char === '\\') return `\\${char}`;
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });

  return `"${escaped}"`;
}

/** The server in Codex's `config.toml` (`~/.codex/config.toml`, or `.codex/config.toml` in a project). */
export function buildCodexConfigToml(url: string): string {
  return `[mcp_servers.${MCP_SERVER_NAME}]\nurl = ${tomlString(url)}`;
}

export function buildGeminiCommand(url: string): string {
  return `gemini mcp add --transport http ${MCP_SERVER_NAME} ${shellArg(url)}`;
}

/** `mcpServers` entry for apps that connect to remote MCP servers (also Cursor's `mcp.json`). */
export function buildRemoteJson(url: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { url } } }, null, 2);
}

/** `mcpServers` entry for apps that name a remote server's URL `serverUrl` (Windsurf, Antigravity). */
export function buildServerUrlJson(url: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { serverUrl: url } } }, null, 2);
}

/** The `mcp-remote` bridge as a command, for apps that only start local (stdio) servers. */
export function buildMcpRemoteCommand(url: string): string {
  return `npx -y mcp-remote ${shellArg(url)}`;
}

/** `mcpServers` entry that bridges a local-only (stdio) app to the remote server. */
export function buildMcpRemoteJson(url: string): string {
  return JSON.stringify(
    { mcpServers: { [MCP_SERVER_NAME]: { command: 'npx', args: ['-y', 'mcp-remote', url] } } },
    null,
    2
  );
}

/** Every copyable snippet of the setup guide for one server URL. */
export function buildMcpSnippets(url: string): Record<McpSnippetId, string> {
  return {
    'claude-code': buildClaudeCodeCommand(url),
    'cursor-json': buildRemoteJson(url),
    'vscode-cli': buildVsCodeCliCommand(url),
    codex: buildCodexCommand(url),
    'codex-login': buildCodexLoginCommand(),
    'codex-toml': buildCodexConfigToml(url),
    gemini: buildGeminiCommand(url),
    'server-url-json': buildServerUrlJson(url),
    'remote-json': buildRemoteJson(url),
    'mcp-remote-json': buildMcpRemoteJson(url),
  };
}

/**
 * The supported scopes named in an OAuth `scope` string, deduplicated and in
 * canonical order. Unknown scopes are dropped. `read` is not implied: callers
 * that need it (the consent page) add it themselves.
 */
export function parseScopes(scope?: string | null): McpScope[] {
  const requested = new Set((scope ?? '').split(/\s+/).filter(Boolean));

  return MCP_SCOPES.filter((candidate) => requested.has(candidate));
}

/** The level a scope string or list grants: `full` with `admin`, `write` with `write`, otherwise `read`. */
export function scopeLevel(scope?: string | readonly string[] | null): McpScopeLevel {
  const scopes = parseScopes(typeof scope === 'string' || !scope ? scope : scope.join(' '));

  if (scopes.includes('admin')) return 'full';
  if (scopes.includes('write')) return 'write';
  return 'read';
}

/** `value` when it is an absolute http(s) URL, otherwise undefined (logos, client links). */
export function safeHttpUrl(value?: string | null): string | undefined {
  if (!value) return undefined;

  try {
    const { protocol } = new URL(value);

    return protocol === 'https:' || protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** True for `localhost`, `127.x.x.x` and `[::1]`, the hosts of an app running on this computer. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    normalized === '[::1]' ||
    normalized === '::1'
  );
}

export interface McpRedirectTarget {
  /** Host name, or the scheme for a host-less private-use URI such as `com.example.app:/cb`. */
  host: string;
  /** URI scheme without the colon, e.g. `https`. */
  scheme: string;
  /** The redirect returns to an app on this computer. */
  loopback: boolean;
}

/** Where an OAuth `redirect_uri` sends the browser, for display; null when it is not a URL. */
export function describeRedirectUri(uri?: string | null): McpRedirectTarget | null {
  if (!uri) return null;

  try {
    const parsed = new URL(uri);
    const scheme = parsed.protocol.replace(/:$/, '');
    const host = parsed.hostname || scheme;

    return { host, scheme, loopback: Boolean(parsed.hostname) && isLoopbackHost(parsed.hostname) };
  } catch {
    return null;
  }
}

// Schemes that run code in, or read from, the page that navigates to them.
const UNSAFE_REDIRECT_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
  'filesystem:',
]);

/**
 * Whether the browser may navigate to an OAuth redirect. Client ID metadata
 * documents can register private-use schemes (`cursor://…`), so other schemes
 * stay allowed; script-capable schemes never are.
 */
export function isSafeMcpRedirectUrl(url: string): boolean {
  try {
    return !UNSAFE_REDIRECT_SCHEMES.has(new URL(url).protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * A client's display name: the verified app catalog's name for a recognized
 * app, else its registered name, else its host; undefined means "Unknown app".
 */
export function getMcpClientDisplayName(
  client?: {
    client_name?: string | null;
    client_host?: string | null;
    app_name?: string | null;
    verified_app?: boolean | null;
  } | null
): string | undefined {
  const appName = client?.verified_app ? client.app_name?.trim() : undefined;

  return appName || client?.client_name?.trim() || client?.client_host?.trim() || undefined;
}
