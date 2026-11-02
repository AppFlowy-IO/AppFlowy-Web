import en from '@/@types/translations/en.json';
import { MCP_ERROR_REASONS, McpApiError, type McpMemberStatus } from '@/application/services/domains/mcp';
import { Role, type Workspace } from '@/application/types';

import {
  CONSENT_ERROR_MESSAGE_REASONS,
  consentErrorMessageKey,
  consentHostToAcknowledge,
  consentPrimaryAction,
  consentStatusBlocker,
  initialConsentScopes,
  isAccountConsentReason,
  isCancellableConsentReason,
  isConsentFramed,
  isFatalConsentReason,
  isReadOnlyConsentRequest,
  isRetryableConsentReason,
  parseMcpConsentRequest,
  pickDefaultWorkspaceId,
  toConsentErrorReason,
  toggleConsentScope,
  type ConsentErrorReason,
} from '../consentModel';

const VALID = {
  client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  response_type: 'code',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
};

function parse(params: Record<string, string>, extra = '') {
  return parseMcpConsentRequest(new URLSearchParams(`${new URLSearchParams(params).toString()}${extra}`));
}

function workspace(id: string, role?: Role): Workspace {
  return { id, name: id, role, icon: '', memberCount: 1, databaseStorageId: '', createdAt: '' };
}

function status(overrides: Partial<McpMemberStatus> = {}): McpMemberStatus {
  return {
    workspace_id: 'ws',
    endpoint: 'https://mcp.example.com/mcp',
    role: 'member',
    eligible: true,
    ineligible_reason: null,
    requires_approval: true,
    client: {
      client_id: 'client',
      client_kind: 'dcr',
      redirect_hosts: [],
      loopback_only: false,
      known: true,
      blocked: false,
      approved: false,
      request_pending: false,
      connected: false,
    },
    ...overrides,
  };
}

describe('parseMcpConsentRequest', () => {
  it('reads a complete request', () => {
    expect(
      parse({
        ...VALID,
        state: '',
        scope: 'read write',
        resource: ' https://mcp.example.com/mcp ',
        workspace_id: '9F1B7C2E-1111-4111-8111-111111111111',
      })
    ).toEqual({
      clientId: VALID.client_id,
      redirectUri: VALID.redirect_uri,
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      state: '',
      scope: 'read write',
      resource: 'https://mcp.example.com/mcp',
      workspaceId: '9F1B7C2E-1111-4111-8111-111111111111',
    });
  });

  it('leaves optional parameters out and ignores a workspace_id that is not a UUID', () => {
    expect(parse({ ...VALID, workspace_id: 'nope', resource: ' ' })).toEqual({
      clientId: VALID.client_id,
      redirectUri: VALID.redirect_uri,
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      state: undefined,
      scope: undefined,
      resource: undefined,
      workspaceId: undefined,
    });
  });

  it('accepts private-use and loopback redirect URIs', () => {
    expect(parse({ ...VALID, redirect_uri: 'cursor://anysphere.cursor-mcp/oauth/callback' })).not.toBeNull();
    expect(parse({ ...VALID, redirect_uri: 'http://127.0.0.1:33418/' })).not.toBeNull();
  });

  it.each([
    ['client_id', ''],
    // Lookups would trim it while the code and deny requests send it as is.
    ['client_id', ` ${VALID.client_id}`],
    ['client_id', `${VALID.client_id}\n`],
    ['redirect_uri', ''],
    ['redirect_uri', 'data:text/html,hi'],
    ['redirect_uri', '/relative'],
    ['response_type', 'token'],
    ['code_challenge', '   '],
    ['code_challenge_method', 's256'],
  ])('rejects %s=%p', (name, value) => {
    expect(parse({ ...VALID, [name]: value })).toBeNull();
  });

  it.each(['client_id', 'redirect_uri', 'state', 'scope', 'resource'])('rejects a repeated %s', (name) => {
    expect(parse(VALID, `&${name}=a&${name}=b`)).toBeNull();
  });
});

describe('scopes', () => {
  it('always starts with read and keeps the supported requested scopes in order', () => {
    expect(initialConsentScopes(undefined)).toEqual(['read']);
    expect(initialConsentScopes('')).toEqual(['read']);
    expect(initialConsentScopes('admin openid write')).toEqual(['read', 'write', 'admin']);
  });

  it('toggles write and admin but never removes read', () => {
    expect(toggleConsentScope(['read', 'write'], 'admin', true)).toEqual(['read', 'write', 'admin']);
    expect(toggleConsentScope(['read', 'write', 'admin'], 'write', false)).toEqual(['read', 'admin']);
    expect(toggleConsentScope(['read'], 'read', false)).toEqual(['read']);
  });

  it('calls a request read-only when it asks for neither write nor admin', () => {
    expect(isReadOnlyConsentRequest(undefined)).toBe(true);
    expect(isReadOnlyConsentRequest('')).toBe(true);
    expect(isReadOnlyConsentRequest('read openid')).toBe(true);
    expect(isReadOnlyConsentRequest('read write')).toBe(false);
    expect(isReadOnlyConsentRequest('admin')).toBe(false);
  });
});

