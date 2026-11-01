import translations from '@/@types/translations/en.json';
import { McpApiError } from '@/application/services/domains/mcp';

import {
  formatMcpRelativeTime,
  groupMcpConnectionsByMember,
  isMcpAccessLost,
  isStricterMcpApprovalMode,
  mcpActionFailedMessage,
  mcpApprovalCovers,
  mcpClientName,
  mcpClientNames,
  mcpClientsKeptApproved,
  mcpConnectionKey,
  mcpDate,
  mcpDeviceLabel,
  mcpErrorText,
  mcpIsApproved,
  mcpMemberLabel,
  mcpModeAdmitsWithoutApproval,
  mcpRemainingAppApproval,
  mcpRequestedBy,
} from '../format';

import type { TFunction } from 'i18next';

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], translations);
}

/** en.json with `{{name}}` interpolation and i18next's plural suffixes. */
const t = ((key: string, params: Record<string, unknown> = {}) => {
  const { count } = params;
  const plural = typeof count === 'number' ? [`${key}_${count === 0 ? 'zero' : count === 1 ? 'one' : 'other'}`] : [];
  const text = [...plural, key].map(lookup).find((value): value is string => typeof value === 'string');

  return text === undefined ? key : text.replace(/{{(\w+)}}/g, (_match, name: string) => String(params[name] ?? ''));
}) as unknown as TFunction;

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const ago = (seconds: number) => new Date(NOW - seconds * 1000);

