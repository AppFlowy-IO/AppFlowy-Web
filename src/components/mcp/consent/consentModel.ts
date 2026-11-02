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
 * `client_id` has surrounding whitespace, `response_type` is not `code`, PKCE
 * is not S256, or `redirect_uri` is not a URL the browser may navigate to. A
 * malformed request never redirects anywhere: its `redirect_uri` has not been
 * validated by the server.
 */
export function parseMcpConsentRequest(search: URLSearchParams): McpConsentRequest | null {
  if (SINGLE_VALUE_PARAMS.some((name) => search.getAll(name).length > 1)) return null;
  if (REQUIRED_PARAMS.some((name) => !search.get(name)?.trim())) return null;
  if (search.get('response_type') !== 'code' || search.get('code_challenge_method') !== 'S256') return null;

  const clientId = search.get('client_id') as string;
  const redirectUri = search.get('redirect_uri') as string;

  // The server and the token exchange compare client_id byte for byte, so the
  // client this page describes and approves must be the one it authorizes:
  // a padded id is refused, never trimmed.
  if (clientId !== clientId.trim()) return null;
  if (!isSafeMcpRedirectUrl(redirectUri)) return null;

  const workspaceId = search.get('workspace_id')?.trim();
  const resource = search.get('resource')?.trim();

  return {
    clientId,
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
 * access goes. Loopback and private-use redirects return to an app on this
 * computer and get the "runs on your computer" warning instead of the tick;
 * CIMD apps are named by their own https domain.
 */
export function consentHostToAcknowledge(
  client: Pick<McpClientSummary, 'client_kind' | 'verified_app'>,
  redirectUri: string
): string | null {
  if (client.client_kind !== 'dcr' || client.verified_app) return null;

  const target = describeRedirectUri(redirectUri);

  return target?.kind === 'web' && target.scheme === 'https' ? target.host : null;
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

/** What the consent flow does with one reason. */
interface ConsentReasonPolicy {
  /** It has its own message under `mcp.consent.errors`; every other reason shows `generic`. */
  message: boolean;
  /** The user can retry the same request unchanged after a moment. */
  retryable: boolean;
  /**
   * Allowing or approving that fails with it ends the flow with the error view:
   * the request itself or the user's access is wrong, or AI app connections are
   * turned off for the server, so retrying the same request cannot succeed.
   */
  fatal: boolean;
  /**
   * Its error view offers "Cancel and return to …". The server's deny refuses an
   * unknown client and a redirect URI the client never registered, and every
   * request while AI app connections are turned off; without an MCP service
   * there is no one to ask.
   */
  cancellable: boolean;
  /** Another account may help: the error view offers "Use a different account". */
  account: boolean;
}

/**
 * Every reason's policy in one row, so a reason added to `MCP_ERROR_REASONS`
 * fails type-checking until someone decides each of its behaviours.
 */
const CONSENT_REASON_POLICY = {
  invalid_request: { message: true, retryable: false, fatal: true, cancellable: true, account: false },
  not_configured: { message: true, retryable: false, fatal: false, cancellable: false, account: false },
  mcp_disabled: { message: true, retryable: false, fatal: true, cancellable: false, account: false },
  no_workspace: { message: true, retryable: false, fatal: false, cancellable: true, account: true },
  unknown_client: { message: true, retryable: false, fatal: true, cancellable: false, account: false },
  invalid_redirect_uri: { message: true, retryable: false, fatal: true, cancellable: false, account: false },
  invalid_target: { message: true, retryable: false, fatal: true, cancellable: true, account: false },
  invalid_scope: { message: true, retryable: false, fatal: true, cancellable: true, account: false },
  client_blocked: { message: true, retryable: false, fatal: true, cancellable: true, account: false },
  email_not_allowed: { message: true, retryable: false, fatal: true, cancellable: true, account: true },
  guest_not_allowed: { message: true, retryable: false, fatal: true, cancellable: true, account: true },
  not_workspace_member: { message: true, retryable: false, fatal: true, cancellable: true, account: true },
  not_workspace_owner: { message: true, retryable: false, fatal: false, cancellable: true, account: false },
  invalid_session: { message: true, retryable: false, fatal: false, cancellable: true, account: true },
  request_limit: { message: true, retryable: false, fatal: false, cancellable: true, account: false },
  rate_limited: { message: true, retryable: true, fatal: false, cancellable: true, account: false },
  temporarily_unavailable: { message: true, retryable: true, fatal: false, cancellable: true, account: false },
  server_error: { message: true, retryable: true, fatal: false, cancellable: true, account: false },
  generic: { message: true, retryable: true, fatal: false, cancellable: true, account: false },
  // These two reload the member status and show the approval controls instead of text.
  client_not_approved: { message: false, retryable: false, fatal: false, cancellable: true, account: false },
  already_approved: { message: false, retryable: false, fatal: false, cancellable: true, account: false },
} as const satisfies Record<ConsentErrorReason, ConsentReasonPolicy>;

/** A reason this Web does not know: the generic message, nothing to retry, Cancel still offered. */
const UNKNOWN_REASON_POLICY: ConsentReasonPolicy = {
  message: false,
  retryable: false,
  fatal: false,
  cancellable: true,
  account: false,
};

/**
 * The policy of `reason`. Some server fields reach this unchecked at runtime
 * (the member status's `ineligible_reason`), so a value outside the type gets
 * `UNKNOWN_REASON_POLICY` instead of failing.
 */
function consentReasonPolicy(reason: ConsentErrorReason): ConsentReasonPolicy {
  return Object.prototype.hasOwnProperty.call(CONSENT_REASON_POLICY, reason)
    ? CONSENT_REASON_POLICY[reason]
    : UNKNOWN_REASON_POLICY;
}

type ConsentReasonPolicyTable = typeof CONSENT_REASON_POLICY;

/** Reasons with their own message under `mcp.consent.errors`. */
export type ConsentErrorMessageReason = {
  [Reason in ConsentErrorReason]: ConsentReasonPolicyTable[Reason]['message'] extends true ? Reason : never;
}[ConsentErrorReason];

function hasConsentErrorMessage(reason: ConsentErrorReason): reason is ConsentErrorMessageReason {
  return consentReasonPolicy(reason).message;
}

export const CONSENT_ERROR_MESSAGE_REASONS: readonly ConsentErrorMessageReason[] = (
  Object.keys(CONSENT_REASON_POLICY) as ConsentErrorReason[]
).filter(hasConsentErrorMessage);

/** The `mcp.consent.errors.*` key for a reason. */
export function consentErrorMessageKey(reason: ConsentErrorReason): `mcp.consent.errors.${ConsentErrorMessageReason}` {
  return `mcp.consent.errors.${hasConsentErrorMessage(reason) ? reason : 'generic'}`;
}

/** Failures a user can retry unchanged after a moment. */
export function isRetryableConsentReason(reason: ConsentErrorReason): boolean {
  return consentReasonPolicy(reason).retryable;
}

/**
 * How a failed Cancel (the server's deny) ends, on the consent view and the
 * error views alike: `refused` when the request itself is wrong, so the
 * server would refuse every retry and Cancel is not offered again;
 * `transient` when the same deny may succeed in a moment, so Cancel stays.
 */
export function classifyDenyFailure(reason: ConsentErrorReason): 'refused' | 'transient' {
  return isRetryableConsentReason(reason) ? 'transient' : 'refused';
}

/** Allowing or approving that fails with `reason` ends the flow with the error view. */
export function isFatalConsentReason(reason: ConsentErrorReason): boolean {
  return consentReasonPolicy(reason).fatal;
}

/**
 * Whether an error view of the consent flow offers to cancel: the request
 * parsed, so the server can validate the `access_denied` redirect and the AI
 * app stops waiting instead of timing out.
 */
export function isCancellableConsentReason(reason: ConsentErrorReason): boolean {
  return consentReasonPolicy(reason).cancellable;
}

/** Reasons for which another account may help: the error view offers "Use a different account". */
export function isAccountConsentReason(reason: ConsentErrorReason): boolean {
  return consentReasonPolicy(reason).account;
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
