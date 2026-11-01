import { getMcpClientDisplayName } from '@/application/mcp/setup';
import {
  isMcpApiError,
  isMcpAppApprovalKey,
  MCP_APP_APPROVAL_KEY_PREFIX,
  mcpApprovalKey,
  mcpTimestampToDate,
  type McpAccessRequester,
  type McpApprovalMode,
  type McpClientSummary,
  type McpConnectionDetails,
  type McpTimestamp,
  type McpWorkspaceConnection,
} from '@/application/services/domains/mcp';
import { consentErrorMessageKey } from '@/components/mcp/consent/consentModel';

import type { TFunction } from 'i18next';

/**
 * App names, member names and server data are raw text. React escapes what it
 * renders, so i18next must not escape them too (`Q&A` would show as `Q&amp;A`).
 */
export const RAW_INTERPOLATION = { interpolation: { escapeValue: false } };

/** "Requested by" lists this many names, then "and N more". */
export const MAX_REQUESTER_NAMES = 3;

/**
 * Localized text for a failed MCP request: by `reason`, never the server's
 * English description. Settings shares the consent page's messages
 * (`mcp.consent.errors.*`) except where those send the user back to the AI app.
 */
export function mcpErrorText(error: unknown, t: TFunction): string {
  if (!isMcpApiError(error)) return t('mcp.consent.errors.generic');
  if (error.error === 'network_error' || error.error === 'timeout') {
    return t('mcp.consent.errors.temporarily_unavailable');
  }

  switch (error.reason) {
    case 'not_workspace_owner':
      return t('settings.mcp.notOwner');
    case 'unknown_client':
      // Approving an app that is not registered (typed client ID, or a request whose app is gone):
      // the consent text ("Start again from your AI app") does not apply here.
      return t('settings.mcp.unknownClientId');
    default:
      return t(consentErrorMessageKey(error.reason ?? 'generic'));
  }
}

/** The toast for a failed action ("That didn't work. …"). */
export function mcpActionFailedMessage(error: unknown, t: TFunction): string {
  return t('settings.mcp.actionFailed', { message: mcpErrorText(error, t), ...RAW_INTERPOLATION });
}

/**
 * The caller lost the access the panel was rendered for (no longer an owner,
 * a member, or allowed by the email gate), or AI app connections were turned
 * off for the server (`mcp_disabled`): the member status must be reloaded.
 */
export function isMcpAccessLost(error: unknown): boolean {
  if (!isMcpApiError(error)) return false;
  if (error.reason === 'mcp_disabled') return true;
  return (
    error.status === 403 &&
    (error.reason === 'not_workspace_owner' ||
      error.reason === 'not_workspace_member' ||
      error.reason === 'email_not_allowed')
  );
}

/** A valid Date for an MCP timestamp, or null when it is absent or out of range. */
export function mcpDate(value?: McpTimestamp | null): Date | null {
  const date = mcpTimestampToDate(value);

  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = { ...DATE_FORMAT, hour: 'numeric', minute: '2-digit' };

/** "5 minutes ago" up to a week, then the date ("Oct 3, 2026"). */
export function formatMcpRelativeTime(date: Date, t: TFunction, now = Date.now()): string {
  // Clock skew can put a fresh timestamp in the future; it reads as one second ago.
  const seconds = Math.max(1, Math.floor((now - date.getTime()) / 1000));

  if (seconds < 60) return t('globalComment.showSeconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return t('globalComment.showMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);

  if (hours < 24) return t('globalComment.showHours', { count: hours });
  const days = Math.floor(hours / 24);

  if (days < 7) return t('globalComment.showDays', { count: days });
  return new Intl.DateTimeFormat(undefined, DATE_FORMAT).format(date);
}

/** The absolute date and time, for tooltips. */
export function formatMcpDateTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, DATE_TIME_FORMAT).format(date);
}

type McpClientNames = Pick<McpClientSummary, 'client_name' | 'client_host' | 'app_name' | 'verified_app'>;

