import translations from '@/@types/translations/en.json';
import {
  MCP_ERROR_REASONS,
  McpApiError,
  type McpApprovalMode,
  mcpApprovalKey,
  type McpWorkspaceConnection,
} from '@/application/services/domains/mcp';
import { mcpTestT } from '@/components/mcp/__tests__/mcpTestI18n';
import { consentErrorMessageKey, toConsentErrorReason } from '@/components/mcp/consent/consentModel';

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
  mcpDisconnectRemoves,
  mcpErrorText,
  mcpFamilyId,
  mcpIsApproved,
  mcpMemberLabel,
  mcpModeAdmitsWithoutApproval,
  mcpOthersKeepWorking,
  mcpRemainingAppApproval,
  mcpRequestedBy,
} from '../format';

const t = mcpTestT;

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
    // For example a typed client ID longer than the server accepts.
    expect(mcpErrorText(new McpApiError({ status: 400, reason: 'invalid_request' }), t)).toBe(
      translations.settings.mcp.invalidRequest
    );
  });

  // Settings and the consent page read an error's reason the same way, reason or not.
  it.each([
    ['an unreachable service', new McpApiError({ status: 0, error: 'network_error' })],
    ['a timeout', new McpApiError({ status: 0, error: 'timeout' })],
    ['an unknown MCP service URL', new McpApiError({ status: 0, error: 'not_configured' })],
    [
      'a failed session refresh',
      new McpApiError({ status: 0, error: 'session_refresh_failed', reason: 'temporarily_unavailable' }),
    ],
    ['a 401 without a reason', new McpApiError({ status: 401 })],
    ['a 404 without a reason', new McpApiError({ status: 404 })],
    ['an unreadable answer', new McpApiError({ status: 200, error: 'invalid_response', reason: 'server_error' })],
    ['a throttle', new McpApiError({ status: 429, reason: 'rate_limited' })],
    ['AI apps turned off', new McpApiError({ status: 503, error: 'mcp_disabled', reason: 'mcp_disabled' })],
  ])('says what the consent page says for %s', (_case, error) => {
    expect(mcpErrorText(error, t)).toBe(t(consentErrorMessageKey(toConsentErrorReason(error))));
  });

  // A consent text edit must not leak "Start again from your AI app" into Settings toasts.
  it.each(MCP_ERROR_REASONS)('never sends a Settings user back to the AI app for %s', (reason) => {
    expect(mcpErrorText(new McpApiError({ status: 400, reason }), t)).not.toMatch(/your AI app|start again/i);
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
  // An app the catalog does not recognize, as the server lists it.
  const unrecognized = (client_name: string | null, client_host: string | null = null) => ({
    client_name,
    client_host,
    app_name: null,
    verified_app: false,
  });

  it('names an app by name, host, or "Unknown app"', () => {
    expect(mcpClientName(unrecognized('Claude', 'claude.ai'), t)).toBe('Claude');
    expect(mcpClientName(unrecognized(null, 'claude.ai'), t)).toBe('claude.ai');
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
    expect(mcpClientNames([unrecognized('Cursor'), unrecognized(null, 'claude.ai'), unrecognized(null)], t)).toBe(
      'Cursor, claude.ai, Unknown app'
    );
  });
});