describe('consentHostToAcknowledge', () => {
  const dcr = { client_kind: 'dcr' as const, verified_app: false };

  it('asks about the https host of a self-registered app the catalog does not recognize', () => {
    expect(consentHostToAcknowledge(dcr, 'https://agents.example.com/oauth/callback')).toBe('agents.example.com');
    // Not loopback hosts for the server either, which shows them as remote in Settings.
    expect(consentHostToAcknowledge(dcr, 'https://dev.localhost/cb')).toBe('dev.localhost');
    expect(consentHostToAcknowledge(dcr, 'https://127.0.0.2/cb')).toBe('127.0.0.2');
    // Servers without the catalog send no verified_app.
    expect(consentHostToAcknowledge({ client_kind: 'dcr' }, 'https://agents.example.com/cb')).toBe('agents.example.com');
  });

  it.each([
    ['a recognized app', { client_kind: 'dcr' as const, verified_app: true }, 'https://www.cursor.com/cb'],
    ['a CIMD app (named by its own domain)', { client_kind: 'cimd' as const }, 'https://agents.example.com/cb'],
    ['a loopback redirect (warned about instead)', dcr, 'http://127.0.0.1:4567/callback'],
    ['an https localhost redirect', dcr, 'https://localhost:8443/callback'],
    ['a private-use scheme', dcr, 'cursor://anysphere.cursor-mcp/oauth/callback'],
    ['plain http', dcr, 'http://agents.example.com/cb'],
    ['a redirect that is not a URL', dcr, 'callback'],
  ])('does not ask for %s', (_case, client, redirectUri) => {
    expect(consentHostToAcknowledge(client, redirectUri)).toBeNull();
  });
});

describe('pickDefaultWorkspaceId', () => {
  const workspaces = [workspace('guest', Role.Guest), workspace('a', Role.Member), workspace('b', Role.Owner)];

  it('prefers the requested, then the current, then the first non-guest workspace', () => {
    expect(pickDefaultWorkspaceId(workspaces, { requested: 'B', current: 'a' })).toBe('b');
    expect(pickDefaultWorkspaceId(workspaces, { requested: 'guest', current: 'b' })).toBe('b');
    expect(pickDefaultWorkspaceId(workspaces, { requested: 'missing', current: 'guest' })).toBe('a');
    expect(pickDefaultWorkspaceId([workspace('legacy')], {})).toBe('legacy');
  });

  it('finds nothing when every workspace is a guest workspace', () => {
    expect(pickDefaultWorkspaceId([workspace('guest', Role.Guest)], { current: 'guest' })).toBeUndefined();
  });
});

