import { type McpClientSummary, mcpApprovalKey } from '@/application/services/js-services/http/mcp-api';

import { getMcpClientDisplayName, getMcpClientOwnName, trustedCatalogAppId } from '../setup';
import { summarizeConnectedApps } from '../setupApps';

// The naming fields of the MCP service's client summaries, which it always sends.
type Client = Pick<
  McpClientSummary,
  'client_id' | 'client_name' | 'client_host' | 'app_id' | 'app_name' | 'verified_app'
>;

// One client of each kind the consent page and Settings name. `app_id` and `app_name` are
// trusted only with `verified_app: true`, whichever helper reads them.
const CLIENTS: Record<string, Client> = {
  catalogWebApp: {
    client_id: 'https://chatgpt.com/oauth/client.json',
    client_name: null,
    client_host: 'chatgpt.com',
    app_id: 'chatgpt',
    app_name: 'ChatGPT',
    verified_app: true,
  },
  nativeCatalogApp: {
    client_id: 'dcr-cursor',
    client_name: 'cursor-mcp',
    client_host: 'www.cursor.com',
    app_id: ' cursor ',
    app_name: ' Cursor ',
    verified_app: true,
  },
  unverifiedWithCatalogFields: {
    client_id: 'dcr-fake',
    client_name: 'Totally Cursor',
    client_host: 'evil.example.com',
    app_id: 'cursor',
    app_name: 'Cursor',
    verified_app: false,
  },
  cimdApp: {
    client_id: 'https://agents.example.com/client.json',
    client_name: 'Agents',
    client_host: 'agents.example.com',
    app_id: null,
    app_name: null,
    verified_app: false,
  },
  dcrLoopback: {
    client_id: 'dcr-gemini',
    client_name: 'gemini-cli',
    client_host: 'localhost',
    app_id: null,
    app_name: null,
    verified_app: false,
  },
  hostOnly: {
    client_id: 'dcr-unnamed',
    client_name: null,
    client_host: 'tools.example.com',
    app_id: null,
    app_name: null,
    verified_app: false,
  },
};

describe.each([
  // [client, catalog app id, own name, display name, approval key, group key]
  ['catalogWebApp', 'chatgpt', 'ChatGPT', 'ChatGPT', 'app:chatgpt', 'app:chatgpt'],
  ['nativeCatalogApp', 'cursor', 'Cursor', 'Cursor', 'app:cursor', 'app:cursor'],
  ['unverifiedWithCatalogFields', undefined, 'Totally Cursor', 'Totally Cursor', 'dcr-fake', 'name:totally cursor'],
  ['cimdApp', undefined, 'Agents', 'Agents', CLIENTS.cimdApp.client_id, 'name:agents'],
  ['dcrLoopback', undefined, 'gemini-cli', 'gemini-cli', 'dcr-gemini', 'name:gemini-cli'],
  ['hostOnly', undefined, undefined, 'tools.example.com', 'dcr-unnamed', 'client:dcr-unnamed'],
])('the %s client', (id, appId, ownName, displayName, approvalKey, groupKey) => {
  const client = CLIENTS[id];

  it('reads the catalog fields only when the catalog vouches for it', () => {
    expect(trustedCatalogAppId(client)).toBe(appId);
    expect(getMcpClientOwnName(client)).toBe(ownName);
    expect(getMcpClientDisplayName(client)).toBe(displayName);
  });

  it('gets the same app from every key built on that rule', () => {
    expect(mcpApprovalKey(client)).toBe(approvalKey);
    expect(summarizeConnectedApps([client])).toEqual([expect.objectContaining({ key: groupKey, name: displayName })]);
  });
});
