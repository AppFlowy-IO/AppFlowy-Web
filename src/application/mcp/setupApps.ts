/**
 * The setup guide's app gallery: its cards, and which of the caller's
 * connections each card stands for. A card is "Connected" only through the
 * server's verified app catalog (`app_id` of a client summary), never through
 * a self-asserted client name. See doc/MCP.md.
 */
import { getMcpClientDisplayName } from './setup';

/** Cards of the setup guide, in display order. */
export const MCP_SETUP_APPS = [
  'claude',
  'chatgpt',
  'claude-code',
  'codex',
  'cursor',
  'vscode',
  'gemini',
  'windsurf',
  'other',
] as const;

export type McpSetupAppId = (typeof MCP_SETUP_APPS)[number];

/**
 * The verified catalog app (`app_id`) behind each card that has one. Gemini
 * CLI, Windsurf, Antigravity and other apps register themselves with loopback
 * or unlisted redirects, which the catalog never recognizes, so their cards
 * never show "Connected".
 */
const CATALOG_APP_IDS: Readonly<Partial<Record<McpSetupAppId, string>>> = {
  claude: 'claude',
  chatgpt: 'chatgpt',
  'claude-code': 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  vscode: 'vscode',
};

/** The gallery card of a verified catalog app, if it has one. */
export function setupAppForCatalogApp(appId?: string | null): McpSetupAppId | undefined {
  if (!appId) return undefined;
  return MCP_SETUP_APPS.find((app) => CATALOG_APP_IDS[app] === appId);
}

/**
 * What the gallery reads from one of the caller's connections (a subset of
 * `McpMyConnection`, kept structural so either connection list fits).
 */
export interface McpSetupConnection {
  client_id: string;
  client_name?: string | null;
  client_host?: string | null;
  /** Verified catalog app id; null or absent for clients the catalog does not recognize. */
  app_id?: string | null;
  app_name?: string | null;
  verified_app?: boolean | null;
}

/** One app among the caller's connections, for "Connected apps (N)". */
export interface McpConnectedApp {
  /** `app:<app_id>` for a recognized app, else `name:<client name>`, else `client:<client ID>`. */
  key: string;
  /** The app's gallery card, when it has one. */
  setupApp?: McpSetupAppId;
  /** The catalog's name, else the client's own name or host; undefined means "Unknown app". */
  name?: string;
  /** Live connections (devices or registrations) with this app. */
  connectionCount: number;
}

/**
 * The catalog app id, trusted only with `verified_app: true`: the same rule as
 * `mcpApprovalKey` and `getMcpClientDisplayName`, so a chip keyed by an app
 * also carries that app's catalog name.
 */
function catalogAppId(connection: McpSetupConnection): string | undefined {
  if (connection.verified_app !== true) return undefined;
  return connection.app_id?.trim() || undefined;
}

function groupKey(connection: McpSetupConnection, appId: string | undefined): string {
  if (appId) return `app:${appId}`;
  // Every install of a self-registered app (say, Gemini CLI on two computers) is its own client.
  // Their shared name groups them for this label only; nothing else may trust that name.
  const clientName = connection.client_name?.trim().toLowerCase();

  return clientName ? `name:${clientName}` : `client:${connection.client_id}`;
}

function galleryRank(app: McpConnectedApp): number {
  return app.setupApp ? MCP_SETUP_APPS.indexOf(app.setupApp) : MCP_SETUP_APPS.length;
}

function compareConnectedApps(a: McpConnectedApp, b: McpConnectedApp): number {
  const rank = galleryRank(a) - galleryRank(b);

  if (rank !== 0) return rank;
  if (a.name === undefined || b.name === undefined) return a.name === b.name ? 0 : a.name === undefined ? 1 : -1;
  return a.name.localeCompare(b.name);
}

/**
 * The distinct apps among the caller's connections: gallery apps first, in
 * gallery order, then the others by name. Every device and registration of a
 * recognized app counts once (`app:<app_id>`). Settings counts "N apps across
 * M workspaces" with this same grouping, so its number matches "Connected apps (N)".
 */
export function summarizeConnectedApps(connections: readonly McpSetupConnection[]): McpConnectedApp[] {
  const apps = new Map<string, McpConnectedApp>();

  connections.forEach((connection) => {
    const appId = catalogAppId(connection);
    const key = groupKey(connection, appId);
    const existing = apps.get(key);

    if (existing) {
      existing.connectionCount += 1;
      return;
    }

    apps.set(key, {
      key,
      setupApp: setupAppForCatalogApp(appId),
      name: getMcpClientDisplayName(connection),
      connectionCount: 1,
    });
  });

  return Array.from(apps.values()).sort(compareConnectedApps);
}

/** The gallery cards that have at least one connection. */
export function connectedSetupApps(apps: readonly McpConnectedApp[]): ReadonlySet<McpSetupAppId> {
  return new Set(apps.flatMap(({ setupApp }) => (setupApp ? [setupApp] : [])));
}
