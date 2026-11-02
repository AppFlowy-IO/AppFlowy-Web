/**
 * Client for the AppFlowy MCP service: public client lookup, browser consent,
 * member self-service and owner governance. The service's origin comes from
 * the `APPFLOWY_MCP_BASE_URL` runtime config (an explicit override), else from
 * the `mcp_url` AppFlowy Cloud advertises in server-info (`getMcpConfiguration`).
 *
 * Uses `fetch`, not the shared axios instance: that instance treats every 401
 * as an expired AppFlowy session and rotates the refresh token, while the MCP
 * service answers 401 only for a bad token (`reason: "invalid_session"`) and
 * 403 for every refusal. Authenticated calls send the current GoTrue access
 * token as a bearer, refreshing it first when it expires within 30 seconds,
 * and refresh once more and retry once on `invalid_session`. The GoTrue
 * refresh token never leaves the browser. See doc/MCP.md.
 */
import { isSafeMcpRedirectUrl, trustedCatalogAppId } from '@/application/mcp/setup';
import { captureTokenSession, getTokenParsed, invalidTokenForSession } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';
import { getServerInfoSnapshot, type ServerInfoState } from '@/utils/server-info';

import { isAuthRefreshFailure } from './auth-refresh-error';
import { refreshToken } from './gotrue';

const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_LEEWAY_MS = 30_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Machine reasons the MCP service puts in error bodies; map them to localized text. */
export const MCP_ERROR_REASONS = [
  'invalid_session',
  'email_not_allowed',
  'not_workspace_member',
  'guest_not_allowed',
  'not_workspace_owner',
  'unknown_client',
  'invalid_redirect_uri',
  'client_blocked',
  'client_not_approved',
  'invalid_scope',
  'invalid_target',
  'already_approved',
  'request_limit',
  'rate_limited',
  'temporarily_unavailable',
  'invalid_request',
  'server_error',
  // HTTP 503: an administrator turned AI app connections off for the whole server.
  'mcp_disabled',
] as const;

export type McpErrorReason = (typeof MCP_ERROR_REASONS)[number];

export function isMcpErrorReason(value: unknown): value is McpErrorReason {
  return typeof value === 'string' && (MCP_ERROR_REASONS as readonly string[]).includes(value);
}

export interface McpApiErrorInit {
  status: number;
  error?: string;
  reason?: McpErrorReason;
  description?: string;
  cause?: unknown;
}

/**
 * A failed MCP request.
 *
 * - `status`: the HTTP status, or 0 when no response arrived. Then `error` is
 *   `network_error`, `timeout`, `not_configured`, `session_refresh_failed`, or
 *   `invalid_request` for a call refused before sending.
 * - `error`: the OAuth-style code from the body (`access_denied`, `forbidden`…).
 * - `reason`: a known machine reason from the body; for bodies without one, an
 *   `error` of `mcp_disabled` implies `mcp_disabled`, a 429 `rate_limited`,
 *   502/503/504 `temporarily_unavailable` and other 5xx `server_error`.
 *   Unknown reasons are dropped.
 * - `description`: English text from the server, for logs only.
 */
export class McpApiError extends Error {
  readonly status: number;
  readonly error?: string;
  readonly reason?: McpErrorReason;
  readonly description?: string;

  constructor({ status, error, reason, description, cause }: McpApiErrorInit) {
    super(
      description || error || (status ? `MCP request failed with HTTP ${status}` : 'MCP request failed'),
      cause === undefined ? undefined : { cause }
    );
    this.name = 'McpApiError';
    this.status = status;
    this.error = error;
    this.reason = reason;
    this.description = description;
  }
}

export function isMcpApiError(error: unknown): error is McpApiError {
  return error instanceof McpApiError;
}

/** The caller's `signal` aborted the request; not a failure to report. */
export function isMcpAbortError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * AI app connections are turned off for the whole server (HTTP 503
 * `mcp_disabled`, from Admin → AI apps (MCP) or the deployment). Only an
 * administrator can change that, so retrying does not help. Disconnecting
 * stays possible: the server keeps grant-reducing endpoints available.
 */
export function isMcpDisabledError(error: unknown): boolean {
  return error instanceof McpApiError && error.reason === 'mcp_disabled';
}

/**
 * The MCP service gave no usable answer: unknown, unreachable, timed out,
 * failing (5xx) or missing the endpoint (a 404 without a reason, from a server
 * that predates it). Settings shows "unavailable" with Retry for these. A
 * server that turned AI app connections off (`isMcpDisabledError`) did answer,
 * and a failed AppFlowy session refresh (`session_refresh_failed`) never
 * reached the MCP service, so neither is one.
 */
export function isMcpServiceUnavailable(error: unknown): boolean {
  if (!(error instanceof McpApiError)) return false;
  if (error.status === 0) {
    return error.error === 'network_error' || error.error === 'timeout' || error.error === 'not_configured';
  }

  if (isMcpDisabledError(error)) return false;
  return error.status >= 500 || (error.status === 404 && !error.reason);
}

