import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import translations from '@/@types/translations/en.json';
import * as McpService from '@/application/services/domains/mcp';
import type {
  McpAccessRequest,
  McpApprovalMode,
  McpApprovedClient,
  McpClientSummary,
  McpMemberStatus,
  McpMyConnection,
  McpWorkspaceConnection,
  McpWorkspaceSettings,
} from '@/application/services/domains/mcp';
import { notify } from '@/components/_shared/notify';

import McpPanel from '../McpPanel';
import { resetMcpPendingRequestCountsForTests, useMcpPendingRequestCount } from '../pendingRequestCount';

// Real i18next over en.json, so a name that loses RAW_INTERPOLATION shows escaped here as in the app.
jest.mock('react-i18next', () => {
  const { mcpTestT } = jest.requireActual('@/components/mcp/__tests__/mcpTestI18n');

  return { useTranslation: () => ({ t: mcpTestT }) };
});
jest.mock('@/components/_shared/notify', () => ({ notify: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/copy', () => ({ copyTextToClipboard: jest.fn() }));
jest.mock('@/application/services/domains/mcp', () => ({
  ...jest.requireActual('@/application/services/domains/mcp'),
  getMcpMemberStatus: jest.fn(),
  listMyMcpConnections: jest.fn(),
  listMyMcpConnectionsAcrossWorkspaces: jest.fn(),
  disconnectMyMcpConnection: jest.fn(),
  getMcpWorkspaceSettings: jest.fn(),
  updateMcpWorkspaceSettings: jest.fn(),
  approveMcpClient: jest.fn(),
  revokeMcpClientApproval: jest.fn(),
  listMcpWorkspaceConnections: jest.fn(),
  disconnectMcpWorkspaceConnections: jest.fn(),
  disconnectAllMcpWorkspaceConnections: jest.fn(),
  listMcpAccessRequests: jest.fn(),
  dismissMcpAccessRequest: jest.fn(),
}));

const api = jest.mocked(McpService);
const { McpApiError } = McpService;

const WS = 'workspace-1';
const ENDPOINT = 'https://mcp.example.com/mcp';
// The panel's clock: `Date.now` returns this in every test, so relative times never drift with the run.
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const secondsAgo = (seconds: number) => Math.floor(NOW / 1000) - seconds;
const signal = { signal: expect.any(AbortSignal) };

const claude: McpClientSummary = {
  client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
  client_name: 'Claude',
  client_uri: 'https://claude.ai',
  logo_uri: null,
  client_kind: 'cimd',
  client_host: 'claude.ai',
  redirect_hosts: ['claude.ai'],
  loopback_only: false,
  app_id: 'claude',
  app_name: 'Claude',
  verified_app: true,
  // A web app: the catalog proves who it is.
  identity_verified: true,
};
// Self-registered tools on this computer: never recognized by the catalog.
const cursor: McpClientSummary = {
  client_id: 'dcr-cursor',
  client_name: 'Cursor',
  client_kind: 'dcr',
  client_host: 'localhost',
  redirect_hosts: ['localhost'],
  loopback_only: true,
  app_id: null,
  app_name: null,
  verified_app: false,
  identity_verified: false,
};
const vscode: McpClientSummary = { ...cursor, client_id: 'dcr-vscode', client_name: 'Visual Studio Code' };
// Two registrations the catalog recognizes as the same app (Cursor's own https redirect). Cursor
// runs on members' computers, so recognizing it proves nothing: it still needs an approval.
const cursorAppA: McpClientSummary = {
  client_id: 'dcr-cursor-a',
  client_name: 'cursor-mcp',
  client_kind: 'dcr',
  client_host: 'www.cursor.com',
  redirect_hosts: ['www.cursor.com'],
  loopback_only: false,
  app_id: 'cursor',
  app_name: 'Cursor',
  verified_app: true,
  identity_verified: false,
};
const cursorAppB: McpClientSummary = { ...cursorAppA, client_id: 'dcr-cursor-b' };

const myClaude: McpMyConnection = {
  ...claude,
  scope: 'read write',
  connected_at: secondsAgo(2 * 3600 + 900),
  family_id: 'family-laptop',
  device_label: 'Claude Code 2.1 · macOS',
  last_used_at: secondsAgo(5 * 60 + 30),
};
const myClaudeDesktop: McpMyConnection = {
  ...myClaude,
  connected_at: secondsAgo(3 * 86400 + 3600),
  family_id: 'family-desktop',
  device_label: 'Claude Code 2.1 · Windows',
  last_used_at: null,
};

function approval(client: McpClientSummary, approvalKey = client.client_id): McpApprovedClient {
  return {
    ...client,
    approval_key: approvalKey,
    approved_by: 'owner-uuid',
    approved_by_name: 'Olivia Owner',
    approved_by_email: 'olivia@example.com',
    approved_at: '2026-10-01T10:00:00Z',
  };
}

const settings: McpWorkspaceSettings = {
  workspace_id: WS,
  approval_mode: 'verified_and_approved',
  approved_clients: [approval(claude)],
};

function settingsWith(mode: McpApprovalMode, approved = settings.approved_clients): McpWorkspaceSettings {
  return { ...settings, approval_mode: mode, approved_clients: approved };
}

const cursorRequest: McpAccessRequest = {
  ...cursor,
  approval_key: cursor.client_id,
  requesters: [
    { user_uuid: 'u1', name: 'Ann', email: 'ann@example.com', requested_at: secondsAgo(5 * 60 + 30) },
    { user_uuid: 'u2', name: null, email: 'bo@example.com', requested_at: secondsAgo(3600) },
    { user_uuid: 'u3', name: 'Cy', requested_at: secondsAgo(7200) },
    { user_uuid: 'u4', name: 'Di', requested_at: secondsAgo(86400) },
  ],
  first_requested_at: secondsAgo(86400),
  last_requested_at: secondsAgo(5 * 60 + 30),
};
const vscodeRequest: McpAccessRequest = {
  ...vscode,
  approval_key: vscode.client_id,
  requesters: [{ user_uuid: 'u1', name: 'Ann', requested_at: secondsAgo(600) }],
  first_requested_at: secondsAgo(600),
  last_requested_at: secondsAgo(600),
};
const annOnClaude: McpWorkspaceConnection = {
  ...claude,
  user_uuid: 'u1',
  user_name: 'Ann',
  user_email: 'ann@example.com',
  scope: 'read',
  connected_at: secondsAgo(3 * 86400 + 3600),
  family_id: 'ann-claude',
  device_label: 'Claude · Chrome',
  last_used_at: secondsAgo(3600 + 300),
  workspace_id: WS,
};
const eveOnClaude: McpWorkspaceConnection = {
  ...annOnClaude,
  user_uuid: 'u5',
  user_name: null,
  user_email: 'eve@example.com',
  scope: 'read write admin',
  connected_at: secondsAgo(30),
  family_id: 'eve-claude',
  device_label: null,
  last_used_at: null,
};
// Connected while the workspace allowed any app; neither is approved.
const annOnCursor: McpWorkspaceConnection = { ...annOnClaude, ...cursor, scope: 'read', family_id: 'ann-cursor' };
const boOnCursor: McpWorkspaceConnection = {
  ...annOnCursor,
  user_uuid: 'u2',
  user_name: 'Bo',
  user_email: null,
  family_id: 'bo-cursor',
};
const boOnVscode: McpWorkspaceConnection = { ...boOnCursor, ...vscode, family_id: 'bo-vscode' };

function memberStatus(overrides: Partial<McpMemberStatus> = {}): McpMemberStatus {
  const requiresApproval = overrides.requires_approval ?? false;

  return {
    workspace_id: WS,
    enabled: true,
    endpoint: ENDPOINT,
    role: 'member',
    eligible: true,
    ineligible_reason: null,
    // As the server derives it: every policy but `any` requires approval for some apps.
    requires_approval: requiresApproval,
    approval_mode: requiresApproval ? 'approved_only' : 'any',
    client: null,
    approved_apps: [],
    ...overrides,
  };
}

const ownerStatus = () => memberStatus({ role: 'owner', requires_approval: true });

function rows(testId: string) {
  return screen.queryAllByTestId(testId);
}

function text(testId: string) {
  return screen.getByTestId(testId).textContent;
}

function modeRadio(mode: McpApprovalMode) {
  return screen.getByTestId<HTMLInputElement>(`mcp-approval-mode-${mode}`);
}

async function renderOwnerPanel() {
  api.getMcpMemberStatus.mockResolvedValue(ownerStatus());
  render(<McpPanel workspaceId={WS} />);
  await screen.findByTestId('mcp-approval-mode');
  await screen.findAllByTestId('mcp-access-request-row');
  await screen.findAllByTestId('mcp-member-connection-row');
}

describe('McpPanel', () => {
  let clock: jest.SpyInstance<number, []>;

  beforeEach(() => {
    // Not clearAllMocks: a test that fails early must not leave its queued answers (…Once) to the next.
    jest.resetAllMocks();
    clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    resetMcpPendingRequestCountsForTests();
    api.getMcpMemberStatus.mockResolvedValue(memberStatus());
    api.listMyMcpConnections.mockResolvedValue([myClaude]);
    api.listMyMcpConnectionsAcrossWorkspaces.mockResolvedValue({
      connections: [
        { ...myClaude, workspace_id: WS },
        { ...myClaude, family_id: 'family-other', workspace_id: 'workspace-2' },
        {
          ...cursorAppA,
          scope: null,
          connected_at: secondsAgo(60),
          family_id: 'family-cursor',
          last_used_at: null,
          workspace_id: 'workspace-2',
        },
      ],
      workspace_count: 2,
      connection_count: 3,
    });
    api.disconnectMyMcpConnection.mockResolvedValue({ disconnected: 1 });
    api.getMcpWorkspaceSettings.mockResolvedValue(settings);
    api.listMcpAccessRequests.mockResolvedValue([cursorRequest]);
    api.listMcpWorkspaceConnections.mockResolvedValue([annOnClaude, eveOnClaude]);
    api.updateMcpWorkspaceSettings.mockImplementation(async (_workspaceId, mode) => ({
      ...settingsWith(mode),
      auto_approved_clients: [],
    }));
    api.approveMcpClient.mockResolvedValue({ approved: true });
    api.dismissMcpAccessRequest.mockResolvedValue({ dismissed: true });
    api.revokeMcpClientApproval.mockResolvedValue({ disconnected: 2 });
    api.disconnectMcpWorkspaceConnections.mockResolvedValue({ disconnected: 1 });
    api.disconnectAllMcpWorkspaceConnections.mockResolvedValue({ disconnected: 3 });
  });

  afterEach(() => {
    clock.mockRestore();
  });

  describe('members', () => {
    it('shows a spinner, then the setup guide and the member’s own devices without owner controls', async () => {
      render(<McpPanel workspaceId={WS} />);

      expect(screen.getByTestId('mcp-panel-loading')).toBeTruthy();
      const row = await screen.findByTestId('mcp-my-connection-row');

      expect(api.getMcpMemberStatus).toHaveBeenCalledWith(WS, undefined, signal);
      expect(api.listMyMcpConnections).toHaveBeenCalledWith(WS, signal);
      expect(screen.getByTestId<HTMLInputElement>('mcp-endpoint-value').value).toBe(ENDPOINT);
      expect(screen.queryByTestId('mcp-approval-notice')).toBeNull();
      expect(row.getAttribute('data-family-id')).toBe('family-laptop');
      expect(within(row).getByTestId('mcp-client-identity-name').textContent).toBe('Claude');
      expect(within(row).getByTestId('mcp-client-verified-app-badge')).toBeTruthy();
      expect(within(row).getByTestId('mcp-scope-badge').getAttribute('data-level')).toBe('write');
      // The scope badge is focusable for its "reconnect to change access" tooltip.
      expect(within(row).getByTestId('mcp-scope').getAttribute('tabindex')).toBe('0');
      expect(within(row).getByTestId('mcp-my-connection-device').textContent).toBe('Claude Code 2.1 · macOS');

      const time = within(row).getByTestId('mcp-my-connection-time');

      expect(time.textContent).toBe('Connected 2 hours ago');
      expect(time.getAttribute('dateTime')).toBe(new Date(myClaude.connected_at * 1000).toISOString());
      expect(within(row).getByTestId('mcp-my-connection-last-used').textContent).toBe('Last used 5 minutes ago');

      expect(screen.queryByTestId('mcp-workspace-access')).toBeNull();
      expect(api.getMcpWorkspaceSettings).not.toHaveBeenCalled();
      expect(api.listMcpAccessRequests).not.toHaveBeenCalled();
      expect(api.listMcpWorkspaceConnections).not.toHaveBeenCalled();
    });

    it('loads the member’s own connections alongside the member status, not a round trip after it', async () => {
      let resolveStatus!: (status: McpMemberStatus) => void;

      api.getMcpMemberStatus.mockReturnValue(
        new Promise((resolve) => {
          resolveStatus = resolve;
        })
      );
      render(<McpPanel workspaceId={WS} />);

      expect(screen.getByTestId('mcp-panel-loading')).toBeTruthy();
      expect(api.listMyMcpConnections).toHaveBeenCalledWith(WS, signal);
      expect(api.listMyMcpConnectionsAcrossWorkspaces).toHaveBeenCalledWith(signal);

      await act(async () => {
        resolveStatus(memberStatus());
      });

      // Everything arrives with the status: no second spinner, and nothing pops in above the gallery later.
      expect(screen.getByTestId('mcp-my-connection-row')).toBeTruthy();
      expect(screen.getByTestId('mcp-all-connections-summary')).toBeTruthy();
      expect(screen.getByTestId('mcp-setup-connected-apps')).toBeTruthy();
      expect(api.listMyMcpConnections).toHaveBeenCalledTimes(1);
    });

    it('sums up the user’s apps across workspaces and feeds the setup guide its connections', async () => {
      render(<McpPanel workspaceId={WS} />);

      // Claude twice (two devices) and Cursor: two apps in two workspaces.
      expect((await screen.findByTestId('mcp-all-connections-summary')).textContent).toBe(
        'You have 2 apps connected across 2 workspaces.'
      );
      expect(api.listMyMcpConnectionsAcrossWorkspaces).toHaveBeenCalledWith(signal);

      // The guide gets this workspace's connections only: Claude, matched to its card by the verified catalog id.
      const connectedApps = await screen.findByTestId('mcp-setup-connected-apps');

      expect(within(connectedApps).getByTestId('mcp-setup-connected-apps-label').textContent).toBe('Connected apps (1)');
      expect(screen.getByTestId('mcp-setup-app-card-claude').getAttribute('data-connected')).toBe('true');
      expect(screen.getByTestId('mcp-setup-app-connected-claude')).toBeTruthy();
      expect(screen.queryByTestId('mcp-setup-app-connected-cursor')).toBeNull();
    });

    it('leaves the summary out when the service cannot list connections across workspaces', async () => {
      api.listMyMcpConnectionsAcrossWorkspaces.mockRejectedValue(new McpApiError({ status: 404 }));
      render(<McpPanel workspaceId={WS} />);

      await screen.findByTestId('mcp-my-connection-row');
      await waitFor(() => expect(api.listMyMcpConnectionsAcrossWorkspaces).toHaveBeenCalled());
      expect(screen.queryByTestId('mcp-all-connections-summary')).toBeNull();
      expect(screen.queryByTestId('mcp-my-connections-error')).toBeNull();
    });

    it('counts an app connected from two computers once, in the guide and in the summary alike', async () => {
      // Gemini CLI registers itself on each computer: two unrecognized clients, one app.
      const gemini = (client_id: string, family_id: string): McpMyConnection => ({
        client_id,
        client_name: 'Gemini CLI',
        client_kind: 'dcr',
        client_host: 'localhost',
        redirect_hosts: ['localhost'],
        loopback_only: true,
        app_id: null,
        app_name: null,
        verified_app: false,
        identity_verified: false,
        scope: 'read',
        connected_at: secondsAgo(3600 + 900),
        family_id,
        last_used_at: null,
      });
      const laptop = gemini('dcr-gemini-laptop', 'family-gemini-laptop');
      const desktop = gemini('dcr-gemini-desktop', 'family-gemini-desktop');

      api.listMyMcpConnections.mockResolvedValue([laptop, desktop]);
      api.listMyMcpConnectionsAcrossWorkspaces.mockResolvedValue({
        connections: [
          { ...laptop, workspace_id: WS },
          { ...desktop, workspace_id: WS },
        ],
        workspace_count: 1,
        connection_count: 2,
      });
      render(<McpPanel workspaceId={WS} />);

      expect((await screen.findByTestId('mcp-all-connections-summary')).textContent).toBe(
        'You have 1 app connected across 1 workspace.'
      );
      const connectedApps = await screen.findByTestId('mcp-setup-connected-apps');

      expect(within(connectedApps).getByTestId('mcp-setup-connected-apps-label').textContent).toBe('Connected apps (1)');
    });

    it('tells members that some apps need an owner’s approval and lists the approved ones', async () => {
      api.getMcpMemberStatus.mockResolvedValue(
        memberStatus({
          requires_approval: true,
          approved_apps: [
            { ...cursorAppA, approval_key: 'app:cursor' },
            { ...vscode, approval_key: vscode.client_id },
          ],
        })
      );
      api.listMyMcpConnections.mockResolvedValue([]);
      render(<McpPanel workspaceId={WS} />);

      expect((await screen.findByTestId('mcp-approval-notice')).textContent).toBe(
        translations.settings.mcp.approvalNotice
      );
      expect(await screen.findByTestId('mcp-my-connections-empty')).toBeTruthy();

      const [app, client] = rows('mcp-approved-app-row');

      expect(
        within(screen.getByTestId('mcp-approved-for-workspace')).getByText('Approved for this workspace')
      ).toBeTruthy();
      expect(within(app).getByTestId('mcp-client-identity-name').textContent).toBe('Cursor');
      expect(within(app).getByTestId('mcp-approved-app-scope').textContent).toBe('All Cursor installs');
      expect(within(client).getByTestId('mcp-client-identity-name').textContent).toBe('Visual Studio Code');
      expect(within(client).queryByTestId('mcp-approved-app-scope')).toBeNull();
      // Members see names only, never who approved.
      expect(screen.queryByText(/Approved by/)).toBeNull();
      expect(screen.queryByTestId('mcp-revoke-client-0')).toBeNull();
    });

    it('says when no app is approved, and hides the list where approval does not apply', async () => {
      api.getMcpMemberStatus.mockResolvedValue(memberStatus({ requires_approval: true, approved_apps: [] }));
      const { unmount } = render(<McpPanel workspaceId={WS} />);

      expect(await screen.findByTestId('mcp-approved-for-workspace-empty')).toBeTruthy();
      unmount();

      api.getMcpMemberStatus.mockResolvedValue(memberStatus({ requires_approval: false, approved_apps: [] }));
      const second = render(<McpPanel workspaceId={WS} />);

      await screen.findByTestId('mcp-my-connection-row');
      expect(screen.queryByTestId('mcp-approved-for-workspace')).toBeNull();
      second.unmount();
    });

    it('tells members which apps connect without approval under the verified policy', async () => {
      api.getMcpMemberStatus.mockResolvedValue(
        memberStatus({ requires_approval: true, approval_mode: 'verified_and_approved', approved_apps: [] })
      );
      const { unmount } = render(<McpPanel workspaceId={WS} />);

      // Verified web apps need no request, so an empty list must not suggest every app does.
      expect((await screen.findByTestId('mcp-approval-notice')).textContent).toBe(
        translations.settings.mcp.approvalNoticeVerified
      );
      expect(text('mcp-approved-for-workspace-empty')).toBe(translations.settings.mcp.approvedForWorkspaceEmptyVerified);
      unmount();

      // When only approved apps may connect, every app needs a request.
      api.getMcpMemberStatus.mockResolvedValue(
        memberStatus({ requires_approval: true, approval_mode: 'approved_only', approved_apps: [] })
      );
      render(<McpPanel workspaceId={WS} />);
      expect((await screen.findByTestId('mcp-approval-notice')).textContent).toBe(
        translations.settings.mcp.approvalNotice
      );
      expect(text('mcp-approved-for-workspace-empty')).toBe(translations.settings.mcp.approvedForWorkspaceEmpty);
    });

    it.each([
      ['an unreachable service', new McpApiError({ status: 0, error: 'network_error' })],
      ['a server without the endpoint', new McpApiError({ status: 404 })],
      ['a failing service', new McpApiError({ status: 503, reason: 'temporarily_unavailable' })],
    ])('shows the unavailable state with Retry for %s', async (_case, error) => {
      api.getMcpMemberStatus.mockRejectedValueOnce(error);
      render(<McpPanel workspaceId={WS} />);

      const unavailable = await screen.findByTestId('mcp-panel-unavailable');

      expect(unavailable.textContent).toContain(translations.settings.mcp.unavailableTitle);
      expect(screen.queryByTestId('mcp-setup-guide')).toBeNull();
      expect(screen.queryByTestId('mcp-my-connections')).toBeNull();
      // Asked for alongside the status; its failure pauses the list.
      expect(api.listMyMcpConnections).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('mcp-panel-retry'));
      expect(await screen.findByTestId('mcp-setup-guide')).toBeTruthy();
      expect(screen.queryByTestId('mcp-panel-unavailable')).toBeNull();
      expect(api.getMcpMemberStatus).toHaveBeenCalledTimes(2);
      // Retry asks for the list again with the status.
      expect(api.listMyMcpConnections).toHaveBeenCalledTimes(2);
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
    });

    it('shows other status failures with their reason and Retry', async () => {
      api.getMcpMemberStatus.mockRejectedValueOnce(
        new McpApiError({ status: 403, error: 'forbidden', reason: 'not_workspace_member' })
      );
      render(<McpPanel workspaceId={WS} />);

      const failure = await screen.findByTestId('mcp-panel-error');

      expect(failure.textContent).toContain(translations.mcp.consent.errors.not_workspace_member);
      expect(screen.queryByTestId('mcp-panel-unavailable')).toBeNull();
      fireEvent.click(screen.getByTestId('mcp-panel-retry'));
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
    });

    it('explains why an account is not eligible and still lets it revoke its connections', async () => {
      api.getMcpMemberStatus.mockResolvedValue(
        memberStatus({ eligible: false, ineligible_reason: 'email_not_allowed', requires_approval: true })
      );
      render(<McpPanel workspaceId={WS} />);

      const notice = await screen.findByTestId('mcp-panel-ineligible');

      expect(notice.getAttribute('data-reason')).toBe('email_not_allowed');
      expect(notice.textContent).toContain(translations.settings.mcp.ineligible_email_not_allowed);
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
      expect(screen.queryByTestId('mcp-setup-guide')).toBeNull();
      expect(screen.queryByTestId('mcp-approval-notice')).toBeNull();
      // The cross-workspace summary is for accounts that may connect apps.
      expect(screen.queryByTestId('mcp-all-connections-summary')).toBeNull();

      fireEvent.click(screen.getByTestId('mcp-my-disconnect-0'));
      fireEvent.click(await screen.findByTestId('mcp-confirm-disconnect'));
      await waitFor(() =>
        expect(api.disconnectMyMcpConnection).toHaveBeenCalledWith(WS, claude.client_id, {
          familyId: 'family-laptop',
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('hides the connection list from ineligible guests without connections', async () => {
      api.getMcpMemberStatus.mockResolvedValue(
        memberStatus({ role: 'guest', eligible: false, ineligible_reason: 'guest_not_allowed' })
      );
      api.listMyMcpConnections.mockResolvedValue([]);
      render(<McpPanel workspaceId={WS} />);

      expect((await screen.findByTestId('mcp-panel-ineligible')).textContent).toContain(
        translations.settings.mcp.ineligible_guest_not_allowed
      );
      await waitFor(() => expect(api.listMyMcpConnections).toHaveBeenCalled());
      expect(screen.queryByTestId('mcp-my-connections')).toBeNull();
      expect(screen.queryByTestId('mcp-workspace-access')).toBeNull();
    });

    it('shows an ineligible account its connections’ load failure with Retry', async () => {
      api.getMcpMemberStatus.mockResolvedValue(
        memberStatus({ eligible: false, ineligible_reason: 'email_not_allowed', requires_approval: true })
      );
      let resolveRetry!: (connections: McpMyConnection[]) => void;

      api.listMyMcpConnections
        .mockRejectedValueOnce(new McpApiError({ status: 503, reason: 'temporarily_unavailable' }))
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveRetry = resolve;
          })
        );
      render(<McpPanel workspaceId={WS} />);

      expect(await screen.findByTestId('mcp-panel-ineligible')).toBeTruthy();
      expect(await screen.findByTestId('mcp-my-connections-error')).toBeTruthy();
      expect(screen.queryByTestId('mcp-my-connections-empty')).toBeNull();

      fireEvent.click(screen.getByTestId('mcp-my-connections-error-retry'));
      // The section stays, loading, while the Retry runs.
      expect(screen.getByTestId('mcp-my-connections')).toBeTruthy();
      await act(async () => {
        resolveRetry([myClaude]);
      });
      expect(screen.getByTestId('mcp-my-connection-row')).toBeTruthy();
      expect(screen.queryByTestId('mcp-my-connections-error')).toBeNull();
    });

    it('disconnects one device only after confirmation and keeps the others', async () => {
      api.listMyMcpConnections.mockResolvedValueOnce([myClaude, myClaudeDesktop]).mockResolvedValue([myClaudeDesktop]);
      render(<McpPanel workspaceId={WS} />);
      await waitFor(() => expect(rows('mcp-my-connection-row')).toHaveLength(2));

      const desktop = rows('mcp-my-connection-row')[1];

      expect(within(desktop).getByTestId('mcp-my-connection-device').textContent).toBe('Claude Code 2.1 · Windows');
      expect(within(desktop).queryByTestId('mcp-my-connection-last-used')).toBeNull();

      fireEvent.click(screen.getByTestId('mcp-my-disconnect-0'));
      const dialog = await screen.findByTestId('mcp-disconnect-dialog');

      expect(within(dialog).getByText('Disconnect Claude?')).toBeTruthy();
      expect(
        within(dialog).getByText('Claude will lose access to this workspace. You can connect it again later.')
      ).toBeTruthy();
      expect(within(dialog).getByTestId('mcp-disconnect-device-note').textContent).toBe(
        'Only the connection from Claude Code 2.1 · macOS ends; other connections keep working.'
      );
      fireEvent.click(within(dialog).getByText('Cancel'));
      await waitFor(() => expect(screen.queryByTestId('mcp-disconnect-dialog')).toBeNull());
      expect(api.disconnectMyMcpConnection).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('mcp-my-disconnect-0'));
      fireEvent.click(await screen.findByTestId('mcp-confirm-disconnect'));

      await waitFor(() => expect(rows('mcp-my-connection-row')).toHaveLength(1));
      expect(rows('mcp-my-connection-row')[0].getAttribute('data-family-id')).toBe('family-desktop');
      expect(api.disconnectMyMcpConnection).toHaveBeenCalledWith(WS, claude.client_id, {
        familyId: 'family-laptop',
        signal: expect.any(AbortSignal),
      });
      expect(notify.success).toHaveBeenCalledWith('Disconnected');
      await waitFor(() => expect(api.listMyMcpConnections).toHaveBeenCalledTimes(2));
      // The cross-workspace summary follows.
      await waitFor(() => expect(api.listMyMcpConnectionsAcrossWorkspaces).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByTestId('mcp-disconnect-dialog')).toBeNull());
    });

    it('disconnects a legacy connection without a family by its client', async () => {
      const legacy: McpMyConnection = { ...myClaude, family_id: null, device_label: null, last_used_at: null };

      api.listMyMcpConnections.mockResolvedValueOnce([legacy]).mockResolvedValue([]);
      render(<McpPanel workspaceId={WS} />);

      const row = await screen.findByTestId('mcp-my-connection-row');

      expect(within(row).queryByTestId('mcp-my-connection-device')).toBeNull();
      expect(within(row).queryByTestId('mcp-my-connection-last-used')).toBeNull();
      fireEvent.click(screen.getByTestId('mcp-my-disconnect-0'));
      expect(screen.queryByTestId('mcp-disconnect-device-note')).toBeNull();
      fireEvent.click(await screen.findByTestId('mcp-confirm-disconnect'));

      expect(await screen.findByTestId('mcp-my-connections-empty')).toBeTruthy();
      expect(api.disconnectMyMcpConnection).toHaveBeenCalledWith(WS, claude.client_id, {
        familyId: null,
        signal: expect.any(AbortSignal),
      });
    });

    it('shows a failed list of the member’s connections with Retry, not the empty state', async () => {
      api.listMyMcpConnections
        .mockRejectedValueOnce(new McpApiError({ status: 500, reason: 'server_error' }))
        .mockResolvedValue([myClaude]);
      render(<McpPanel workspaceId={WS} />);

      expect(await screen.findByTestId('mcp-my-connections-error')).toBeTruthy();
      expect(screen.queryByTestId('mcp-my-connections-empty')).toBeNull();

      fireEvent.click(screen.getByTestId('mcp-my-connections-error-retry'));
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
      expect(screen.queryByTestId('mcp-my-connections-error')).toBeNull();
    });

    it('shows a failed reload after a disconnect as an error, not as nothing connected', async () => {
      api.listMyMcpConnections
        .mockResolvedValueOnce([myClaude])
        .mockRejectedValueOnce(new McpApiError({ status: 500, reason: 'server_error' }))
        .mockResolvedValue([]);
      render(<McpPanel workspaceId={WS} />);

      fireEvent.click(await screen.findByTestId('mcp-my-disconnect-0'));
      fireEvent.click(await screen.findByTestId('mcp-confirm-disconnect'));

      expect(await screen.findByTestId('mcp-my-connections-error')).toBeTruthy();
      expect(screen.queryByTestId('mcp-my-connections-empty')).toBeNull();
      fireEvent.click(screen.getByTestId('mcp-my-connections-error-retry'));
      expect(await screen.findByTestId('mcp-my-connections-empty')).toBeTruthy();
    });

    it('reports a failed disconnect and keeps its confirmation and the connection', async () => {
      api.disconnectMyMcpConnection.mockRejectedValue(new McpApiError({ status: 429, reason: 'rate_limited' }));
      render(<McpPanel workspaceId={WS} />);

      fireEvent.click(await screen.findByTestId('mcp-my-disconnect-0'));
      fireEvent.click(await screen.findByTestId('mcp-confirm-disconnect'));

      await waitFor(() =>
        expect(notify.error).toHaveBeenCalledWith("That didn't work. Too many attempts. Wait a minute and try again.")
      );
      // A closed dialog stays in the DOM while it fades out; wait that out before checking it stayed open.
      await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
      expect(screen.getByTestId('mcp-disconnect-dialog')).toBeTruthy();
      expect(rows('mcp-my-connection-row')).toHaveLength(1);
      expect(notify.success).not.toHaveBeenCalled();
      expect(api.listMyMcpConnections).toHaveBeenCalledTimes(1);
    });
  });

  describe('owners', () => {
    it('shows the approval policy, requests, approved apps and member connections by member', async () => {
      await renderOwnerPanel();

      expect(screen.queryByTestId('mcp-approval-notice')).toBeNull();
      expect(modeRadio('verified_and_approved').checked).toBe(true);
      expect(modeRadio('approved_only').checked).toBe(false);
      expect(modeRadio('any').checked).toBe(false);
      expect(screen.getByRole('radio', { name: /Verified and approved apps/ })).toBeTruthy();
      expect(screen.queryByRole('switch')).toBeNull();
      expect(api.getMcpWorkspaceSettings).toHaveBeenCalledWith(WS, signal);
      expect(api.listMcpAccessRequests).toHaveBeenCalledWith(WS, signal);
      expect(api.listMcpWorkspaceConnections).toHaveBeenCalledWith(WS, signal);

      const request = screen.getByTestId('mcp-access-request-row');

      expect(within(request).getByTestId('mcp-client-identity-name').textContent).toBe('Cursor');
      expect(within(request).getByTestId('mcp-client-unverified-badge')).toBeTruthy();
      expect(within(request).getByTestId('mcp-client-local-badge')).toBeTruthy();
      expect(within(request).queryByTestId('mcp-access-request-scope')).toBeNull();
      expect(within(request).getByTestId('mcp-access-request-requesters').textContent).toBe(
        'Requested by Ann, bo@example.com, Cy and 1 more'
      );
      expect(within(request).getByTestId('mcp-access-request-time').textContent).toBe('5 minutes ago');

      const approved = screen.getByTestId('mcp-approved-client-row');

      expect(within(approved).getByTestId('mcp-client-identity-name').textContent).toBe('Claude');
      expect(within(approved).queryByTestId('mcp-approved-client-scope')).toBeNull();
      expect(within(approved).getByTestId('mcp-approved-client-approver').textContent).toBe('Approved by Olivia Owner');
      expect(within(approved).getByTestId('mcp-approved-client-time').getAttribute('dateTime')).toBe(
        '2026-10-01T10:00:00.000Z'
      );
      expect(within(approved).getByTestId('mcp-approved-client-connections').textContent).toBe('2 active connections');

      const [annGroup, eveGroup] = rows('mcp-member-connection-group');

      expect(annGroup.getAttribute('data-user-uuid')).toBe('u1');
      expect(within(annGroup).getByTestId('mcp-member-connection-member').textContent).toBe('Ann');
      expect(within(annGroup).getByTestId('mcp-member-connection-email').textContent).toBe('ann@example.com');
      expect(within(annGroup).getByTestId('mcp-member-connection-count').textContent).toBe('1 connection');

      const ann = within(annGroup).getByTestId('mcp-member-connection-row');

      expect(ann.getAttribute('data-family-id')).toBe('ann-claude');
      expect(within(ann).getByTestId('mcp-scope-badge').getAttribute('data-level')).toBe('read');
      expect(within(ann).getByTestId('mcp-member-connection-device').textContent).toBe('Claude · Chrome');
      expect(within(ann).getByTestId('mcp-member-connection-time').textContent).toBe('Connected 3 days ago');
      expect(within(ann).getByTestId('mcp-member-connection-last-used').textContent).toBe('Last used 1 hour ago');
      expect(within(eveGroup).getByTestId('mcp-member-connection-member').textContent).toBe('eve@example.com');
      expect(within(eveGroup).queryByTestId('mcp-member-connection-email')).toBeNull();
      expect(within(eveGroup).getByTestId('mcp-scope-badge').getAttribute('data-level')).toBe('full');
      expect(within(eveGroup).queryByTestId('mcp-member-connection-device')).toBeNull();

      expect(text('mcp-propagation-note')).toBe(translations.settings.mcp.propagationNote);
      expect(screen.getByTestId<HTMLButtonElement>('mcp-disconnect-all-button').disabled).toBe(false);
    });

    it('shows names as typed, not HTML-escaped, and counts an approved app nobody uses as 0', async () => {
      api.getMcpWorkspaceSettings.mockResolvedValue({
        ...settings,
        approved_clients: [{ ...approval(claude), approved_by_name: 'Tom & Jerry <ops>' }],
      });
      api.listMcpAccessRequests.mockResolvedValue([
        { ...cursorRequest, requesters: [{ user_uuid: 'u1', name: 'Q&A "bot"', requested_at: secondsAgo(90) }] },
      ]);
      // Nobody uses the approved Claude.
      api.listMcpWorkspaceConnections.mockResolvedValue([annOnCursor]);
      await renderOwnerPanel();

      expect(text('mcp-access-request-requesters')).toBe('Requested by Q&A "bot"');
      expect(text('mcp-approved-client-approver')).toBe('Approved by Tom & Jerry <ops>');
      expect(text('mcp-approved-client-connections')).toBe('0 active connections');
    });

    it('groups each member’s devices under one header with a count', async () => {
      const annOnClaudeLaptop: McpWorkspaceConnection = {
        ...annOnClaude,
        family_id: 'ann-claude-2',
        device_label: 'Claude Code 2.1 · Linux',
      };

      api.listMcpWorkspaceConnections.mockResolvedValue([annOnClaude, eveOnClaude, annOnClaudeLaptop, boOnCursor]);
      await renderOwnerPanel();

      const groups = rows('mcp-member-connection-group');

      expect(groups.map((group) => group.getAttribute('data-user-uuid'))).toEqual(['u1', 'u5', 'u2']);
      expect(within(groups[0]).getByTestId('mcp-member-connection-count').textContent).toBe('2 connections');
      expect(
        within(groups[0])
          .getAllByTestId('mcp-member-connection-row')
          .map((row) => row.getAttribute('data-family-id'))
      ).toEqual(['ann-claude', 'ann-claude-2']);
      // Disconnect buttons are numbered in display order.
      expect(within(groups[0]).getByTestId('mcp-member-disconnect-1')).toBeTruthy();
      expect(within(groups[1]).getByTestId('mcp-member-disconnect-2')).toBeTruthy();
    });

    it('asks before allowing any app, and requires approval again without asking when nothing changes', async () => {
      await renderOwnerPanel();

      fireEvent.click(modeRadio('any'));
      const dialog = await screen.findByTestId('mcp-allow-all-dialog');

      expect(within(dialog).getByText('Allow any AI app?')).toBeTruthy();
      expect(api.updateMcpWorkspaceSettings).not.toHaveBeenCalled();
      expect(modeRadio('verified_and_approved').checked).toBe(true);

      fireEvent.click(within(dialog).getByTestId('mcp-confirm-allow-all'));
      await waitFor(() => expect(modeRadio('any').checked).toBe(true));
      expect(api.updateMcpWorkspaceSettings).toHaveBeenCalledWith(WS, 'any', signal);
      await waitFor(() => expect(screen.queryByTestId('mcp-allow-all-dialog')).toBeNull());

      // Ann and Eve use Claude, which is approved: nothing to keep, so no question.
      fireEvent.click(modeRadio('approved_only'));
      await waitFor(() => expect(modeRadio('approved_only').checked).toBe(true));
      expect(api.updateMcpWorkspaceSettings).toHaveBeenLastCalledWith(WS, 'approved_only', signal);
      expect(api.updateMcpWorkspaceSettings).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId('mcp-require-approval-dialog')).toBeNull();
    });

    it('warns before letting verified apps connect without approval', async () => {
      api.getMcpWorkspaceSettings.mockResolvedValue(settingsWith('approved_only'));
      await renderOwnerPanel();

      fireEvent.click(modeRadio('verified_and_approved'));
      const dialog = await screen.findByTestId('mcp-allow-verified-dialog');

      expect(within(dialog).getByText('Allow verified apps without approval?')).toBeTruthy();
      expect(within(dialog).getByText(/like Claude and ChatGPT, without an owner's approval/)).toBeTruthy();
      expect(within(dialog).getByText(/like Claude Code and Cursor, still need one/)).toBeTruthy();
      fireEvent.click(within(dialog).getByText('Cancel'));
      await waitFor(() => expect(screen.queryByTestId('mcp-allow-verified-dialog')).toBeNull());
      expect(api.updateMcpWorkspaceSettings).not.toHaveBeenCalled();
      expect(modeRadio('approved_only').checked).toBe(true);

      fireEvent.click(modeRadio('verified_and_approved'));
      fireEvent.click(await screen.findByTestId('mcp-confirm-allow-verified'));
      await waitFor(() => expect(modeRadio('verified_and_approved').checked).toBe(true));
      expect(api.updateMcpWorkspaceSettings).toHaveBeenCalledWith(WS, 'verified_and_approved', signal);
    });

    it('names the apps that stay approved before a stricter policy, then toasts what the server kept', async () => {
      const approvedAgain = settingsWith('approved_only', [
        ...settings.approved_clients,
        ...[cursor, vscode].map((client) => ({ ...approval(client), approved_at: '2026-11-01T10:00:00Z' })),
      ]);

      api.getMcpWorkspaceSettings.mockResolvedValueOnce(settingsWith('any')).mockResolvedValue(approvedAgain);
      api.listMcpWorkspaceConnections.mockResolvedValue([annOnClaude, annOnCursor, boOnCursor, boOnVscode]);
      api.updateMcpWorkspaceSettings.mockResolvedValue({
        ...approvedAgain,
        auto_approved_clients: [cursor, vscode].map((client) => ({ ...client, approval_key: client.client_id })),
      });
      await renderOwnerPanel();

      expect(modeRadio('any').checked).toBe(true);
      fireEvent.click(modeRadio('approved_only'));

      const dialog = await screen.findByTestId('mcp-require-approval-dialog');

      expect(within(dialog).getByText('Allow only approved apps?')).toBeTruthy();
      expect(
        within(dialog).getByText('These apps stay approved so members keep working: Cursor, Visual Studio Code.')
      ).toBeTruthy();
      expect(api.updateMcpWorkspaceSettings).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByTestId('mcp-confirm-require-approval'));

      await waitFor(() => expect(modeRadio('approved_only').checked).toBe(true));
      expect(api.updateMcpWorkspaceSettings).toHaveBeenCalledWith(WS, 'approved_only', signal);
      expect(notify.success).toHaveBeenCalledWith('Cursor, Visual Studio Code stay approved so members keep working.');
      // The approved apps now include the two the server approved.
      await waitFor(() => expect(rows('mcp-approved-client-row')).toHaveLength(3));
      await waitFor(() => expect(screen.queryByTestId('mcp-require-approval-dialog')).toBeNull());
    });

    it('keeps apps on members’ computers and unverified apps approved when verified web apps may still connect', async () => {
      api.getMcpWorkspaceSettings.mockResolvedValue(settingsWith('any', []));
      api.listMcpWorkspaceConnections.mockResolvedValue([
        annOnClaude,
        { ...annOnClaude, ...cursorAppA, family_id: 'ann-cursor-app' },
        boOnVscode,
      ]);
      await renderOwnerPanel();

      fireEvent.click(modeRadio('verified_and_approved'));
      const dialog = await screen.findByTestId('mcp-require-approval-dialog');

      expect(within(dialog).getByText('Require approval for unverified apps?')).toBeTruthy();
      // Claude still connects; Cursor is recognized but runs on members' computers, so it is kept too.
      expect(
        within(dialog).getByText('These apps stay approved so members keep working: Cursor, Visual Studio Code.')
      ).toBeTruthy();
      fireEvent.click(within(dialog).getByTestId('mcp-confirm-require-approval'));
      await waitFor(() =>
        expect(api.updateMcpWorkspaceSettings).toHaveBeenCalledWith(WS, 'verified_and_approved', signal)
      );
    });

    it('still toasts the app the server kept approved when the connection list did not load', async () => {
      api.getMcpMemberStatus.mockResolvedValue(ownerStatus());
      api.getMcpWorkspaceSettings.mockResolvedValue(settingsWith('any'));
      api.listMcpWorkspaceConnections.mockRejectedValue(
        new McpApiError({ status: 503, reason: 'temporarily_unavailable' })
      );
      api.updateMcpWorkspaceSettings.mockResolvedValue({
        ...settingsWith('approved_only'),
        auto_approved_clients: [{ ...cursor, approval_key: cursor.client_id }],
      });
      render(<McpPanel workspaceId={WS} />);
      await screen.findByTestId('mcp-member-connections-error');

      fireEvent.click(await screen.findByTestId('mcp-approval-mode-approved_only'));

      await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Cursor stays approved so members keep working.'));
      expect(screen.queryByTestId('mcp-require-approval-dialog')).toBeNull();
    });

    it('does not repeat a member’s email under a name that is the email', async () => {
      api.listMcpWorkspaceConnections.mockResolvedValue([
        { ...annOnClaude, user_uuid: 'u6', user_name: 'olivia@example.com', user_email: 'olivia@example.com' },
      ]);
      await renderOwnerPanel();

      const group = screen.getByTestId('mcp-member-connection-group');

      expect(within(group).getByTestId('mcp-member-connection-member').textContent).toBe('olivia@example.com');
      expect(within(group).queryByTestId('mcp-member-connection-email')).toBeNull();
    });

    it('approves and dismisses approval requests', async () => {
      api.listMcpAccessRequests.mockResolvedValueOnce([cursorRequest, vscodeRequest]).mockResolvedValue([vscodeRequest]);
      await renderOwnerPanel();
      await waitFor(() => expect(rows('mcp-access-request-row')).toHaveLength(2));

      fireEvent.click(screen.getByTestId('mcp-approve-request-0'));
      await waitFor(() => expect(rows('mcp-access-request-row')).toHaveLength(1));
      expect(api.approveMcpClient).toHaveBeenCalledWith(WS, cursor.client_id, signal);
      expect(notify.success).toHaveBeenCalledWith('Approved');
      await waitFor(() => expect(api.getMcpWorkspaceSettings).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(api.listMcpAccessRequests).toHaveBeenCalledTimes(2));
      expect(within(screen.getByTestId('mcp-access-request-row')).getByText('Visual Studio Code')).toBeTruthy();

      api.listMcpAccessRequests.mockResolvedValue([]);
      fireEvent.click(screen.getByTestId('mcp-dismiss-request-0'));
      expect(await screen.findByTestId('mcp-access-requests-empty')).toBeTruthy();
      expect(api.dismissMcpAccessRequest).toHaveBeenCalledWith(WS, vscode.client_id, signal);
    });

    it('dismisses a recognized app’s merged request by its app key', async () => {
      const cursorAppRequest: McpAccessRequest = { ...cursorRequest, ...cursorAppB, approval_key: 'app:cursor' };

      api.listMcpAccessRequests.mockResolvedValueOnce([cursorAppRequest]).mockResolvedValue([]);
      await renderOwnerPanel();

      const request = screen.getByTestId('mcp-access-request-row');

      expect(within(request).getByTestId('mcp-client-identity-name').textContent).toBe('Cursor');
      // Recognized, but it runs on members' computers: never called verified.
      expect(within(request).getByTestId('mcp-client-native-app-badge')).toBeTruthy();
      expect(within(request).queryByTestId('mcp-client-verified-app-badge')).toBeNull();
      expect(within(request).getByTestId('mcp-access-request-scope').textContent).toBe(
        'Approving covers all Cursor installs.'
      );

      fireEvent.click(screen.getByTestId('mcp-dismiss-request-0'));
      expect(await screen.findByTestId('mcp-access-requests-empty')).toBeTruthy();
      expect(api.dismissMcpAccessRequest).toHaveBeenCalledWith(WS, 'app:cursor', signal);
    });

    it('approves a recognized app’s merged request by its app key', async () => {
      // The server merges a recognized app's requests under its app key.
      const cursorAppRequest: McpAccessRequest = { ...cursorRequest, ...cursorAppB, approval_key: 'app:cursor' };

      api.listMcpAccessRequests
        .mockResolvedValueOnce([cursorAppRequest, vscodeRequest])
        .mockResolvedValue([vscodeRequest]);
      await renderOwnerPanel();
      await waitFor(() => expect(rows('mcp-access-request-row')).toHaveLength(2));

      fireEvent.click(screen.getByTestId('mcp-approve-request-0'));

      await waitFor(() => expect(rows('mcp-access-request-row')).toHaveLength(1));
      // The app key needs no lookup of the registration that asked last, which may be gone or
      // unreachable by now (a CIMD document); the server approves the app and clears the request.
      expect(api.approveMcpClient).toHaveBeenCalledWith(WS, 'app:cursor', signal);
      expect(api.approveMcpClient).toHaveBeenCalledTimes(1);
      expect(rows('mcp-access-request-row')[0].getAttribute('data-client-id')).toBe(vscode.client_id);
    });

    it('approves a request the server filed under an app key by that key, not by the CIMD client that asked', async () => {
      // Approving by the client ID would make the server fetch that client's metadata document again.
      const chatgptRequest: McpAccessRequest = {
        ...cursorRequest,
        client_id: 'https://chatgpt.com/oauth/client.json',
        client_name: null,
        client_kind: 'cimd',
        client_host: 'chatgpt.com',
        redirect_hosts: [],
        loopback_only: false,
        app_id: 'chatgpt',
        app_name: 'ChatGPT',
        verified_app: true,
        identity_verified: true,
        approval_key: 'app:chatgpt',
      };

      api.listMcpAccessRequests.mockResolvedValueOnce([chatgptRequest]).mockResolvedValue([]);
      await renderOwnerPanel();

      fireEvent.click(screen.getByTestId('mcp-approve-request-0'));

      expect(await screen.findByTestId('mcp-access-requests-empty')).toBeTruthy();
      expect(api.approveMcpClient).toHaveBeenCalledWith(WS, 'app:chatgpt', signal);
    });

    it('revokes an approved app only after confirmation', async () => {
      api.getMcpWorkspaceSettings
        .mockResolvedValueOnce(settingsWith('approved_only'))
        .mockResolvedValue(settingsWith('approved_only', []));
      api.listMcpWorkspaceConnections.mockResolvedValueOnce([annOnClaude, eveOnClaude]).mockResolvedValue([]);
      await renderOwnerPanel();

      fireEvent.click(screen.getByTestId('mcp-revoke-client-0'));
      const dialog = await screen.findByTestId('mcp-revoke-dialog');

      expect(within(dialog).getByText('Revoke Claude?')).toBeTruthy();
      expect(
        within(dialog).getByText(
          "Members won't be able to connect Claude until it's approved again. Revoking also disconnects every member using it."
        )
      ).toBeTruthy();
      expect(api.revokeMcpClientApproval).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByTestId('mcp-confirm-revoke'));
      expect(await screen.findByTestId('mcp-approved-clients-empty')).toBeTruthy();
      expect(api.revokeMcpClientApproval).toHaveBeenCalledWith(WS, claude.client_id, signal);
      expect(await screen.findByTestId('mcp-member-connections-empty')).toBeTruthy();
      // The owner's own connection to the revoked app is gone too.
      await waitFor(() => expect(api.listMyMcpConnections).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByTestId('mcp-revoke-dialog')).toBeNull());
    });

    it('shows an app-level approval as all installs and revokes it by its key', async () => {
      const cursorApproval = approval(cursorAppA, 'app:cursor');
      const annOnCursorA: McpWorkspaceConnection = { ...annOnClaude, ...cursorAppA, family_id: 'ann-cursor-a' };
      const boOnCursorB: McpWorkspaceConnection = {
        ...boOnCursor,
        ...cursorAppB,
        family_id: 'bo-cursor-b',
      };

      api.getMcpWorkspaceSettings
        .mockResolvedValueOnce(settingsWith('approved_only', [cursorApproval]))
        .mockResolvedValue(settingsWith('approved_only', []));
      api.listMcpWorkspaceConnections
        .mockResolvedValueOnce([annOnClaude, annOnCursorA, boOnCursorB])
        .mockResolvedValue([annOnClaude]);
      await renderOwnerPanel();

      const approved = screen.getByTestId('mcp-approved-client-row');

      expect(approved.getAttribute('data-approval-key')).toBe('app:cursor');
      expect(within(approved).getByTestId('mcp-client-identity-name').textContent).toBe('Cursor');
      expect(within(approved).getByTestId('mcp-approved-client-scope').textContent).toBe('All Cursor installs');
      // Both registrations count toward the app.
      expect(within(approved).getByTestId('mcp-approved-client-connections').textContent).toBe('2 active connections');

      fireEvent.click(screen.getByTestId('mcp-revoke-client-0'));
      const dialog = await screen.findByTestId('mcp-revoke-dialog');

      expect(
        within(dialog).getByText(/won't be able to connect any Cursor install until it's approved again/)
      ).toBeTruthy();
      fireEvent.click(within(dialog).getByTestId('mcp-confirm-revoke'));

      await waitFor(() => expect(api.revokeMcpClientApproval).toHaveBeenCalledWith(WS, 'app:cursor', signal));
      // Both Cursor registrations go at once; Claude stays.
      await waitFor(() =>
        expect(rows('mcp-member-connection-row').map((row) => row.getAttribute('data-family-id'))).toEqual([
          'ann-claude',
        ])
      );
    });

    it('says a revoked verified app can reconnect while the policy admits verified apps', async () => {
      await renderOwnerPanel();

      fireEvent.click(screen.getByTestId('mcp-revoke-client-0'));
      const dialog = await screen.findByTestId('mcp-revoke-dialog');

      expect(
        within(dialog).getByText(
          "Revoking disconnects every member using Claude. The workspace's policy still lets members connect it again."
        )
      ).toBeTruthy();
    });

    it('says members can reconnect after revoking one install of an app whose installs are all approved', async () => {
      // One registration approved on its own (before app-level approvals) next to all Cursor installs.
      const oneInstall = approval(cursorAppA);
      const allInstalls = approval(cursorAppB, 'app:cursor');

      api.getMcpWorkspaceSettings.mockResolvedValue(settingsWith('approved_only', [oneInstall, allInstalls]));
      await renderOwnerPanel();

      fireEvent.click(screen.getByTestId('mcp-revoke-client-0'));
      const dialog = await screen.findByTestId('mcp-revoke-dialog');

      expect(
        within(dialog).getByText(
          'Revoking disconnects every member using this Cursor install. They can connect it again right away, because all Cursor installs stay approved.'
        )
      ).toBeTruthy();
      expect(within(dialog).queryByText(/until it's approved again/)).toBeNull();
      fireEvent.click(within(dialog).getByText('Cancel'));
      await waitFor(() => expect(screen.queryByTestId('mcp-revoke-dialog')).toBeNull());

      // Revoking the approval of all installs still says every install needs a new one.
      fireEvent.click(screen.getByTestId('mcp-revoke-client-1'));
      const appDialog = await screen.findByTestId('mcp-revoke-dialog');

      expect(
        within(appDialog).getByText(/won't be able to connect any Cursor install until it's approved again/)
      ).toBeTruthy();
    });

    it('disconnects one member device with all three filters after confirmation', async () => {
      const annOnClaudeLaptop: McpWorkspaceConnection = {
        ...annOnClaude,
        family_id: 'ann-claude-2',
        device_label: null,
      };

      api.listMcpWorkspaceConnections
        .mockResolvedValueOnce([annOnClaude, annOnClaudeLaptop, eveOnClaude])
        .mockResolvedValue([annOnClaudeLaptop, eveOnClaude]);
      await renderOwnerPanel();

      fireEvent.click(screen.getByTestId('mcp-member-disconnect-0'));
      const dialog = await screen.findByTestId('mcp-member-disconnect-dialog');

      expect(within(dialog).getByText('Disconnect Ann from Claude?')).toBeTruthy();
      expect(within(dialog).getByTestId('mcp-disconnect-device-note').textContent).toBe(
        'Only the connection from Claude · Chrome ends; other connections keep working.'
      );
      fireEvent.click(within(dialog).getByTestId('mcp-confirm-member-disconnect'));

      await waitFor(() => expect(rows('mcp-member-connection-row')).toHaveLength(2));
      expect(api.disconnectMcpWorkspaceConnections).toHaveBeenCalledWith(
        WS,
        { clientId: claude.client_id, userUuid: 'u1', familyId: 'ann-claude' },
        signal
      );
      expect(notify.success).toHaveBeenCalledWith('Disconnected');
      expect(
        within(screen.getAllByTestId('mcp-member-connection-group')[0]).getByTestId('mcp-member-connection-count')
          .textContent
      ).toBe('1 connection');
      await waitFor(() => expect(api.listMcpWorkspaceConnections).toHaveBeenCalledTimes(2));
      // The owner may have disconnected their own connection.
      await waitFor(() => expect(api.listMyMcpConnections).toHaveBeenCalledTimes(2));
    });

    it('disconnects every AI app only after confirmation', async () => {
      api.listMcpWorkspaceConnections.mockResolvedValueOnce([annOnClaude, eveOnClaude]).mockResolvedValue([]);
      await renderOwnerPanel();

      fireEvent.click(screen.getByTestId('mcp-disconnect-all-button'));
      const dialog = await screen.findByTestId('mcp-disconnect-all-dialog');

      expect(within(dialog).getByText('Disconnect all AI apps?')).toBeTruthy();
      expect(within(dialog).getByText(/Members have to connect their apps again/)).toBeTruthy();
      expect(api.disconnectAllMcpWorkspaceConnections).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByTestId('mcp-confirm-disconnect-all'));

      expect(await screen.findByTestId('mcp-member-connections-empty')).toBeTruthy();
      expect(api.disconnectAllMcpWorkspaceConnections).toHaveBeenCalledWith(WS, signal);
      expect(api.disconnectMcpWorkspaceConnections).not.toHaveBeenCalled();
      expect(notify.success).toHaveBeenCalledWith('Disconnected 3 connections');
      await waitFor(() => expect(api.listMyMcpConnections).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByTestId('mcp-disconnect-all-dialog')).toBeNull());
      // Nothing left to disconnect.
      expect(screen.getByTestId<HTMLButtonElement>('mcp-disconnect-all-button').disabled).toBe(true);
    });

    it('approves an app by client ID', async () => {
      await renderOwnerPanel();
      const toggle = screen.getByTestId('mcp-approve-by-id-toggle');

      expect(screen.queryByTestId('mcp-approve-by-id-input')).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      const input = screen.getByTestId<HTMLInputElement>('mcp-approve-by-id-input');
      const submit = screen.getByTestId<HTMLButtonElement>('mcp-approve-by-id-submit');

      expect(submit.disabled).toBe(true);
      // No longer than the server accepts (MAX_CLIENT_ID_BYTES).
      expect(input.maxLength).toBe(2048);
      fireEvent.change(input, { target: { value: '  https://app.example.com/oauth/client.json ' } });
      expect(submit.disabled).toBe(false);
      fireEvent.click(submit);

      await waitFor(() => expect(input.value).toBe(''));
      expect(api.approveMcpClient).toHaveBeenCalledWith(WS, 'https://app.example.com/oauth/client.json', signal);
      expect(notify.success).toHaveBeenCalledWith('Approved');
    });

    it('says when no app is registered with the typed client ID', async () => {
      api.approveMcpClient.mockRejectedValue(
        new McpApiError({ status: 404, error: 'invalid_client', reason: 'unknown_client' })
      );
      await renderOwnerPanel();
      fireEvent.click(screen.getByTestId('mcp-approve-by-id-toggle'));

      const input = screen.getByTestId<HTMLInputElement>('mcp-approve-by-id-input');

      fireEvent.change(input, { target: { value: 'dcr-missing' } });
      fireEvent.click(screen.getByTestId('mcp-approve-by-id-submit'));

      await waitFor(() =>
        expect(notify.error).toHaveBeenCalledWith("That didn't work. No app is registered with this client ID.")
      );
      // The typed ID stays so it can be corrected.
      expect(input.value).toBe('dcr-missing');
      expect(notify.success).not.toHaveBeenCalled();
    });

    it('reports a failed action and keeps its confirmation open', async () => {
      api.revokeMcpClientApproval.mockRejectedValue(new McpApiError({ status: 429, reason: 'rate_limited' }));
      await renderOwnerPanel();

      fireEvent.click(screen.getByTestId('mcp-revoke-client-0'));
      fireEvent.click(await screen.findByTestId('mcp-confirm-revoke'));

      await waitFor(() =>
        expect(notify.error).toHaveBeenCalledWith("That didn't work. Too many attempts. Wait a minute and try again.")
      );
      expect(screen.getByTestId('mcp-revoke-dialog')).toBeTruthy();
      expect(rows('mcp-approved-client-row')).toHaveLength(1);
    });

    it('shows a section error with Retry when one owner list fails', async () => {
      api.listMcpAccessRequests.mockRejectedValueOnce(new McpApiError({ status: 500, reason: 'server_error' }));
      api.getMcpMemberStatus.mockResolvedValue(ownerStatus());
      render(<McpPanel workspaceId={WS} />);

      expect(await screen.findByTestId('mcp-access-requests-error')).toBeTruthy();
      expect(await screen.findByTestId('mcp-approved-client-row')).toBeTruthy();
      expect(screen.queryByTestId('mcp-panel-unavailable')).toBeNull();

      fireEvent.click(screen.getByTestId('mcp-access-requests-error-retry'));
      expect(await screen.findByTestId('mcp-access-request-row')).toBeTruthy();
      expect(screen.queryByTestId('mcp-access-requests-error')).toBeNull();
    });

    it('shows an owner the email gate excludes only their own connections and drops the menu badge', async () => {
      function Badge() {
        const count = useMcpPendingRequestCount(WS, true);

        return <span data-testid='badge'>{count ?? 'none'}</span>;
      }

      api.getMcpMemberStatus.mockResolvedValue(ownerStatus());
      api.listMcpAccessRequests.mockResolvedValueOnce([cursorRequest, vscodeRequest]);
      render(<Badge />);
      await waitFor(() => expect(text('badge')).toBe('2'));
      api.listMcpAccessRequests.mockClear();

      api.getMcpMemberStatus.mockResolvedValue({
        ...ownerStatus(),
        eligible: false,
        ineligible_reason: 'email_not_allowed',
      });
      render(<McpPanel workspaceId={WS} />);

      expect((await screen.findByTestId('mcp-panel-ineligible')).getAttribute('data-reason')).toBe('email_not_allowed');
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
      await waitFor(() => expect(text('badge')).toBe('none'));
      // Owner governance for excluded owners is not in v1 (doc/MCP.md).
      expect(screen.queryByTestId('mcp-workspace-access')).toBeNull();
      expect(api.getMcpWorkspaceSettings).not.toHaveBeenCalled();
      expect(api.listMcpAccessRequests).not.toHaveBeenCalled();
      expect(api.listMcpWorkspaceConnections).not.toHaveBeenCalled();
    });

    it('shows one alert with Retry when the settings fail, then the policy and approved apps', async () => {
      api.getMcpWorkspaceSettings.mockRejectedValueOnce(new McpApiError({ status: 500, reason: 'server_error' }));
      api.getMcpMemberStatus.mockResolvedValue(ownerStatus());
      render(<McpPanel workspaceId={WS} />);

      const access = await screen.findByTestId('mcp-workspace-access');

      expect(await within(access).findByTestId('mcp-settings-error')).toBeTruthy();
      await within(access).findAllByTestId('mcp-member-connection-row');
      await within(access).findAllByTestId('mcp-access-request-row');
      // The policy and the approved apps come from one request: one alert and one Retry for both.
      expect(within(access).getAllByRole('alert')).toHaveLength(1);
      expect(within(access).getAllByText(translations.settings.mcp.retry)).toHaveLength(1);
      expect(screen.queryByTestId('mcp-approved-clients')).toBeNull();

      fireEvent.click(screen.getByTestId('mcp-settings-error-retry'));
      expect(await screen.findByTestId('mcp-approval-mode')).toBeTruthy();
      expect(modeRadio('verified_and_approved').checked).toBe(true);
      expect(await screen.findByTestId('mcp-approved-client-row')).toBeTruthy();
      expect(screen.queryByTestId('mcp-settings-error')).toBeNull();
      expect(api.getMcpWorkspaceSettings).toHaveBeenCalledTimes(2);
    });

    it('says when the workspace’s approval policy is one this Web does not know, instead of loading', async () => {
      // A policy a newer server added reads as undefined (getMcpWorkspaceSettings).
      api.getMcpWorkspaceSettings.mockResolvedValue({ ...settings, approval_mode: undefined });
      api.getMcpMemberStatus.mockResolvedValue(ownerStatus());
      render(<McpPanel workspaceId={WS} />);

      const access = await screen.findByTestId('mcp-workspace-access');

      expect((await within(access).findByTestId('mcp-approval-mode-unknown')).textContent).toBe(
        translations.settings.mcp.approvalModeUnknown
      );
      expect(within(access).queryByTestId('mcp-approval-mode')).toBeNull();
      // The approved apps came with the settings; with every list loaded, nothing is still loading.
      expect(within(access).getByTestId('mcp-approved-client-row')).toBeTruthy();
      await within(access).findAllByTestId('mcp-access-request-row');
      await within(access).findAllByTestId('mcp-member-connection-row');
      expect(within(access).queryByRole('status')).toBeNull();
    });

    it('reloads the member status when the caller is no longer an owner', async () => {
      api.approveMcpClient.mockRejectedValue(
        new McpApiError({ status: 403, error: 'forbidden', reason: 'not_workspace_owner' })
      );
      await renderOwnerPanel();
      api.getMcpMemberStatus.mockResolvedValue(memberStatus());

      fireEvent.click(screen.getByTestId('mcp-approve-request-0'));

      await waitFor(() => expect(screen.queryByTestId('mcp-workspace-access')).toBeNull());
      expect(api.getMcpMemberStatus).toHaveBeenCalledTimes(2);
      expect(notify.error).toHaveBeenCalledWith("That didn't work. Only workspace owners can change AI app access.");
      expect(screen.getByTestId('mcp-my-connection-row')).toBeTruthy();
    });

    it('keeps the Settings menu badge in step with the requests the owner answers', async () => {
      function Badge() {
        const count = useMcpPendingRequestCount(WS, true);

        return <span data-testid='badge'>{count ?? 'none'}</span>;
      }

      api.getMcpMemberStatus.mockResolvedValue(ownerStatus());
      api.listMcpAccessRequests.mockResolvedValueOnce([cursorRequest, vscodeRequest]);
      render(<Badge />);
      await waitFor(() => expect(text('badge')).toBe('2'));

      api.listMcpAccessRequests.mockResolvedValueOnce([cursorRequest, vscodeRequest]).mockResolvedValue([vscodeRequest]);
      await renderOwnerPanel();
      fireEvent.click(screen.getByTestId('mcp-approve-request-0'));

      await waitFor(() => expect(text('badge')).toBe('1'));
    });
  });

  describe('AI app connections turned off', () => {
    const TURNED_OFF = 'AI app connections are turned off on this AppFlowy server. Ask your administrator.';
    const mcpDisabled = () => new McpApiError({ status: 503, error: 'mcp_disabled', reason: 'mcp_disabled' });

    /** The notice instead of the setup guide and every approval control. */
    async function expectTurnedOff() {
      const notice = await screen.findByTestId('mcp-panel-disabled');

      expect(notice.textContent).toContain(translations.settings.mcp.disabledTitle);
      expect(notice.textContent).toContain(translations.settings.mcp.disabledDescription);
      expect(screen.queryByTestId('mcp-connect-section')).toBeNull();
      expect(screen.queryByTestId('mcp-setup-guide')).toBeNull();
      expect(screen.queryByTestId('mcp-approval-notice')).toBeNull();
      expect(screen.queryByTestId('mcp-approved-for-workspace')).toBeNull();
      expect(screen.queryByTestId('mcp-workspace-access')).toBeNull();
      expect(screen.queryByTestId('mcp-panel-unavailable')).toBeNull();
      expect(screen.queryByTestId('mcp-panel-error')).toBeNull();
    }

    it('says so when the member status reports them off, and keeps the member’s devices to disconnect', async () => {
      api.getMcpMemberStatus.mockResolvedValue(
        memberStatus({
          enabled: false,
          requires_approval: true,
          approved_apps: [{ ...claude, approval_key: 'app:claude' }],
        })
      );
      api.listMyMcpConnections.mockResolvedValueOnce([myClaude, myClaudeDesktop]).mockResolvedValue([myClaudeDesktop]);
      render(<McpPanel workspaceId={WS} />);

      await expectTurnedOff();
      await waitFor(() => expect(rows('mcp-my-connection-row')).toHaveLength(2));
      expect(
        await within(screen.getByTestId('mcp-my-connections')).findByTestId('mcp-all-connections-summary')
      ).toBeTruthy();

      fireEvent.click(screen.getByTestId('mcp-my-disconnect-0'));
      fireEvent.click(await screen.findByTestId('mcp-confirm-disconnect'));

      await waitFor(() => expect(rows('mcp-my-connection-row')).toHaveLength(1));
      expect(api.disconnectMyMcpConnection).toHaveBeenCalledWith(WS, claude.client_id, {
        familyId: 'family-laptop',
        signal: expect.any(AbortSignal),
      });
      expect(notify.success).toHaveBeenCalledWith('Disconnected');
      expect(screen.getByTestId('mcp-panel-disabled')).toBeTruthy();
    });

    it('says so when the member status is refused with mcp_disabled, without Retry, and still lists connections', async () => {
      api.getMcpMemberStatus.mockRejectedValue(mcpDisabled());
      render(<McpPanel workspaceId={WS} />);

      await expectTurnedOff();
      expect(screen.queryByTestId('mcp-panel-retry')).toBeNull();
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
      expect(api.listMyMcpConnections).toHaveBeenCalledWith(WS, signal);
    });

    it('keeps Your connections visible with its empty state when nothing is connected', async () => {
      api.getMcpMemberStatus.mockResolvedValue(
        memberStatus({ enabled: false, role: 'guest', eligible: false, ineligible_reason: 'guest_not_allowed' })
      );
      api.listMyMcpConnections.mockResolvedValue([]);
      render(<McpPanel workspaceId={WS} />);

      await expectTurnedOff();
      expect(await screen.findByTestId('mcp-my-connections-empty')).toBeTruthy();
      // Turned off for everyone: the account's own ineligibility is beside the point.
      expect(screen.queryByTestId('mcp-panel-ineligible')).toBeNull();
      // The summary loaded with the list, but it is for accounts that may connect apps.
      expect(api.listMyMcpConnectionsAcrossWorkspaces).toHaveBeenCalled();
      expect(screen.queryByTestId('mcp-all-connections-summary')).toBeNull();
    });

    it('shows a failed list of the member’s connections with Retry while they are off', async () => {
      api.getMcpMemberStatus.mockResolvedValue(memberStatus({ enabled: false }));
      api.listMyMcpConnections
        .mockRejectedValueOnce(new McpApiError({ status: 503, reason: 'temporarily_unavailable' }))
        .mockResolvedValue([myClaude]);
      render(<McpPanel workspaceId={WS} />);

      await expectTurnedOff();
      expect(await screen.findByTestId('mcp-my-connections-error')).toBeTruthy();
      expect(screen.queryByTestId('mcp-my-connections-empty')).toBeNull();

      fireEvent.click(screen.getByTestId('mcp-my-connections-error-retry'));
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
    });

    it('loads no owner lists for an owner and drops the Settings menu badge', async () => {
      function Badge() {
        const count = useMcpPendingRequestCount(WS, true);

        return <span data-testid='badge'>{count ?? 'none'}</span>;
      }

      api.getMcpMemberStatus.mockResolvedValue(ownerStatus());
      api.listMcpAccessRequests.mockResolvedValueOnce([cursorRequest, vscodeRequest]);
      render(<Badge />);
      await waitFor(() => expect(text('badge')).toBe('2'));
      api.listMcpAccessRequests.mockClear();

      api.getMcpMemberStatus.mockResolvedValue({ ...ownerStatus(), enabled: false });
      render(<McpPanel workspaceId={WS} />);

      await expectTurnedOff();
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
      await waitFor(() => expect(text('badge')).toBe('none'));
      expect(api.getMcpWorkspaceSettings).not.toHaveBeenCalled();
      expect(api.listMcpAccessRequests).not.toHaveBeenCalled();
      expect(api.listMcpWorkspaceConnections).not.toHaveBeenCalled();
    });

    it('switches an owner to the notice when an owner action finds them turned off', async () => {
      api.approveMcpClient.mockRejectedValue(mcpDisabled());
      await renderOwnerPanel();
      api.getMcpMemberStatus.mockResolvedValue({ ...ownerStatus(), enabled: false });

      fireEvent.click(screen.getByTestId('mcp-approve-request-0'));

      await expectTurnedOff();
      expect(notify.error).toHaveBeenCalledWith(`That didn't work. ${TURNED_OFF}`);
      expect(api.getMcpMemberStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('mcp-my-connection-row')).toBeTruthy();
    });

    it('switches an owner to the notice when an owner list finds them turned off', async () => {
      api.getMcpMemberStatus
        .mockResolvedValueOnce(ownerStatus())
        .mockResolvedValue({ ...ownerStatus(), enabled: false });
      api.listMcpWorkspaceConnections.mockRejectedValue(mcpDisabled());
      render(<McpPanel workspaceId={WS} />);

      await expectTurnedOff();
      expect(api.getMcpMemberStatus).toHaveBeenCalledTimes(2);
      expect(await screen.findByTestId('mcp-my-connection-row')).toBeTruthy();
    });
  });
});
