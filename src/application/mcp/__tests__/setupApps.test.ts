import {
  connectedSetupApps,
  MCP_SETUP_APPS,
  setupAppForCatalogApp,
  summarizeConnectedApps,
  type McpSetupConnection,
} from '../setupApps';

function connection(overrides: Partial<McpSetupConnection> & Pick<McpSetupConnection, 'client_id'>): McpSetupConnection {
  return { client_name: null, client_host: null, app_id: null, app_name: null, verified_app: false, ...overrides };
}

const cursor = (clientId: string) =>
  connection({ client_id: clientId, client_name: 'Cursor', app_id: 'cursor', app_name: 'Cursor', verified_app: true });

describe('MCP setup gallery', () => {
  it('lists the cards in display order', () => {
    expect(MCP_SETUP_APPS).toEqual([
      'claude',
      'chatgpt',
      'claude-code',
      'codex',
      'cursor',
      'vscode',
      'gemini',
      'windsurf',
      'other',
    ]);
  });

  it.each([
    ['claude', 'claude'],
    ['chatgpt', 'chatgpt'],
    ['claude-code', 'claude-code'],
    ['codex', 'codex'],
    ['cursor', 'cursor'],
    ['vscode', 'vscode'],
    ['raycast', undefined],
    ['perplexity', undefined],
    ['gemini', undefined],
    ['other', undefined],
    ['', undefined],
    [null, undefined],
  ])('maps the catalog app %p to the card %p', (appId, card) => {
    expect(setupAppForCatalogApp(appId)).toBe(card);
  });
});

describe('summarizeConnectedApps', () => {
  it('is empty without connections', () => {
    expect(summarizeConnectedApps([])).toEqual([]);
    expect(connectedSetupApps([]).size).toBe(0);
  });

  it('counts every device and registration of a recognized app once', () => {
    const apps = summarizeConnectedApps([cursor('dcr-1'), cursor('dcr-2'), cursor('dcr-1')]);

    expect(apps).toEqual([{ key: 'app:cursor', setupApp: 'cursor', name: 'Cursor' }]);
  });

  it('orders gallery apps by card, then other apps by name, then unnamed ones', () => {
    const apps = summarizeConnectedApps([
      connection({ client_id: 'loopback-1', client_host: null }),
      connection({ client_id: 'dcr-zed', client_name: 'Zed' }),
      cursor('dcr-cursor'),
      connection({
        client_id: 'https://raycast.example/meta.json',
        app_id: 'raycast',
        app_name: 'Raycast',
        verified_app: true,
      }),
      connection({
        client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
        client_name: 'Claude Code',
        app_id: 'claude-code',
        app_name: 'Claude Code',
        verified_app: true,
      }),
      connection({ client_id: 'dcr-gemini', client_name: 'Gemini CLI MCP Client', client_host: 'localhost' }),
    ]);

    expect(apps.map(({ key }) => key)).toEqual([
      'app:claude-code',
      'app:cursor',
      'name:gemini cli mcp client',
      'app:raycast',
      'name:zed',
      'client:loopback-1',
    ]);
    expect(apps.map(({ setupApp }) => setupApp)).toEqual([
      'claude-code',
      'cursor',
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(apps.map(({ name }) => name)).toEqual([
      'Claude Code',
      'Cursor',
      'Gemini CLI MCP Client',
      'Raycast',
      'Zed',
      undefined,
    ]);
    expect([...connectedSetupApps(apps)]).toEqual(['claude-code', 'cursor']);
  });

  it('groups unrecognized installs of one app by their name, never by a shared host', () => {
    const apps = summarizeConnectedApps([
      connection({ client_id: 'dcr-1', client_name: 'Gemini CLI', client_host: 'localhost' }),
      connection({ client_id: 'dcr-2', client_name: ' gemini cli ', client_host: 'localhost' }),
      connection({ client_id: 'dcr-3', client_host: 'localhost' }),
      connection({ client_id: 'dcr-4', client_host: 'localhost' }),
    ]);

    expect(apps.map(({ key }) => key)).toEqual(['name:gemini cli', 'client:dcr-3', 'client:dcr-4']);
    expect(apps[1].name).toBe('localhost');
  });

  it('never marks a card connected through a self-asserted name', () => {
    const apps = summarizeConnectedApps([
      connection({ client_id: 'dcr-fake', client_name: 'Cursor', client_host: 'cursor.evil.example' }),
      // A catalog id without `verified_app: true` (false, or absent) is not trusted either.
      connection({ client_id: 'dcr-flagged', client_name: 'Claude', app_id: 'claude', verified_app: false }),
      { client_id: 'dcr-unflagged', client_name: 'Codex', app_id: 'codex', app_name: 'Codex' },
    ]);

    expect(apps.map(({ key }) => key)).toEqual(['name:claude', 'name:codex', 'name:cursor']);
    expect(connectedSetupApps(apps).size).toBe(0);
  });

  it('keeps a recognized app and a look-alike apart', () => {
    const apps = summarizeConnectedApps([
      cursor('dcr-real'),
      connection({ client_id: 'dcr-fake', client_name: 'Cursor', client_host: 'localhost' }),
    ]);

    expect(apps.map(({ key, setupApp }) => [key, setupApp])).toEqual([
      ['app:cursor', 'cursor'],
      ['name:cursor', undefined],
    ]);
  });

  it('reads connections from servers that predate the catalog', () => {
    const apps = summarizeConnectedApps([
      { client_id: 'https://claude.ai/oauth/claude-code-client-metadata', client_name: 'Claude Code' },
    ]);

    expect(apps).toEqual([{ key: 'name:claude code', setupApp: undefined, name: 'Claude Code' }]);
  });
});