// ---------------------------------------------------------------------------
// Wire types (snake_case, as the MCP service sends them)
// ---------------------------------------------------------------------------

/** Unix seconds (connections, access requests) or an RFC 3339 string (approvals, settings). */
export type McpTimestamp = number | string;

/** A timestamp from the MCP service as a Date; null when absent or invalid. */
export function mcpTimestampToDate(value?: McpTimestamp | null): Date | null {
  if (value === undefined || value === null || value === '') return null;

  let ms: number;

  if (typeof value === 'number') {
    // Seconds stay below 1e11 until the year 5138; larger values are already milliseconds.
    ms = value > 1e11 ? value : value * 1000;
  } else {
    ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value);
  }

  return Number.isFinite(ms) ? new Date(ms) : null;
}

export type McpClientKind = 'cimd' | 'dcr';

export type McpWorkspaceRole = 'owner' | 'member' | 'guest';

export type McpIneligibleReason = 'email_not_allowed' | 'guest_not_allowed';

/** How the MCP service describes an OAuth client everywhere it lists one. */
export interface McpClientSummary {
  client_id: string;
  client_name?: string | null;
  client_uri?: string | null;
  /** Only http(s) is sent; still render it through `safeHttpUrl`. */
  logo_uri?: string | null;
  /** `cimd`: the client ID is an https URL, so its host is verified. `dcr`: the app registered itself. */
  client_kind: McpClientKind;
  /** CIMD: host of the client ID URL. DCR: host of client_uri or of the first https redirect, or `localhost`. */
  client_host?: string | null;
  /** Distinct hosts of the registered redirect URIs; loopback hosts are reported as `localhost`. */
  redirect_hosts: string[];
  /** Every registered redirect is a loopback address: the app runs on the user's computer. */
  loopback_only: boolean;
  /**
   * The server's verified app catalog id (`claude`, `chatgpt`, `cursor`…):
   * the client's CIMD client ID is one the catalog lists, or every redirect it
   * registered is https on that entry's hosts (apps that run on the user's
   * computer, like Cursor, may add loopback ones). Null for other clients
   * (loopback-only registrations are never recognized); absent from servers
   * without the catalog.
   */
  app_id?: string | null;
  /** The catalog's name for a recognized app ("Cursor"). Unlike `client_name` it is not self-asserted. */
  app_name?: string | null;
  /** The catalog recognizes this client (`app_id` is set). Absent from servers without the catalog. */
  verified_app?: boolean;
  /**
   * `verified_app`, and recognizing the client also proves which app it is: a
   * web app (Claude, ChatGPT, Perplexity) whose sign-ins only ever return to
   * its publisher's own website. Only these get the "Verified app" badge and
   * connect without approval under `verified_and_approved`. False for catalog
   * apps that run on the user's computer (Claude Code, Codex, Cursor, VS Code,
   * Raycast): any program there can use their identity. Absent means false.
   */
  identity_verified?: boolean;
}

/**
 * Which AI apps members may connect to a workspace without an owner's
 * approval: `verified_and_approved` admits the verified catalog's web apps
 * (`identity_verified`) plus approved apps (the default of a workspace that
 * never chose), `approved_only` only apps an owner approved, and `any` every
 * app.
 */
export const MCP_APPROVAL_MODES = ['verified_and_approved', 'approved_only', 'any'] as const;

export type McpApprovalMode = (typeof MCP_APPROVAL_MODES)[number];

export function isMcpApprovalMode(value: unknown): value is McpApprovalMode {
  return typeof value === 'string' && (MCP_APPROVAL_MODES as readonly string[]).includes(value);
}

/** Prefix of an app-level approval key: `app:cursor` approves every Cursor registration. */
export const MCP_APP_APPROVAL_KEY_PREFIX = 'app:';

/** An approval key that covers every registration of one recognized app. */
export function isMcpAppApprovalKey(key: string | null | undefined): boolean {
  return Boolean(key?.startsWith(MCP_APP_APPROVAL_KEY_PREFIX));
}

/**
 * The key approvals and access requests use for a client: the server's
 * `approval_key` when it sent one, else `app:<app_id>` for an app the catalog
 * recognizes, else the client ID itself.
 */
export function mcpApprovalKey(
  client: Pick<McpClientSummary, 'client_id' | 'app_id' | 'verified_app'> & { approval_key?: string | null }
): string {
  const approvalKey = client.approval_key?.trim();

  if (approvalKey) return approvalKey;
  const appId = trustedCatalogAppId(client);

  return appId ? `${MCP_APP_APPROVAL_KEY_PREFIX}${appId}` : client.client_id;
}

/** `GET /api/mcp/clients?client_id=` (public). */
export type McpClientInfo = McpClientSummary;

/** The client part of a member status, present when a `client_id` was given. */
export interface McpMemberClientStatus extends McpClientSummary {
  /** A DCR registration exists, or the CIMD document resolves. */
  known: boolean;
  /** Excluded by the server-wide client allowlist. */
  blocked: boolean;
  /**
   * Approved in this workspace, or approval is not required: the decision
   * authorization enforces. Decide the consent action from this, not from
   * `requires_approval`, which it can trail briefly after a settings change.
   */
  approved: boolean;
  /** A member already asked the owners to approve this client here. */
  request_pending: boolean;
  /** The caller already has a live connection with this client here. */
  connected: boolean;
}