describe('formatMcpRelativeTime', () => {
  it.each([
    [0, '1 second ago'],
    [-30, '1 second ago'],
    [42, '42 seconds ago'],
    [60, '1 minute ago'],
    [59 * 60, '59 minutes ago'],
    [3600, '1 hour ago'],
    [23 * 3600, '23 hours ago'],
    [86400, '1 day ago'],
    [6 * 86400, '6 days ago'],
  ])('reads %i seconds ago as "%s"', (seconds, expected) => {
    expect(formatMcpRelativeTime(ago(seconds), t, NOW)).toBe(expected);
  });

  it('shows the date from a week on', () => {
    const date = ago(7 * 86400);

    expect(formatMcpRelativeTime(date, t, NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
    );
  });
});

describe('mcpDate', () => {
  it('accepts unix seconds and RFC 3339, and rejects missing or out-of-range values', () => {
    expect(mcpDate(1_700_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(mcpDate('2026-10-01T10:00:00Z')?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(mcpDate(null)).toBeNull();
    expect(mcpDate('not a date')).toBeNull();
    expect(mcpDate(1e20)).toBeNull();
  });
});

describe('mcpRequestedBy', () => {
  const requester = (user_uuid: string, name?: string | null, email?: string | null) => ({
    user_uuid,
    name,
    email,
    requested_at: 0,
  });

  it('names up to three requesters, falling back to email and then the user ID', () => {
    expect(mcpRequestedBy([requester('u1', 'Ann'), requester('u2', ' ', 'bo@example.com'), requester('u3')], t)).toBe(
      'Requested by Ann, bo@example.com, u3'
    );
  });

  it('counts the rest', () => {
    const requesters = ['A', 'B', 'C', 'D', 'E'].map((name) => requester(name, name));

    expect(mcpRequestedBy(requesters, t)).toBe('Requested by A, B, C and 2 more');
  });

  it('returns null without requesters', () => {
    expect(mcpRequestedBy([], t)).toBeNull();
    expect(mcpRequestedBy(undefined, t)).toBeNull();
  });

  it('does not HTML-escape names', () => {
    expect(mcpRequestedBy([requester('u1', 'Q&A <bot>')], t)).toBe('Requested by Q&A <bot>');
  });
});

describe('error text', () => {
  it('maps reasons with a message and falls back to the generic one', () => {
    expect(mcpErrorText(new McpApiError({ status: 429, reason: 'rate_limited' }), t)).toBe(
      translations.mcp.consent.errors.rate_limited
    );
    expect(mcpErrorText(new McpApiError({ status: 0, error: 'timeout' }), t)).toBe(
      translations.mcp.consent.errors.temporarily_unavailable
    );
    expect(mcpErrorText(new McpApiError({ status: 401, reason: 'invalid_session' }), t)).toBe(
      translations.mcp.consent.errors.invalid_session
    );
    expect(mcpErrorText(new McpApiError({ status: 409, reason: 'already_approved' }), t)).toBe(
      translations.mcp.consent.errors.generic
    );
    expect(mcpErrorText(new McpApiError({ status: 500 }), t)).toBe(translations.mcp.consent.errors.generic);
    expect(mcpErrorText(new Error('boom'), t)).toBe(translations.mcp.consent.errors.generic);
  });

  it('uses Settings wording where the consent text points back to the AI app', () => {
    expect(mcpErrorText(new McpApiError({ status: 403, reason: 'not_workspace_owner' }), t)).toBe(
      translations.settings.mcp.notOwner
    );
    expect(mcpErrorText(new McpApiError({ status: 404, reason: 'unknown_client' }), t)).toBe(
      translations.settings.mcp.unknownClientId
    );
  });

  it('wraps action failures', () => {
    expect(mcpActionFailedMessage(new McpApiError({ status: 404, reason: 'unknown_client' }), t)).toBe(
      "That didn't work. No app is registered with this client ID."
    );
  });

  it('recognizes lost owner, member or email-gate access', () => {
    expect(isMcpAccessLost(new McpApiError({ status: 403, reason: 'not_workspace_owner' }))).toBe(true);
    expect(isMcpAccessLost(new McpApiError({ status: 403, reason: 'not_workspace_member' }))).toBe(true);
    expect(isMcpAccessLost(new McpApiError({ status: 403, reason: 'email_not_allowed' }))).toBe(true);
    expect(isMcpAccessLost(new McpApiError({ status: 401, reason: 'invalid_session' }))).toBe(false);
    expect(isMcpAccessLost(new McpApiError({ status: 500, reason: 'server_error' }))).toBe(false);
  });

  it('reloads the member status when AI app connections were turned off, and says so', () => {
    const disabled = new McpApiError({ status: 503, error: 'mcp_disabled', reason: 'mcp_disabled' });

    expect(isMcpAccessLost(disabled)).toBe(true);
    expect(isMcpAccessLost(new McpApiError({ status: 503, reason: 'temporarily_unavailable' }))).toBe(false);
    expect(mcpErrorText(disabled, t)).toBe(translations.mcp.consent.errors.mcp_disabled);
    expect(mcpActionFailedMessage(disabled, t)).toBe(
      "That didn't work. AI app connections are turned off on this AppFlowy server. Ask your administrator."
    );
  });
});

describe('names', () => {
  it('names an app by name, host, or "Unknown app"', () => {
    expect(mcpClientName({ client_name: 'Claude', client_host: 'claude.ai' }, t)).toBe('Claude');
    expect(mcpClientName({ client_name: null, client_host: 'claude.ai' }, t)).toBe('claude.ai');
    expect(mcpClientName(null, t)).toBe('Unknown app');
  });

  it('names a recognized app by the catalog, never by an unverified app name', () => {
    expect(mcpClientName({ client_name: 'cursor-vscode', app_name: 'Cursor', verified_app: true }, t)).toBe('Cursor');
    expect(mcpClientName({ client_name: 'My tool', app_name: 'Cursor', verified_app: false }, t)).toBe('My tool');
  });

  it('shows a member by name with email, by email alone, or by user ID', () => {
    expect(mcpMemberLabel({ user_uuid: 'u1', user_name: 'Ann', user_email: 'ann@example.com' })).toEqual({
      name: 'Ann',
      email: 'ann@example.com',
    });
    expect(mcpMemberLabel({ user_uuid: 'u2', user_name: '', user_email: 'bo@example.com' })).toEqual({
      name: 'bo@example.com',
    });
    expect(mcpMemberLabel({ user_uuid: 'u3' })).toEqual({ name: 'u3' });
  });

  it('does not repeat the email under a name that is the email', () => {
    expect(
      mcpMemberLabel({ user_uuid: 'u4', user_name: 'olivia@example.com', user_email: 'Olivia@Example.com ' })
    ).toEqual({ name: 'olivia@example.com' });
  });

  it('joins app names for a sentence', () => {
    expect(mcpClientNames([{ client_name: 'Cursor' }, { client_name: null, client_host: 'claude.ai' }, {}], t)).toBe(
      'Cursor, claude.ai, Unknown app'
    );
  });
});

describe('approvals', () => {
  // Cursor runs on members' computers: recognized, but its identity is not proven.
  const cursorA = { client_id: 'dcr-cursor-a', app_id: 'cursor', verified_app: true, identity_verified: false };
  const cursorB = { client_id: 'dcr-cursor-b', app_id: 'cursor', verified_app: true, identity_verified: false };
  const claude = { client_id: 'dcr-claude', app_id: 'claude', verified_app: true, identity_verified: true };
  const tool = { client_id: 'dcr-tool', app_id: null, verified_app: false };

  it('covers every registration of an app with its app-level key, and one client otherwise', () => {
    const appApproval = { client_id: 'dcr-cursor-a', approval_key: 'app:cursor' };
    const clientApproval = { client_id: 'dcr-cursor-a', approval_key: 'dcr-cursor-a' };

    expect(mcpApprovalCovers(appApproval, cursorA)).toBe(true);
    expect(mcpApprovalCovers(appApproval, cursorB)).toBe(true);
    expect(mcpApprovalCovers(appApproval, tool)).toBe(false);
    // An app id the catalog did not vouch for is not covered.
    expect(mcpApprovalCovers(appApproval, { ...cursorB, verified_app: false })).toBe(false);
    expect(mcpApprovalCovers(clientApproval, cursorA)).toBe(true);
    expect(mcpApprovalCovers(clientApproval, cursorB)).toBe(false);
    // Older servers send no approval_key: the client ID is the key.
    expect(mcpApprovalCovers({ client_id: 'dcr-tool' }, tool)).toBe(true);
    expect(mcpIsApproved([clientApproval, { client_id: 'dcr-tool' }], cursorB)).toBe(false);
    expect(mcpIsApproved([appApproval], cursorB)).toBe(true);
  });

  it('orders the policies by how many apps they refuse', () => {
    expect(isStricterMcpApprovalMode('approved_only', 'verified_and_approved')).toBe(true);
    expect(isStricterMcpApprovalMode('verified_and_approved', 'any')).toBe(true);
    expect(isStricterMcpApprovalMode('any', 'approved_only')).toBe(false);
    expect(isStricterMcpApprovalMode('verified_and_approved', 'approved_only')).toBe(false);
    expect(mcpModeAdmitsWithoutApproval('any', tool)).toBe(true);
    expect(mcpModeAdmitsWithoutApproval('verified_and_approved', claude)).toBe(true);
    // Recognized is not enough: an app on the user's computer needs an approval.
    expect(mcpModeAdmitsWithoutApproval('verified_and_approved', cursorA)).toBe(false);
    expect(mcpModeAdmitsWithoutApproval('verified_and_approved', { ...claude, identity_verified: undefined })).toBe(
      false
    );
    expect(mcpModeAdmitsWithoutApproval('verified_and_approved', { ...tool, identity_verified: true })).toBe(false);
    expect(mcpModeAdmitsWithoutApproval('verified_and_approved', tool)).toBe(false);
    expect(mcpModeAdmitsWithoutApproval('approved_only', claude)).toBe(false);
  });

  it('finds the approval of all installs that outlives a per-client approval of the same app', () => {
    const appApproval = { client_id: 'app:cursor', app_id: 'cursor', verified_app: true, approval_key: 'app:cursor' };
    const legacyCursor = { ...cursorA, approval_key: cursorA.client_id };
    const legacyTool = { ...tool, approval_key: tool.client_id };

    expect(mcpRemainingAppApproval(legacyCursor, [legacyCursor, appApproval])).toBe(appApproval);
    // Nothing else covers it, the app row itself, or a client the catalog did not recognize.
    expect(mcpRemainingAppApproval(legacyCursor, [legacyCursor])).toBeUndefined();
    expect(mcpRemainingAppApproval(appApproval, [legacyCursor, appApproval])).toBeUndefined();
    expect(mcpRemainingAppApproval(legacyTool, [legacyTool, appApproval])).toBeUndefined();
    expect(
      mcpRemainingAppApproval({ ...legacyCursor, verified_app: false }, [legacyCursor, appApproval])
    ).toBeUndefined();
    // Another app's approval does not count.
    expect(
      mcpRemainingAppApproval(legacyCursor, [{ client_id: 'app:claude', approval_key: 'app:claude' }])
    ).toBeUndefined();
  });
});

describe('mcpClientsKeptApproved', () => {
  // Claude is a web app the catalog proves; Cursor runs on members' computers.
  const connection = (client_id: string, user_uuid: string, app?: string) => ({
    client_id,
    user_uuid,
    app_id: app ?? null,
    verified_app: Boolean(app),
    identity_verified: app === 'claude',
  });

  it('lists each connected app the stricter policy would refuse once, in list order', () => {
    const connections = [
      connection('claude', 'u1', 'claude'),
      connection('cursor-a', 'u1', 'cursor'),
      connection('cursor-b', 'u2', 'cursor'),
      connection('tool', 'u2'),
      connection('tool', 'u3'),
    ];

    // From any app to approved apps only: everything not approved, each recognized app once.
    expect(mcpClientsKeptApproved(connections, [{ client_id: 'claude' }], 'approved_only', 'any')).toEqual([
      connection('cursor-a', 'u1', 'cursor'),
      connection('tool', 'u2'),
    ]);
    // To verified and approved: proven web apps still connect, so Cursor and the tool are kept.
    expect(mcpClientsKeptApproved(connections, [], 'verified_and_approved', 'any')).toEqual([
      connection('cursor-a', 'u1', 'cursor'),
      connection('tool', 'u2'),
    ]);
    // From verified and approved: Cursor and the tool were already refused, so only Claude is kept.
    expect(mcpClientsKeptApproved(connections, [], 'approved_only', 'verified_and_approved')).toEqual([
      connection('claude', 'u1', 'claude'),
    ]);
    expect(mcpClientsKeptApproved(connections, [], 'any', 'approved_only')).toEqual([]);
  });

  it('is empty when every connected app is approved or nothing is known yet', () => {
    const cursor = connection('cursor-a', 'u1', 'cursor');

    expect(
      mcpClientsKeptApproved([cursor], [{ client_id: 'x', approval_key: 'app:cursor' }], 'approved_only', 'any')
    ).toEqual([]);
    expect(mcpClientsKeptApproved(undefined, [], 'approved_only', 'any')).toEqual([]);
  });
});

describe('connections', () => {
  const connection = (overrides: Record<string, unknown> = {}) => ({
    client_id: 'claude',
    user_uuid: 'u1',
    user_name: 'Ann',
    user_email: 'ann@example.com',
    client_kind: 'cimd' as const,
    redirect_hosts: [],
    loopback_only: false,
    scope: null,
    connected_at: 100,
    workspace_id: 'ws',
    ...overrides,
  });

  it('keys a connection by client and token family, or by member and time without one', () => {
    expect(mcpConnectionKey(connection({ family_id: 'f1' }))).toBe('claude#f1');
    expect(mcpConnectionKey(connection())).toBe('claude#u1@100');
    expect(mcpConnectionKey({ client_id: 'claude', connected_at: 5, family_id: ' ' })).toBe('claude#@5');
  });

  it('reads a device label only when the app sent one', () => {
    expect(mcpDeviceLabel({ device_label: ' Claude Code 2.1 · macOS ' })).toBe('Claude Code 2.1 · macOS');
    expect(mcpDeviceLabel({ device_label: '  ' })).toBeUndefined();
    expect(mcpDeviceLabel({})).toBeUndefined();
  });

  it('groups connections by member in the order members first appear', () => {
    const annClaude = connection({ family_id: 'f1' });
    const boCursor = connection({ client_id: 'cursor', user_uuid: 'u2', user_name: 'Bo', user_email: null });
    const annCursor = connection({ client_id: 'cursor', family_id: 'f2' });

    expect(groupMcpConnectionsByMember([annClaude, boCursor, annCursor])).toEqual([
      { userUuid: 'u1', member: { name: 'Ann', email: 'ann@example.com' }, connections: [annClaude, annCursor] },
      { userUuid: 'u2', member: { name: 'Bo' }, connections: [boCursor] },
    ]);
  });
});