/** An app's name (the verified catalog's for a recognized app), else its host, else "Unknown app". */
export function mcpClientName(client: McpClientNames | null | undefined, t: TFunction): string {
  return getMcpClientDisplayName(client) ?? t('settings.mcp.unknownApp');
}

/** App names for a sentence: "Claude, Cursor". */
export function mcpClientNames(clients: readonly McpClientNames[], t: TFunction): string {
  return clients.map((client) => mcpClientName(client, t)).join(', ');
}

type McpAppIdentity = Pick<McpClientSummary, 'client_id' | 'app_id' | 'verified_app'>;

/** An approval as the panel matches it: what it covers (`approval_key`, else the client ID). */
type McpApprovalCoverage = Pick<McpClientSummary, 'client_id'> & { approval_key?: string | null };

/**
 * Whether an approval covers `client`: an app-level approval (`app:<app_id>`)
 * covers every registration the catalog recognizes as that app, any other
 * approval only its own client ID.
 */
export function mcpApprovalCovers(approval: McpApprovalCoverage, client: McpAppIdentity): boolean {
  const key = approval.approval_key?.trim() || approval.client_id;

  if (isMcpAppApprovalKey(key)) return Boolean(client.verified_app && client.app_id) && mcpApprovalKey(client) === key;
  return key === client.client_id;
}

/** Whether one of `approvals` covers `client` (its own approval, or its app's). */
export function mcpIsApproved(approvals: readonly McpApprovalCoverage[], client: McpAppIdentity): boolean {
  return approvals.some((approval) => mcpApprovalCovers(approval, client));
}

/**
 * The approval of a whole app (`app:<app_id>`) that still covers the client of
 * `approval`, a per-client approval, once that one is revoked. A client
 * approved on its own (before app-level approvals existed, or by client ID)
 * can sit next to an approval of all its app's installs. Revoking it then
 * disconnects members who can connect again right away. The keys are compared
 * directly: `mcpApprovalCovers` would read the revoked row's own key.
 */
export function mcpRemainingAppApproval<T extends McpApprovalCoverage>(
  approval: McpApprovalCoverage & Pick<McpClientSummary, 'app_id' | 'verified_app'>,
  approvals: readonly T[]
): T | undefined {
  const key = approval.approval_key?.trim() || approval.client_id;
  const appId = approval.verified_app === true ? approval.app_id?.trim() : undefined;

  if (!appId || isMcpAppApprovalKey(key)) return undefined;
  const appKey = `${MCP_APP_APPROVAL_KEY_PREFIX}${appId}`;

  return approvals.find((other) => (other.approval_key?.trim() || other.client_id) === appKey);
}

/** How strict each approval policy is: a higher rank refuses more apps. */
const APPROVAL_MODE_RANK: Record<McpApprovalMode, number> = { any: 0, verified_and_approved: 1, approved_only: 2 };

/** `next` refuses apps that `current` lets members connect without approval. */
export function isStricterMcpApprovalMode(next: McpApprovalMode, current: McpApprovalMode): boolean {
  return APPROVAL_MODE_RANK[next] > APPROVAL_MODE_RANK[current];
}

type McpVerifiedIdentity = Pick<McpClientSummary, 'verified_app' | 'identity_verified'>;

/**
 * Whether `mode` lets members connect `client` without an owner's approval.
 * Under `verified_and_approved` that takes a proven identity: the catalog's
 * web apps, not the ones that run on the user's computer.
 */
export function mcpModeAdmitsWithoutApproval(mode: McpApprovalMode, client: McpVerifiedIdentity) {
  return (
    mode === 'any' ||
    (mode === 'verified_and_approved' && client.verified_app === true && client.identity_verified === true)
  );
}

/**
 * The apps members are connected to that the `current` policy admits without
 * an approval and the `next` one would refuse, each once (per app for
 * recognized apps), in connection-list order. When an owner moves to a
 * stricter policy, the server approves exactly these (`auto_approved_clients`)
 * so the members using them keep working.
 */