/**
 * An app members may connect without asking (`approved_apps` of the member
 * status): the app and what the approval covers, never who approved it.
 */
export interface McpApprovedApp extends McpClientSummary {
  /** `app:<app_id>` covers every registration of the app; anything else is one client ID. */
  approval_key: string;
}

/** `GET /api/mcp/me/workspaces/{workspace_id}[?client_id=]`. */
export interface McpMemberStatus {
  workspace_id: string;
  /**
   * AI app connections are on for this server. False while an administrator
   * has turned them off (Admin → AI apps (MCP), or the deployment): nothing
   * can connect, and only disconnecting works. `getMcpMemberStatus` reads a
   * missing value, from servers that predate the switch, as true.
   */
  enabled?: boolean;
  /** Canonical server URL (`<public base>/mcp`): the only URL users should paste. */
  endpoint: string;
  role: McpWorkspaceRole;
  eligible: boolean;
  ineligible_reason: McpIneligibleReason | null;
  /** Some apps need an owner's approval here (any policy but `any`). */
  requires_approval: boolean;
  /** The workspace's approval policy. Absent from servers that predate it, or when it is not one this Web knows. */
  approval_mode?: McpApprovalMode;
  client: McpMemberClientStatus | null;
  /**
   * The apps owners approved for this workspace, so members can see what
   * connects without a request. Absent from servers that predate it.
   */
  approved_apps?: McpApprovedApp[];
}

/** What every listed connection carries besides its client. */
export interface McpConnectionDetails {
  /** Granted scope, e.g. `read write`; null for grants older than scope tracking (read only). */
  scope: string | null;
  /** When the user authorized this connection, in Unix seconds; token refreshes keep it. */
  connected_at: number;
  /**
   * The connection's token family. Each authorization starts one, so every
   * device (or account) signed in to the same app is its own connection. Null
   * for connections recorded before families were listed; absent from servers
   * that predate it.
   */
  family_id?: string | null;
  /** The app and device as its sign-in request described them ("Claude Code 2.1 · macOS"); null when unknown. */
  device_label?: string | null;
  /** The connection's last MCP request or token refresh, updated at most every 5 minutes; null before one. */
  last_used_at?: McpTimestamp | null;
}

/** One of the caller's own connections. */
export interface McpMyConnection extends McpClientSummary, McpConnectionDetails {}

/** One of the caller's connections in any workspace (`GET /api/mcp/me/connections`). */
export interface McpMyWorkspaceConnection extends McpMyConnection {
  workspace_id: string;
}

/** `GET /api/mcp/me/connections`: the caller's live connections in every workspace they still belong to. */
export interface McpMyConnectionsAcrossWorkspaces {
  connections: McpMyWorkspaceConnection[];
  /** Workspaces with at least one of these connections. */
  workspace_count: number;
  connection_count: number;
}

/** A member connection, as workspace owners see it. */
export interface McpWorkspaceConnection extends McpClientSummary, McpConnectionDetails {
  user_uuid: string;
  user_name?: string | null;
  user_email?: string | null;
  workspace_id: string;
}

export interface McpAccessRequester {
  user_uuid: string;
  name?: string | null;
  email?: string | null;
  requested_at: McpTimestamp;
}

/**
 * A pending request from members to approve a client. Requests for an app the
 * catalog recognizes are merged under its app key; the summary describes one
 * of its registrations.
 */
export interface McpAccessRequest extends McpClientSummary {
  /** The key the request is filed under, when the server sends it (see `mcpApprovalKey`). */
  approval_key?: string;
  /** Newest first, at most 20. */
  requesters: McpAccessRequester[];
  first_requested_at: McpTimestamp;
  last_requested_at: McpTimestamp;
}

export interface McpAccessRequestResponse {
  requested: boolean;
  request: McpAccessRequest;
}

/**
 * An approval, as workspace owners see it. The summary describes the approved
 * client, or for an app-level approval one registration of the app.
 */
export interface McpApprovedClient extends McpClientSummary {
  /**
   * What the approval covers, and what revoking it takes: `app:<app_id>`
   * approves every registration of a recognized app ("All Cursor installs"),
   * anything else is one client ID. Servers that predate app-level approvals
   * send none; it then reads as the client ID.
   */
  approval_key: string;
  /** User UUID of the owner who approved it. */
  approved_by: string;
  approved_by_name?: string | null;
  approved_by_email?: string | null;
  approved_at: McpTimestamp;
}

/** `GET|PUT /api/mcp/admin/workspaces/{workspace_id}/settings`. */
export interface McpWorkspaceSettings {
  workspace_id: string;
  /** `approval_mode === 'any'`, kept for older callers. */
  allow_unapproved_clients: boolean;
  /**
   * The effective approval policy. Servers that predate it send none; it then
   * reads `any` or `approved_only` from `allow_unapproved_clients`.
   */
  approval_mode: McpApprovalMode;
  updated_by?: string | null;
  updated_at?: string | null;
  approved_clients: McpApprovedClient[];
}

