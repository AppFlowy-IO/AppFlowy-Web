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

const vscode = (clientId: string) =>
  connection({ client_id: clientId, client_name: 'VS Code', app_id: 'vscode', app_name: 'VS Code', verified_app: true });

describe('MCP setup gallery', () => {
  it('lists the cards in display order', () => {
    expect(MCP_SETUP_APPS).toEqual(['claude', 'chatgpt', 'claude-code', 'codex', 'vscode', 'other']);
  });

  it.each([
    ['claude', 'claude'],
    ['chatgpt', 'chatgpt'],
    ['claude-code', 'claude-code'],
    ['codex', 'codex'],
    ['vscode', 'vscode'],
    // Recognized by the catalog, but the gallery has no card for it.
    ['cursor', undefined],
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
    const apps = summarizeConnectedApps([vscode('dcr-1'), vscode('dcr-2'), vscode('dcr-1')]);

    expect(apps).toEqual([{ key: 'app:vscode', setupApp: 'vscode', name: 'VS Code' }]);
  });

  it('orders gallery apps by card, then other apps by name, then unnamed ones', () => {
    const apps = summarizeConnectedApps([
      connection({ client_id: 'loopback-1', client_host: null }),
      connection({ client_id: 'dcr-zed', client_name: 'Zed' }),
      vscode('dcr-vscode'),
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
      'app:vscode',
      'name:gemini cli mcp client',
      'app:raycast',
      'name:zed',
      'client:loopback-1',
    ]);
    expect(apps.map(({ setupApp }) => setupApp)).toEqual([
      'claude-code',
      'vscode',
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(apps.map(({ name }) => name)).toEqual([
      'Claude Code',
      'VS Code',
      'Gemini CLI MCP Client',
      'Raycast',
      'Zed',
      undefined,
    ]);
    expect([...connectedSetupApps(apps)]).toEqual(['claude-code', 'vscode']);
  });

  // Folded (case and accents ignored), then as written, both by code unit, like dashboard labels
  // and Desktop's mcp_setup.dart: the same order in every browser language. localeCompare puts
  // "raycast" before "Raycast" and "Straße" before "Strata".
  it('orders the other apps by name, case and accents ignored', () => {
    const apps = summarizeConnectedApps([
      connection({ client_id: 'dcr-zed', client_name: 'Zed' }),
      connection({ client_id: 'dcr-eclair', client_name: 'Éclair' }),
      connection({
        client_id: 'https://raycast.example/meta.json',
        app_id: 'raycast',
        app_name: 'Raycast',
        verified_app: true,
      }),
      connection({ client_id: 'dcr-raycast', client_name: 'raycast' }),
      connection({ client_id: 'dcr-oz', client_name: 'Öz Agent' }),
      connection({ client_id: 'dcr-resume-accented', client_name: 'résumé' }),
      connection({ client_id: 'dcr-resume', client_name: 'Resume' }),
    ]);

    expect(apps.map(({ key }) => key)).toEqual([
      'name:éclair',
      'name:öz agent',
      // Equal once folded: as written, uppercase first.
      'app:raycast',
      'name:raycast',
      'name:resume',
      'name:résumé',
      'name:zed',
    ]);
  });

  it.each([
    ['keeping ß a letter of its own', ['Strasse', 'Strata', 'Straße']],
    ['in another script by its letters', ['Агент', 'Бот', 'Мой агент']],
  ])('orders names without locale collation, %s', (_, names) => {
    const apps = summarizeConnectedApps(
      [...names].reverse().map((name) => connection({ client_id: `dcr-${name}`, client_name: name }))
    );

    expect(apps.map(({ name }) => name)).toEqual(names);
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
      vscode('dcr-real'),
      connection({ client_id: 'dcr-fake', client_name: 'VS Code', client_host: 'localhost' }),
    ]);

    expect(apps.map(({ key, setupApp }) => [key, setupApp])).toEqual([
      ['app:vscode', 'vscode'],
      ['name:vs code', undefined],
    ]);
  });

  it('reads connections from servers that predate the catalog', () => {
    const apps = summarizeConnectedApps([
      { client_id: 'https://claude.ai/oauth/claude-code-client-metadata', client_name: 'Claude Code' },
    ]);

    expect(apps).toEqual([{ key: 'name:claude code', setupApp: undefined, name: 'Claude Code' }]);
  });
});