export function mcpClientsKeptApproved<T extends McpAppIdentity & McpVerifiedIdentity>(
  connections: readonly T[] | null | undefined,
  approvals: readonly McpApprovalCoverage[],
  next: McpApprovalMode,
  current: McpApprovalMode
): T[] {
  const kept = new Map<string, T>();

  connections?.forEach((connection) => {
    const key = mcpApprovalKey(connection);

    if (kept.has(key) || mcpModeAdmitsWithoutApproval(next, connection)) return;
    // A connection the current policy already refuses stays refused; nothing to keep.
    if (!mcpModeAdmitsWithoutApproval(current, connection)) return;
    if (!mcpIsApproved(approvals, connection)) kept.set(key, connection);
  });
  return Array.from(kept.values());
}

/** A key for one connection: its client and token family (legacy records: its user and connection time). */
export function mcpConnectionKey(
  connection: Pick<McpClientSummary, 'client_id'> &
    Pick<McpConnectionDetails, 'family_id' | 'connected_at'> & { user_uuid?: string }
): string {
  const family = connection.family_id?.trim();

  return family
    ? `${connection.client_id}#${family}`
    : `${connection.client_id}#${connection.user_uuid ?? ''}@${connection.connected_at}`;
}

/** The device line of a connection, when the app described one at sign-in. */
export function mcpDeviceLabel(connection: Pick<McpConnectionDetails, 'device_label'>): string | undefined {
  return connection.device_label?.trim() || undefined;
}

function requesterName(requester: McpAccessRequester): string {
  return requester.name?.trim() || requester.email?.trim() || requester.user_uuid;
}

/** "Requested by Ann, Bo, Cy and 2 more"; null without requesters. */
export function mcpRequestedBy(
  requesters: readonly McpAccessRequester[] | null | undefined,
  t: TFunction
): string | null {
  const names = (requesters ?? []).map(requesterName).filter(Boolean);

  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_REQUESTER_NAMES).join(', ');
  const more = names.length - MAX_REQUESTER_NAMES;

  return more > 0
    ? t('settings.mcp.requestedByMore', { names: shown, count: more, ...RAW_INTERPOLATION })
    : t('settings.mcp.requestedBy', { names: shown, ...RAW_INTERPOLATION });
}

export interface McpMemberLabel {
  name: string;
  /** Shown under the name; absent when the name is the email or unknown. */
  email?: string;
}

/**
 * A connected member's display name and, when the name is known and is not
 * the email itself (profiles often default the name to the email), the email
 * under it.
 */
export function mcpMemberLabel(
  connection: Pick<McpWorkspaceConnection, 'user_name' | 'user_email' | 'user_uuid'>
): McpMemberLabel {
  const name = connection.user_name?.trim();
  const email = connection.user_email?.trim() || undefined;

  if (!name) return { name: email || connection.user_uuid };
  return { name, email: email && email.toLowerCase() !== name.toLowerCase() ? email : undefined };
}

/** One member's connections in the owner's list. */
export interface McpMemberConnections<T> {
  userUuid: string;
  member: McpMemberLabel;
  /** In list order; one per device (token family). */
  connections: T[];
}

/** Connections grouped by member, members in the order of their first connection in the list. */
export function groupMcpConnectionsByMember<T extends McpWorkspaceConnection>(
  connections: readonly T[]
): McpMemberConnections<T>[] {
  const groups = new Map<string, McpMemberConnections<T>>();

  connections.forEach((connection) => {
    const group = groups.get(connection.user_uuid);

    if (group) group.connections.push(connection);
    else {
      groups.set(connection.user_uuid, {
        userUuid: connection.user_uuid,
        member: mcpMemberLabel(connection),
        connections: [connection],
      });
    }
  });
  return Array.from(groups.values());
}