/** The `PUT .../settings` response. */
export interface McpWorkspaceSettingsUpdate extends McpWorkspaceSettings {
  /**
   * Apps members were connected to that the new, stricter policy would have
   * refused: the server approved them (by the acting owner) so those members
   * keep working. Empty otherwise, and from servers that predate it.
   */
  auto_approved_clients: McpClientSummary[];
}

export interface McpDisconnectResponse {
  disconnected: number;
}

export interface McpApproveResponse {
  approved: boolean;
}

export interface McpDismissResponse {
  dismissed: boolean;
}

/** Where to send the browser next; always passed through `isSafeMcpRedirectUrl`. */
export interface McpRedirectResponse {
  redirect_url: string;
}

/** Body of `POST /api/mcp/authorize/code`. It never carries the GoTrue refresh token. */
export interface McpAuthorizationCodeRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  workspace_id: string;
  state?: string;
  /** Space-separated subset of `read write admin`; empty means read only. */
  scope?: string;
  /** RFC 8707 resource indicator from the authorization request. */
  resource?: string;
}

export interface McpDenyRequest {
  client_id: string;
  redirect_uri: string;
  state?: string;
}

/**
 * At least `clientId` or `userUuid` is required: an unfiltered disconnect
 * would remove every member's connections (`disconnectAllMcpWorkspaceConnections`).
 */
export interface McpWorkspaceConnectionFilter {
  clientId?: string;
  userUuid?: string;
  /** Narrows the filter to one connection (token family); pass it with `clientId` and `userUuid`. */
  familyId?: string | null;
}

export interface McpRequestOptions {
  /** Aborting rejects with the fetch AbortError (see `isMcpAbortError`), not an McpApiError. */
  signal?: AbortSignal;
}

export interface McpDisconnectOptions extends McpRequestOptions {
  /** Only this connection (token family); without it every connection with the client goes. */
  familyId?: string | null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** `config`: the `APPFLOWY_MCP_BASE_URL` override. `server_info`: the `mcp_url` AppFlowy Cloud advertises. */
export type McpConfigurationSource = 'config' | 'server_info';

/**
 * Where the MCP service is. `loading` until server-info answers; `configured`
 * with the service's origin (`baseUrl`, without `/mcp`); `not_configured` when
 * neither source names one, which hides Settings > MCP and makes the
 * consent and setup pages say AI app connections are not configured.
 */
export type McpConfiguration =
  | { status: 'loading' }
  | { status: 'configured'; baseUrl: string; source: McpConfigurationSource }
  | { status: 'not_configured' };

const MCP_CONFIGURATION_LOADING: McpConfiguration = { status: 'loading' };
const MCP_NOT_CONFIGURED: McpConfiguration = { status: 'not_configured' };

const warnedInvalidMcpUrls = new Set<string>();

/** `value` without trailing slashes when it is an absolute http(s) URL; otherwise '' (warning once per value). */
function normalizeMcpBaseUrl(value: string | null | undefined, origin: string): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');

  if (!trimmed) return '';

  try {
    const { protocol } = new URL(trimmed);

    if (protocol === 'https:' || protocol === 'http:') return trimmed;
  } catch {
    // Reported below.
  }

  if (!warnedInvalidMcpUrls.has(`${origin}=${trimmed}`)) {
    warnedInvalidMcpUrls.add(`${origin}=${trimmed}`);
    console.warn(`[MCP] Ignoring ${origin} "${trimmed}": expected an absolute http(s) URL.`);
  }

  return '';
}

/** The `APPFLOWY_MCP_BASE_URL` runtime config, normalized; '' when unset or not an http(s) URL. */
export function getMcpBaseUrlOverride(): string {
  return normalizeMcpBaseUrl(getConfigValue('APPFLOWY_MCP_BASE_URL', ''), 'APPFLOWY_MCP_BASE_URL');
}

/**
 * The configuration for one server-info state. Resolution order: the
 * `APPFLOWY_MCP_BASE_URL` override, then server-info's `mcp_url`, then not
 * configured. A server without `/api/server-info` cannot advertise one.
 */
function resolveMcpConfiguration(serverInfo: ServerInfoState, override: string): McpConfiguration {
  if (override) return { status: 'configured', baseUrl: override, source: 'config' };
  if (serverInfo.status === 'unsupported') return MCP_NOT_CONFIGURED;
  if (serverInfo.status !== 'available') return MCP_CONFIGURATION_LOADING;

  const baseUrl = normalizeMcpBaseUrl(serverInfo.info.mcp_url, 'server-info mcp_url');

  return baseUrl ? { status: 'configured', baseUrl, source: 'server_info' } : MCP_NOT_CONFIGURED;
}

function sameMcpConfiguration(a: McpConfiguration, b: McpConfiguration): boolean {
  if (a.status !== 'configured' || b.status !== 'configured') return a.status === b.status;
  return a.baseUrl === b.baseUrl && a.source === b.source;
}

