/**
 * Pure rules of the MCP consent page (`/oauth/mcp/authorize`): which requests
 * are valid, which workspace is preselected, which scopes start checked and
 * which server reasons end the flow. The page and its hook stay thin on top.
 */
import {
  describeRedirectUri,
  isSafeMcpRedirectUrl,
  MCP_SCOPES,
  parseScopes,
  type McpScope,
} from '@/application/mcp/setup';
import {
  isMcpApiError,
  type McpClientSummary,
  type McpErrorReason,
  type McpMemberStatus,
} from '@/application/services/domains/mcp';
import { Role, type Workspace } from '@/application/types';

/** The OAuth authorization request the MCP service forwarded to the consent page. */
export interface McpConsentRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  /** Echoed back to the client exactly as received; absent when the client sent none. */
  state?: string;
  /** Space-separated scopes the client asked for; unknown values are ignored. */
  scope?: string;
  /** RFC 8707 resource indicator, forwarded to the server unchanged. */
  resource?: string;
  /** Workspace the client or the MCP service suggested. */
  workspaceId?: string;
}

const REQUIRED_PARAMS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method'];
const SINGLE_VALUE_PARAMS = [...REQUIRED_PARAMS, 'state', 'scope', 'resource', 'workspace_id'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The consent request in `search`, or null when it is malformed: a required
 * parameter is missing or empty, a parameter is repeated (RFC 6749 §3.1),
 * `response_type` is not `code`, PKCE is not S256, or `redirect_uri` is not a
 * URL the browser may navigate to. A malformed request never redirects
 * anywhere: its `redirect_uri` has not been validated by the server.
 */
export function parseMcpConsentRequest(search: URLSearchParams): McpConsentRequest | null {
  if (SINGLE_VALUE_PARAMS.some((name) => search.getAll(name).length > 1)) return null;
  if (REQUIRED_PARAMS.some((name) => !search.get(name)?.trim())) return null;
  if (search.get('response_type') !== 'code' || search.get('code_challenge_method') !== 'S256') return null;

  const redirectUri = search.get('redirect_uri') as string;

  if (!isSafeMcpRedirectUrl(redirectUri)) return null;

  const workspaceId = search.get('workspace_id')?.trim();
  const resource = search.get('resource')?.trim();

  return {
    clientId: search.get('client_id') as string,
    redirectUri,
    codeChallenge: search.get('code_challenge') as string,
    codeChallengeMethod: 'S256',
    state: search.get('state') ?? undefined,
    scope: search.get('scope') ?? undefined,
    resource: resource || undefined,
    // The MCP service only forwards UUIDs; anything else is ignored rather than fatal.
    workspaceId: workspaceId && UUID_PATTERN.test(workspaceId) ? workspaceId : undefined,
  };
}

/**
 * Whether this page is rendered inside a frame. The server also sends
 * `X-Frame-Options: DENY`; this guards hosts that drop the header.
 */
export function isConsentFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/** Scopes checked when the page opens: `read` always, plus the supported scopes the client requested. */
export function initialConsentScopes(scope?: string | null): McpScope[] {
  const requested = new Set<McpScope>(['read', ...parseScopes(scope)]);

  return MCP_SCOPES.filter((candidate) => requested.has(candidate));
}

/**
 * The app asked for neither `write` nor `admin`, so it gets read-only access
 * unless the user ticks more. Apps that send no scope at all land here, which
 * users may not expect; the page says so.
 */
export function isReadOnlyConsentRequest(scope?: string | null): boolean {
  const requested = parseScopes(scope);

  return !requested.includes('write') && !requested.includes('admin');
}

/**
 * The host the user must say they recognize before allowing, or null. Only
 * for a self-registered (DCR) app the verified catalog does not recognize
 * that returns to an https host other than this computer: its name is
 * self-asserted, so the redirect host is the one thing that says where the
 * access goes. Loopback redirects get the "runs on your computer" warning
 * instead; CIMD apps are named by their own https domain.
 */
export function consentHostToAcknowledge(
  client: Pick<McpClientSummary, 'client_kind' | 'verified_app'>,
  redirectUri: string
): string | null {
  if (client.client_kind !== 'dcr' || client.verified_app) return null;

  const target = describeRedirectUri(redirectUri);

  return target && target.scheme === 'https' && !target.loopback ? target.host : null;
}

/** `scopes` with `scope` turned on or off, in canonical order; `read` cannot be removed. */
export function toggleConsentScope(scopes: readonly McpScope[], scope: McpScope, checked: boolean): McpScope[] {
  const next = new Set<McpScope>(scopes);

  if (checked) next.add(scope);
  else next.delete(scope);
  next.add('read');
  return MCP_SCOPES.filter((candidate) => next.has(candidate));
}

/** Guests cannot connect AI apps; a missing role (older servers) is not treated as guest. */
export function isGuestWorkspace(workspace: Pick<Workspace, 'role'>): boolean {
  return workspace.role === Role.Guest;
}

/**
 * The workspace selected when the page opens: the requested one, else the
 * user's current (last visited) one, else the first, skipping guest
 * workspaces. Undefined when every workspace is a guest workspace.
 */
export function pickDefaultWorkspaceId(
  workspaces: readonly Workspace[],
  preferred: { requested?: string; current?: string }
): string | undefined {
  const eligible = workspaces.filter((workspace) => !isGuestWorkspace(workspace));
  const find = (id?: string) =>
    id ? eligible.find((workspace) => workspace.id.toLowerCase() === id.toLowerCase()) : undefined;

  return (find(preferred.requested) ?? find(preferred.current) ?? eligible[0])?.id;
}

/** Why the flow stopped: a server reason, or one the page detects itself. */
export type ConsentErrorReason = McpErrorReason | 'not_configured' | 'no_workspace' | 'generic';

/** Reasons with their own message under `mcp.consent.errors`; every other reason shows `generic`. */
export const CONSENT_ERROR_MESSAGE_REASONS = [
  'invalid_request',
  'not_configured',
  'mcp_disabled',
  'no_workspace',
  'unknown_client',
  'invalid_redirect_uri',
  'invalid_target',
  'invalid_scope',
  'client_blocked',
  'email_not_allowed',
  'guest_not_allowed',
  'not_workspace_member',
  'not_workspace_owner',
  'invalid_session',
  'request_limit',
  'rate_limited',
  'temporarily_unavailable',
  'server_error',
  'generic',
] as const;

export type ConsentErrorMessageReason = (typeof CONSENT_ERROR_MESSAGE_REASONS)[number];

/** The `mcp.consent.errors.*` key for a reason. */
export function consentErrorMessageKey(reason: ConsentErrorReason): `mcp.consent.errors.${ConsentErrorMessageReason}` {
  const known = (CONSENT_ERROR_MESSAGE_REASONS as readonly string[]).includes(reason)
    ? (reason as ConsentErrorMessageReason)
    : 'generic';

  return `mcp.consent.errors.${known}`;
}

/** Failures a user can retry unchanged after a moment. */
const RETRYABLE_REASONS: ReadonlySet<ConsentErrorReason> = new Set([
  'rate_limited',
  'temporarily_unavailable',
  'server_error',
  'generic',
]);

export function isRetryableConsentReason(reason: ConsentErrorReason): boolean {
  return RETRYABLE_REASONS.has(reason);
}

/**
 * Reasons that end the flow with the error view when allowing or approving
 * fails. The request itself or the user's access is wrong, or AI app
 * connections are turned off for the server; retrying the same request cannot
 * succeed.
 */
const FATAL_ACTION_REASONS: ReadonlySet<ConsentErrorReason> = new Set([
  'mcp_disabled',
  'email_not_allowed',
  'guest_not_allowed',
  'not_workspace_member',
  'unknown_client',
  'invalid_redirect_uri',
  'invalid_target',
  'invalid_scope',
  'client_blocked',
  'invalid_request',
]);

export function isFatalConsentReason(reason: ConsentErrorReason): boolean {
  return FATAL_ACTION_REASONS.has(reason);
}

/**
 * Error views without "Cancel and return to …": the server's deny refuses an
 * unknown client and a redirect URI the client never registered, and every
 * request while AI app connections are turned off; without an MCP service
 * there is no one to ask.
 */
const UNCANCELLABLE_REASONS: ReadonlySet<ConsentErrorReason> = new Set([
  'unknown_client',
  'invalid_redirect_uri',
  'not_configured',
  'mcp_disabled',
]);

/**
 * Whether an error view of the consent flow offers to cancel: the request
 * parsed, so the server can validate the `access_denied` redirect and the AI
 * app stops waiting instead of timing out.
 */
export function isCancellableConsentReason(reason: ConsentErrorReason): boolean {
  return !UNCANCELLABLE_REASONS.has(reason);
}

/** Reasons for which another account may help: the error view offers "Use a different account". */
const ACCOUNT_REASONS: ReadonlySet<ConsentErrorReason> = new Set([
  'email_not_allowed',
  'guest_not_allowed',
  'not_workspace_member',
  'no_workspace',
  'invalid_session',
]);

export function isAccountConsentReason(reason: ConsentErrorReason): boolean {
  return ACCOUNT_REASONS.has(reason);
}

/**
 * The reason behind a failed request. MCP errors carry a machine reason; a
 * request that got no response reads as temporarily unavailable, a 401
 * without a reason as an invalid session, and anything else as generic.
 */
export function toConsentErrorReason(error: unknown): ConsentErrorReason {
  if (!isMcpApiError(error)) return 'generic';
  if (error.error === 'not_configured') return 'not_configured';
  if (error.reason) return error.reason;
  if (error.status === 0) return 'temporarily_unavailable';
  if (error.status === 401) return 'invalid_session';
  return 'generic';
}

/**
 * A member status that rules out consent in this workspace, as an error view
 * reason. AI app connections turned off for the server come first: no account
 * or workspace could connect then.
 */
export function consentStatusBlocker(status: McpMemberStatus): ConsentErrorReason | null {
  if (status.enabled === false) return 'mcp_disabled';
  if (!status.eligible) return status.ineligible_reason ?? 'generic';
  if (status.client?.blocked) return 'client_blocked';
  if (status.client && !status.client.known) return 'unknown_client';
  return null;
}

/** What the primary button does for a member status. */
export type ConsentPrimaryAction = 'allow' | 'approve-and-allow' | 'request-approval';

/**
 * Decided by `client.approved` alone: the server already reports approved
 * when the workspace does not require approval, and it is the decision
 * authorization enforces. `requires_approval` mirrors the workspace setting,
 * which that decision can trail by up to 30 seconds after an owner turns the
 * requirement off; trusting it could offer an Allow the server still refuses.
 */
export function consentPrimaryAction(status: McpMemberStatus): ConsentPrimaryAction {
  const { client } = status;
  // Without client details the server decides at authorization time.
  const needsApproval = Boolean(client) && !client?.approved;

  if (!needsApproval) return 'allow';
  return status.role === 'owner' ? 'approve-and-allow' : 'request-approval';
}