describe('approvals', () => {
  // Cursor runs on members' computers: recognized, but its identity is not proven.
  const cursorA = { client_id: 'dcr-cursor-a', app_id: 'cursor', verified_app: true, identity_verified: false };
  const cursorB = { client_id: 'dcr-cursor-b', app_id: 'cursor', verified_app: true, identity_verified: false };
  const claude = { client_id: 'dcr-claude', app_id: 'claude', verified_app: true, identity_verified: true };
  const tool = { client_id: 'dcr-tool', app_id: null, verified_app: false, identity_verified: false };

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
    expect(mcpApprovalCovers({ client_id: 'dcr-tool', approval_key: 'dcr-tool' }, tool)).toBe(true);
    expect(mcpIsApproved([clientApproval, { client_id: 'dcr-tool', approval_key: 'dcr-tool' }], cursorB)).toBe(false);
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
    expect(
      mcpClientsKeptApproved(connections, [{ client_id: 'claude', approval_key: 'claude' }], 'approved_only', 'any')
    ).toEqual([connection('cursor-a', 'u1', 'cursor'), connection('tool', 'u2')]);
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

  // The server's tightening_keeps_what_the_previous_policy_admitted (AppFlowy Cloud,
  // libs/appflowy-mcp-core/src/governance.rs) with the same clients, approvals and keys, so the two
  // can be diffed. The server returns keys sorted; the Web returns connections in list order.
  it('keeps the approval keys the server keeps (keys_to_keep_approved)', () => {
    const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
    // Claude is the catalog's web app; Cursor and Claude Code run on members' computers.
    const client = (client_id: string, app?: string) => ({
      client_id,
      app_id: app ?? null,
      verified_app: Boolean(app),
      identity_verified: app === 'claude',
    });
    const connected = [
      client('dcr-cursor-1', 'cursor'),
      client('dcr-cursor-2', 'cursor'),
      client(CLAUDE_CODE, 'claude-code'),
      client('dcr-claude', 'claude'),
      client('dcr-local'),
      client('dcr-approved'),
      client('dcr-legacy-cursor', 'cursor'),
      client('dcr-local'),
    ];
    // An app-level approval and two per-client rows, one of them a recognized app's.
    const approved = ['app:claude-code', 'dcr-approved', 'dcr-legacy-cursor'].map((key) => ({
      client_id: key,
      approval_key: key,
    }));
    const keysToKeep = (previous: McpApprovalMode, next: McpApprovalMode) =>
      mcpClientsKeptApproved(connected, approved, next, previous).map(mcpApprovalKey).sort();

    expect(keysToKeep('any', 'verified_and_approved')).toEqual(['app:cursor', 'dcr-local']);
    expect(keysToKeep('verified_and_approved', 'approved_only')).toEqual(['app:claude']);
    expect(keysToKeep('any', 'approved_only')).toEqual(['app:claude', 'app:cursor', 'dcr-local']);
    // Loosening, or staying, never approves anything.
    const loosening: [McpApprovalMode, McpApprovalMode][] = [
      ['approved_only', 'verified_and_approved'],
      ['approved_only', 'any'],
      ['verified_and_approved', 'any'],
      ['verified_and_approved', 'verified_and_approved'],
      ['approved_only', 'approved_only'],
    ];

    loosening.forEach(([previous, next]) => expect(keysToKeep(previous, next)).toEqual([]));
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
  const connection = (overrides: Partial<McpWorkspaceConnection> = {}): McpWorkspaceConnection => ({
    client_id: 'claude',
    user_uuid: 'u1',
    user_name: 'Ann',
    user_email: 'ann@example.com',
    client_kind: 'cimd',
    redirect_hosts: [],
    loopback_only: false,
    app_id: null,
    app_name: null,
    verified_app: false,
    identity_verified: false,
    scope: null,
    connected_at: 100,
    family_id: null,
    last_used_at: null,
    workspace_id: 'ws',
    ...overrides,
  });

  it('keys a connection by client and token family, or by member and time without one', () => {
    expect(mcpConnectionKey(connection({ family_id: 'f1' }))).toBe('claude#f1');
    expect(mcpConnectionKey(connection())).toBe('claude#u1@100');
    expect(mcpConnectionKey({ client_id: 'claude', connected_at: 5, family_id: ' ' })).toBe('claude#@5');
  });

  it('reads a token family only when it is not blank', () => {
    expect(mcpFamilyId({ family_id: ' f1 ' })).toBe('f1');
    expect(mcpFamilyId({ family_id: ' ' })).toBeUndefined();
    expect(mcpFamilyId({ family_id: null })).toBeUndefined();
  });

  describe('what a disconnect removes, like the server', () => {
    const laptop = { client_id: 'claude', family_id: 'laptop', connected_at: 1 };
    const desktop = { client_id: 'claude', family_id: 'desktop', connected_at: 2 };
    const cursor = { client_id: 'cursor', family_id: 'cursor-1', connected_at: 3 };
    const legacy = { client_id: 'claude', family_id: null, connected_at: 4 };

    it('ends one device with a family, and the others keep working', () => {
      expect([laptop, desktop, cursor, legacy].map((other) => mcpDisconnectRemoves(laptop, other))).toEqual([
        true,
        false,
        false,
        false,
      ]);
      expect(mcpOthersKeepWorking(laptop, [laptop, desktop, cursor])).toBe(true);
      expect(mcpOthersKeepWorking(laptop, [laptop, cursor])).toBe(false);
    });

    it('ends every connection with the client without one, a blank family included', () => {
      for (const target of [legacy, { ...laptop, family_id: '  ' }]) {
        expect([laptop, desktop, cursor, legacy].map((other) => mcpDisconnectRemoves(target, other))).toEqual([
          true,
          true,
          false,
          true,
        ]);
        expect(mcpOthersKeepWorking(target, [laptop, desktop, cursor, legacy])).toBe(false);
      }
    });

    it('stays within the member for an owner’s disconnect', () => {
      const annLaptop = { ...laptop, user_uuid: 'ann' };
      const annDesktop = { ...desktop, user_uuid: 'ann' };
      const boLaptop = { ...laptop, user_uuid: 'bo' };
      const annLegacy = { ...legacy, user_uuid: 'ann' };

      expect(mcpDisconnectRemoves(annLaptop, boLaptop)).toBe(false);
      expect(mcpDisconnectRemoves(annLegacy, boLaptop)).toBe(false);
      expect(mcpDisconnectRemoves(annLegacy, annDesktop)).toBe(true);
      // Bo's connection with the same app is not Ann's to keep.
      expect(mcpOthersKeepWorking(annLaptop, [annLaptop, boLaptop])).toBe(false);
      expect(mcpOthersKeepWorking(annLaptop, [annLaptop, annDesktop, boLaptop])).toBe(true);
    });
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