/** What server-info last confirmed; it stands while a refresh is pending or failing. */
let confirmedMcpConfiguration: McpConfiguration | undefined;
let mcpConfigurationSnapshot: { serverInfo: ServerInfoState; override: string; value: McpConfiguration } | undefined;

/**
 * The current MCP configuration, read from the server-info snapshot (see
 * `src/utils/server-info.ts`). A pending or failed server-info refresh keeps
 * the last answer, so an open page does not lose the service on a transient
 * failure. The same object is returned until the answer changes, so this is a
 * `useSyncExternalStore` snapshot (`useMcpConfiguration`).
 */
export function getMcpConfiguration(): McpConfiguration {
  const serverInfo = getServerInfoSnapshot();
  const override = getMcpBaseUrlOverride();
  const previous = mcpConfigurationSnapshot;

  if (previous && previous.serverInfo === serverInfo && previous.override === override) return previous.value;

  let value = resolveMcpConfiguration(serverInfo, override);

  if (!override) {
    if (value.status === 'loading') value = confirmedMcpConfiguration ?? value;
    else confirmedMcpConfiguration = value;
  }

  if (previous && sameMcpConfiguration(previous.value, value)) value = previous.value;

  mcpConfigurationSnapshot = { serverInfo, override, value };
  return value;
}

/** Forgets what server-info confirmed and which values were warned about; tests only. */
export function resetMcpConfigurationForTests() {
  confirmedMcpConfiguration = undefined;
  mcpConfigurationSnapshot = undefined;
  warnedInvalidMcpUrls.clear();
}

/** The MCP service's origin without a trailing slash, or '' while unknown or not configured. */
export function getMcpBaseUrl(): string {
  const configuration = getMcpConfiguration();

  return configuration.status === 'configured' ? configuration.baseUrl : '';
}

/** The MCP server URL users paste into AI apps (`<origin>/mcp`). */
export function toMcpServerUrl(baseUrl: string): string {
  return `${baseUrl}/mcp`;
}