describe('reasons', () => {
  it('has an English message for every reason it maps', () => {
    const messages = en.mcp.consent.errors as Record<string, string>;

    CONSENT_ERROR_MESSAGE_REASONS.forEach((reason) => {
      expect(typeof messages[reason]).toBe('string');
    });
    expect(consentErrorMessageKey('unknown_client')).toBe('mcp.consent.errors.unknown_client');
    expect(consentErrorMessageKey('already_approved')).toBe('mcp.consent.errors.generic');
  });

  it('has a message for every server reason the page can show', () => {
    // These two reload the member status and show the approval controls instead of text.
    const handledWithoutText = ['client_not_approved', 'already_approved'];

    MCP_ERROR_REASONS.filter((reason) => !handledWithoutText.includes(reason)).forEach((reason) => {
      expect(consentErrorMessageKey(reason)).toBe(`mcp.consent.errors.${reason}`);
    });
  });

  it('treats a reason this Web does not know, from an unchecked server field, like an unmapped one', () => {
    // The member status's ineligible_reason is not checked at runtime.
    (['workspace_suspended', 'constructor'] as unknown as ConsentErrorReason[]).forEach((reason) => {
      expect(consentErrorMessageKey(reason)).toBe('mcp.consent.errors.generic');
      expect(isRetryableConsentReason(reason)).toBe(false);
      expect(isFatalConsentReason(reason)).toBe(false);
      expect(isCancellableConsentReason(reason)).toBe(true);
      expect(isAccountConsentReason(reason)).toBe(false);
    });
  });

  it('derives a reason from failed requests', () => {
    expect(toConsentErrorReason(new McpApiError({ status: 403, reason: 'client_blocked' }))).toBe('client_blocked');
    expect(toConsentErrorReason(new McpApiError({ status: 0, error: 'network_error' }))).toBe('temporarily_unavailable');
    expect(toConsentErrorReason(new McpApiError({ status: 0, error: 'not_configured' }))).toBe('not_configured');
    expect(toConsentErrorReason(new McpApiError({ status: 401, error: 'unauthorized' }))).toBe('invalid_session');
    expect(toConsentErrorReason(new McpApiError({ status: 404 }))).toBe('generic');
    expect(toConsentErrorReason(new Error('boom'))).toBe('generic');
    expect(toConsentErrorReason(new McpApiError({ status: 503, error: 'mcp_disabled', reason: 'mcp_disabled' }))).toBe(
      'mcp_disabled'
    );
  });

  it('ends the flow for AI app connections turned off, with nothing to retry, cancel or switch', () => {
    expect(consentErrorMessageKey('mcp_disabled')).toBe('mcp.consent.errors.mcp_disabled');
    expect(en.mcp.consent.errors.mcp_disabled).toBe(
      'AI app connections are turned off on this AppFlowy server. Ask your administrator.'
    );
    expect(isFatalConsentReason('mcp_disabled')).toBe(true);
    expect(isRetryableConsentReason('mcp_disabled')).toBe(false);
    // The server refuses the deny too while connections are off.
    expect(isCancellableConsentReason('mcp_disabled')).toBe(false);
    expect(isAccountConsentReason('mcp_disabled')).toBe(false);
  });

  it('blocks consent while AI app connections are turned off, before anything else', () => {
    expect(consentStatusBlocker(status({ enabled: false }))).toBe('mcp_disabled');
    expect(
      consentStatusBlocker(status({ enabled: false, eligible: false, ineligible_reason: 'email_not_allowed' }))
    ).toBe('mcp_disabled');
    expect(consentStatusBlocker(status({ enabled: true }))).toBeNull();
  });

  it('blocks consent for ineligible members, blocked and unknown clients', () => {
    expect(consentStatusBlocker(status())).toBeNull();
    expect(consentStatusBlocker(status({ eligible: false, ineligible_reason: 'email_not_allowed' }))).toBe(
      'email_not_allowed'
    );
    expect(consentStatusBlocker(status({ client: { ...status().client!, blocked: true } }))).toBe('client_blocked');
    expect(consentStatusBlocker(status({ client: { ...status().client!, known: false } }))).toBe('unknown_client');
  });

  it('picks the primary action from the approval state and role', () => {
    const approved = { ...status().client!, approved: true };

    expect(consentPrimaryAction(status())).toBe('request-approval');
    expect(consentPrimaryAction(status({ role: 'owner' }))).toBe('approve-and-allow');
    expect(consentPrimaryAction(status({ requires_approval: false, client: approved }))).toBe('allow');
    expect(consentPrimaryAction(status({ client: approved }))).toBe('allow');
    expect(consentPrimaryAction(status({ client: null }))).toBe('allow');
  });

  it('never offers Allow for a client the server still reports as not approved', () => {
    // Right after an owner lifts the approval requirement, `requires_approval`
    // can be false while authorization still refuses the client.
    expect(consentPrimaryAction(status({ requires_approval: false }))).toBe('request-approval');
    expect(consentPrimaryAction(status({ requires_approval: false, role: 'owner' }))).toBe('approve-and-allow');
  });
});

describe('isConsentFramed', () => {
  it('is false for a top-level page', () => {
    expect(isConsentFramed()).toBe(false);
  });
});

describe('isCancellableConsentReason', () => {
  it('offers Cancel wherever the server can still validate the deny', () => {
    (
      [
        'email_not_allowed',
        'guest_not_allowed',
        'not_workspace_member',
        'no_workspace',
        'client_blocked',
        'invalid_scope',
        'invalid_target',
        'invalid_session',
        'temporarily_unavailable',
      ] as const
    ).forEach((reason) => expect(isCancellableConsentReason(reason)).toBe(true));
  });

  it('never for a client or redirect the deny refuses, while connections are off, or without an MCP service', () => {
    (['unknown_client', 'invalid_redirect_uri', 'mcp_disabled', 'not_configured'] as const).forEach((reason) =>
      expect(isCancellableConsentReason(reason)).toBe(false)
    );
  });
});