/** The MCP server URL users paste into AI apps (`<base>/mcp`), or '' while unknown or not configured. */
export function getMcpServerUrl(): string {
  const base = getMcpBaseUrl();

  return base ? toMcpServerUrl(base) : '';
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface McpRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

interface McpResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(text: string): unknown {
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const base = getMcpBaseUrl();

  if (!base) {
    throw new McpApiError({
      status: 0,
      error: 'not_configured',
      description: 'The MCP service URL is unknown (APPFLOWY_MCP_BASE_URL or server-info mcp_url)',
    });
  }

  const url = new URL(`${base}${path}`);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function send(request: McpRequest, accessToken?: string): Promise<McpResponse> {
  const url = buildUrl(request.path, request.query);
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const callerSignal = request.signal;

  // The caller may abort while the access token is being read or refreshed.
  if (callerSignal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();

  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: 'omit',
      signal: controller.signal,
    });
    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      body: parseBody(text),
    };
  } catch (error) {
    if (callerSignal?.aborted) throw error;
    throw new McpApiError({
      status: 0,
      error: timedOut ? 'timeout' : 'network_error',
      description: timedOut ? 'The MCP service did not respond in time' : 'Could not reach the MCP service',
      cause: error,
    });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * The reason of a body without a known `reason`: its `error` when that is
 * `mcp_disabled` (the switch's own code, so a 503 is not read as an outage),
 * else what the status implies.
 */
function impliedReason(status: number, error: string | undefined): McpErrorReason | undefined {
  if (error === 'mcp_disabled') return 'mcp_disabled';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503 || status === 504) return 'temporarily_unavailable';
  if (status >= 500) return 'server_error';
  return undefined;
}

function responseError(response: McpResponse): McpApiError {
  const body = isRecord(response.body) ? response.body : {};
  const error = typeof body.error === 'string' ? body.error : undefined;
  const description =
    typeof body.error_description === 'string'
      ? body.error_description
      : typeof body.message === 'string'
      ? body.message
      : undefined;

  return new McpApiError({
    status: response.status,
    error,
    reason: isMcpErrorReason(body.reason) ? body.reason : impliedReason(response.status, error),
    description,
  });
}

function parseObject<T>(response: McpResponse): T {
  if (!response.ok) throw responseError(response);
  if (!isRecord(response.body)) {
    throw new McpApiError({
      status: response.status,
      error: 'invalid_response',
      reason: 'server_error',
      description: 'The MCP service returned an unexpected response',
    });
  }

  return response.body as T;
}

function parseList<T>(response: McpResponse, key: string): T[] {
  return asList<T>(parseObject<Record<string, unknown>>(response)[key]);
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** An approval as listed, with `approval_key` read as the client ID when an older server sent none. */
function withApprovalKey<T extends McpClientSummary & { approval_key?: unknown }>(
  approval: T
): T & { approval_key: string } {
  const approvalKey = typeof approval.approval_key === 'string' ? approval.approval_key.trim() : '';

  return { ...approval, approval_key: approvalKey || approval.client_id };
}

/** Settings with defaults for what older servers leave out (approval mode, approval keys). */
function normalizeSettings<T extends McpWorkspaceSettings>(settings: T): T {
  const approvalMode = isMcpApprovalMode(settings.approval_mode)
    ? settings.approval_mode
    : settings.allow_unapproved_clients
    ? 'any'
    : 'approved_only';

  return {
    ...settings,
    approval_mode: approvalMode,
    approved_clients: asList<McpApprovedClient>(settings.approved_clients).map(withApprovalKey),
  };
}

function parseRedirect(response: McpResponse): McpRedirectResponse {
  const redirectUrl = parseObject<Partial<McpRedirectResponse>>(response).redirect_url;

  if (typeof redirectUrl !== 'string' || !redirectUrl) {
    throw new McpApiError({
      status: response.status,
      error: 'invalid_response',
      reason: 'server_error',
      description: 'The MCP service returned no redirect URL',
    });
  }

  // A client ID metadata document may register any redirect URI; never navigate
  // to one that would run script in this origin.
  if (!isSafeMcpRedirectUrl(redirectUrl)) {
    throw new McpApiError({
      status: response.status,
      error: 'invalid_response',
      reason: 'invalid_redirect_uri',
      description: 'The MCP service returned an unsafe redirect URL',
    });
  }

  return { redirect_url: redirectUrl };
}

function invalidSessionError(cause?: unknown): McpApiError {
  return new McpApiError({
    status: 401,
    error: 'unauthorized',
    reason: 'invalid_session',
    description: 'The AppFlowy session is missing or expired',
    cause,
  });
}

/** Returns a fresh access token, refreshing the session unless another caller already rotated it. */
async function refreshedAccessToken(staleAccessToken: string): Promise<string> {
  const token = getTokenParsed();

  if (!token) throw invalidSessionError();

  if (token.access_token === staleAccessToken) {
    const session = captureTokenSession();

    try {
      // The same refresh the shared axios interceptor uses (deduplicated per refresh token).
      await refreshToken(token.refresh_token);
    } catch (error) {
      if (isAuthRefreshFailure(error)) {
        invalidTokenForSession(session);
        throw invalidSessionError(error);
      }

      throw new McpApiError({
        status: 0,
        error: 'session_refresh_failed',
        reason: 'temporarily_unavailable',
        description: 'Could not refresh the AppFlowy session',
        cause: error,
      });
    }
  }

  const refreshed = getTokenParsed();

  if (!refreshed) throw invalidSessionError();
  return refreshed.access_token;
}

async function currentAccessToken(): Promise<string> {
  const token = getTokenParsed();

  if (!token) throw invalidSessionError();
  if (token.expires_at * 1000 - Date.now() > TOKEN_REFRESH_LEEWAY_MS) return token.access_token;
  return refreshedAccessToken(token.access_token);
}

async function authorizedSend(request: McpRequest): Promise<McpResponse> {
  const accessToken = await currentAccessToken();
  const response = await send(request, accessToken);

  if (response.status !== 401 || !isRecord(response.body) || response.body.reason !== 'invalid_session') {
    return response;
  }

  // Expired or revoked between the local check and the server's: refresh once, retry once.
  return send(request, await refreshedAccessToken(accessToken));
}

function workspacePath(scope: 'me' | 'admin', workspaceId: string, suffix = ''): string {
  return `/api/mcp/${scope}/workspaces/${encodeURIComponent(workspaceId)}${suffix}`;
}

function requireClientId(clientId: string): string {
  const trimmed = clientId.trim();

  if (!trimmed) {
    throw new McpApiError({
      status: 0,
      error: 'invalid_request',
      reason: 'invalid_request',
      description: 'client_id is required',
    });
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Public and consent endpoints
// ---------------------------------------------------------------------------

/** Public client description (no auth). 404 `unknown_client` for an unknown or unresolvable client. */
export async function getMcpClientInfo(clientId: string, options: McpRequestOptions = {}): Promise<McpClientInfo> {
  const response = await send({
    method: 'GET',
    path: '/api/mcp/clients',
    query: { client_id: requireClientId(clientId) },
    signal: options.signal,
  });

  return parseObject<McpClientInfo>(response);
}

/**
 * Exchanges the user's consent for an authorization code. The response's
 * `redirect_url` carries `code`, `state` and `iss`; navigate to it at once
 * (codes expire after 60 seconds).
 */
export async function createMcpAuthorizationCode(
  request: McpAuthorizationCodeRequest,
  options: McpRequestOptions = {}
): Promise<McpRedirectResponse> {
  // Built field by field so nothing else (such as a refresh token) can reach the body.
  const body: Record<string, string> = {
    client_id: request.client_id,
    redirect_uri: request.redirect_uri,
    code_challenge: request.code_challenge,
    code_challenge_method: request.code_challenge_method,
    workspace_id: request.workspace_id,
  };
  const scope = request.scope?.trim();
  const resource = request.resource?.trim();

  if (request.state !== undefined) body.state = request.state;
  if (scope) body.scope = scope;
  if (resource) body.resource = resource;

  return parseRedirect(
    await authorizedSend({ method: 'POST', path: '/api/mcp/authorize/code', body, signal: options.signal })
  );
}

/**
 * Asks the server for the validated `access_denied` redirect (no auth). The
 * server rejects an unknown client or unregistered redirect URI, so a crafted
 * link cannot turn the consent page into an open redirect.
 */
export async function denyMcpAuthorization(
  request: McpDenyRequest,
  options: McpRequestOptions = {}
): Promise<McpRedirectResponse> {
  const body: Record<string, string> = { client_id: request.client_id, redirect_uri: request.redirect_uri };

  if (request.state !== undefined) body.state = request.state;

  return parseRedirect(await send({ method: 'POST', path: '/api/mcp/authorize/deny', body, signal: options.signal }));
}

// ---------------------------------------------------------------------------
// Member self-service
// ---------------------------------------------------------------------------

/** The caller's role, eligibility and, with `clientId`, that client's state in the workspace. */
export async function getMcpMemberStatus(
  workspaceId: string,
  clientId?: string,
  options: McpRequestOptions = {}
): Promise<McpMemberStatus> {
  const response = await authorizedSend({
    method: 'GET',
    path: workspacePath('me', workspaceId),
    query: { client_id: clientId?.trim() || undefined },
    signal: options.signal,
  });
  const status = parseObject<McpMemberStatus>(response);
  const approvalMode = isMcpApprovalMode(status.approval_mode) ? status.approval_mode : undefined;

  return {
    ...status,
    // Only an explicit `false` turns AI apps off; servers before the switch send nothing.
    enabled: status.enabled !== false,
    approval_mode: approvalMode,
    // Absent (not empty) from servers that predate it, so the panel can tell "none approved" apart.
    approved_apps: Array.isArray(status.approved_apps) ? status.approved_apps.map(withApprovalKey) : undefined,
  };
}

/** The caller's live connections in the workspace, one per device (token family). */
export async function listMyMcpConnections(
  workspaceId: string,
  options: McpRequestOptions = {}
): Promise<McpMyConnection[]> {
  const response = await authorizedSend({
    method: 'GET',
    path: workspacePath('me', workspaceId, '/connections'),
    signal: options.signal,
  });

  return parseList<McpMyConnection>(response, 'connections');
}

/**
 * The caller's live connections in every workspace they still belong to, for
 * "N apps across M workspaces". Missing counts are derived from the list.
 */
export async function listMyMcpConnectionsAcrossWorkspaces(
  options: McpRequestOptions = {}
): Promise<McpMyConnectionsAcrossWorkspaces> {
  const response = await authorizedSend({ method: 'GET', path: '/api/mcp/me/connections', signal: options.signal });
  const body = parseObject<Partial<McpMyConnectionsAcrossWorkspaces>>(response);
  const connections = asList<McpMyWorkspaceConnection>(body.connections);
  const count = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

  return {
    connections,
    workspace_count: count(body.workspace_count, new Set(connections.map(({ workspace_id }) => workspace_id)).size),
    connection_count: count(body.connection_count, connections.length),
  };
}

/**
 * Revokes the caller's connections with `clientId` in the workspace: the one
 * with `options.familyId` (one device), or all of them without it.
 */
export async function disconnectMyMcpConnection(
  workspaceId: string,
  clientId: string,
  options: McpDisconnectOptions = {}
): Promise<McpDisconnectResponse> {
  const response = await authorizedSend({
    method: 'DELETE',
    path: workspacePath('me', workspaceId, '/connections'),
    query: { client_id: requireClientId(clientId), family_id: options.familyId?.trim() || undefined },
    signal: options.signal,
  });

  return parseObject<McpDisconnectResponse>(response);
}

/** Asks the workspace owners to approve `clientId`. 409 `already_approved` when no approval is needed. */
export async function createMcpAccessRequest(
  workspaceId: string,
  clientId: string,
  options: McpRequestOptions = {}
): Promise<McpAccessRequestResponse> {
  const response = await authorizedSend({
    method: 'POST',
    path: workspacePath('me', workspaceId, '/access-requests'),
    body: { client_id: requireClientId(clientId) },
    signal: options.signal,
  });

  return parseObject<McpAccessRequestResponse>(response);
}

// ---------------------------------------------------------------------------
// Owner governance
// ---------------------------------------------------------------------------

export async function getMcpWorkspaceSettings(
  workspaceId: string,
  options: McpRequestOptions = {}
): Promise<McpWorkspaceSettings> {
  const response = await authorizedSend({
    method: 'GET',
    path: workspacePath('admin', workspaceId, '/settings'),
    signal: options.signal,
  });

  return normalizeSettings(parseObject<McpWorkspaceSettings>(response));
}

/**
 * Sets the workspace's approval policy. Moving to a stricter policy makes the
 * server approve the apps members are connected to that it would now refuse
 * (`auto_approved_clients`), so they keep working. The body also carries
 * `allow_unapproved_clients` for servers that predate `approval_mode`, which
 * then read anything but `any` as "approved apps only".
 */
export async function updateMcpWorkspaceSettings(
  workspaceId: string,
  approvalMode: McpApprovalMode,
  options: McpRequestOptions = {}
): Promise<McpWorkspaceSettingsUpdate> {
  const response = await authorizedSend({
    method: 'PUT',
    path: workspacePath('admin', workspaceId, '/settings'),
    body: { approval_mode: approvalMode, allow_unapproved_clients: approvalMode === 'any' },
    signal: options.signal,
  });
  const settings = normalizeSettings(parseObject<McpWorkspaceSettingsUpdate>(response));

  return { ...settings, auto_approved_clients: asList<McpClientSummary>(settings.auto_approved_clients) };
}

/**
 * Approves a client for the workspace; also clears its pending access request.
 * A client the catalog recognizes is approved as its app (`app:<app_id>`),
 * which covers every registration of that app.
 */
export async function approveMcpClient(
  workspaceId: string,
  clientId: string,
  options: McpRequestOptions = {}
): Promise<McpApproveResponse> {
  const response = await authorizedSend({
    method: 'PUT',
    path: workspacePath('admin', workspaceId, '/approvals'),
    query: { client_id: requireClientId(clientId) },
    signal: options.signal,
  });

  return parseObject<McpApproveResponse>(response);
}

/**
 * Revokes an approval and disconnects every member using what it covered.
 * `approvalKey` is the approved entry's `approval_key`: `app:<app_id>` revokes
 * an app-level approval (every registration of the app), a client ID that
 * client's own approval.
 */
export async function revokeMcpClientApproval(
  workspaceId: string,
  approvalKey: string,
  options: McpRequestOptions = {}
): Promise<McpDisconnectResponse> {
  const response = await authorizedSend({
    method: 'DELETE',
    path: workspacePath('admin', workspaceId, '/approvals'),
    query: { client_id: requireClientId(approvalKey) },
    signal: options.signal,
  });

  return parseObject<McpDisconnectResponse>(response);
}

/** Every member's live connection in the workspace, one per device (token family). */
export async function listMcpWorkspaceConnections(
  workspaceId: string,
  options: McpRequestOptions = {}
): Promise<McpWorkspaceConnection[]> {
  const response = await authorizedSend({
    method: 'GET',
    path: workspacePath('admin', workspaceId, '/connections'),
    signal: options.signal,
  });

  return parseList<McpWorkspaceConnection>(response, 'connections');
}

/**
 * Disconnects the connections matching `clientId` and/or `userUuid`, narrowed
 * to one device by `familyId`; refuses to run without `clientId` or `userUuid`.
 */
export async function disconnectMcpWorkspaceConnections(
  workspaceId: string,
  filter: McpWorkspaceConnectionFilter,
  options: McpRequestOptions = {}
): Promise<McpDisconnectResponse> {
  const clientId = filter.clientId?.trim() || undefined;
  const userUuid = filter.userUuid?.trim() || undefined;

  if (!clientId && !userUuid) {
    throw new McpApiError({
      status: 0,
      error: 'invalid_request',
      reason: 'invalid_request',
      description: 'A client_id or user_uuid filter is required',
    });
  }

  const response = await authorizedSend({
    method: 'DELETE',
    path: workspacePath('admin', workspaceId, '/connections'),
    query: { client_id: clientId, user_uuid: userUuid, family_id: filter.familyId?.trim() || undefined },
    signal: options.signal,
  });

  return parseObject<McpDisconnectResponse>(response);
}

/**
 * Disconnects every member's AI app connections in the workspace (`all=true`).
 * Everyone has to connect again, under the workspace's approval policy.
 */
export async function disconnectAllMcpWorkspaceConnections(
  workspaceId: string,
  options: McpRequestOptions = {}
): Promise<McpDisconnectResponse> {
  const response = await authorizedSend({
    method: 'DELETE',
    path: workspacePath('admin', workspaceId, '/connections'),
    query: { all: 'true' },
    signal: options.signal,
  });

  return parseObject<McpDisconnectResponse>(response);
}

/** Pending approval requests, most recently requested first. */
export async function listMcpAccessRequests(
  workspaceId: string,
  options: McpRequestOptions = {}
): Promise<McpAccessRequest[]> {
  const response = await authorizedSend({
    method: 'GET',
    path: workspacePath('admin', workspaceId, '/access-requests'),
    signal: options.signal,
  });

  return parseList<McpAccessRequest>(response, 'requests');
}

/**
 * Dismisses a pending request without approving it. `requestKey` is the
 * request's `mcpApprovalKey`: requests for a recognized app are merged under
 * `app:<app_id>`, others are keyed by client ID.
 */
export async function dismissMcpAccessRequest(
  workspaceId: string,
  requestKey: string,
  options: McpRequestOptions = {}
): Promise<McpDismissResponse> {
  const response = await authorizedSend({
    method: 'DELETE',
    path: workspacePath('admin', workspaceId, '/access-requests'),
    query: { client_id: requireClientId(requestKey) },
    signal: options.signal,
  });

  return parseObject<McpDismissResponse>(response);
}
