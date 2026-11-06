import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import * as McpService from '@/application/services/domains/mcp';
import type {
  McpAccessRequest,
  McpApprovedClient,
  McpWorkspaceConnection,
  McpWorkspaceSettings,
} from '@/application/services/domains/mcp';
import { notify } from '@/components/_shared/notify';

import { isMcpAccessLost, mcpApprovalCovers, mcpConnectionKey, mcpDisconnectRemoves } from './format';
import { publishMcpPendingRequestCount } from './pendingRequestCount';
import { type McpResource, useMcpAction, useMcpResource } from './useMcpRequest';

/**
 * The owner action in flight. `id` names its target: the client ID or app key being
 * approved, a request's or an approval's key, or a member connection (`mcpMemberConnectionId`).
 */
export type McpGovernanceAction =
  | { kind: 'approve'; id: string }
  | { kind: 'dismiss'; id: string }
  | { kind: 'revoke'; id: string }
  | { kind: 'disconnect'; id: string }
  | { kind: 'disconnectAll' };

export interface UseMcpGovernanceOptions {
  /** Load only for workspace owners. */
  enabled: boolean;
  /**
   * An owner endpoint answered that the caller is no longer an owner, a member
   * or allowed by the email gate; the member status should be reloaded.
   */
  onAccessLost?: () => void;
  /** Member connections were removed (the caller's own may be among them). */
  onConnectionsChanged?: () => void;
}

export interface McpGovernanceState {
  /** Approval policy and approved apps. */
  settings: McpResource<McpWorkspaceSettings>;
  /** Pending approval requests, most recent first. */
  requests: McpResource<McpAccessRequest[]>;
  /** Every member's live connection, one per device. */
  connections: McpResource<McpWorkspaceConnection[]>;
  pending: McpGovernanceAction | undefined;
  /**
   * Approves `target`: a client ID (as its app when the catalog recognizes
   * it), or an `app:<app_id>` key that approves every registration of the
   * app. This also clears its pending request, `requestKey` when approving
   * from one.
   */
  approve: (target: string, requestKey?: string) => Promise<boolean>;
  /** Dismisses the request with this `approval_key`. */
  dismiss: (requestKey: string) => Promise<boolean>;
  /** Revokes an approval, which disconnects every member using what it covered. */
  revoke: (approval: McpApprovedClient) => Promise<boolean>;
  /** Disconnects one member connection (one device), or all of a member's connections with a legacy client. */
  disconnectMember: (connection: McpWorkspaceConnection) => Promise<boolean>;
  /** Disconnects every member's AI app connections in the workspace. */
  disconnectAll: () => Promise<boolean>;
}

/** The pending-action id of one member connection. */
function mcpMemberConnectionId(connection: McpWorkspaceConnection): string {
  return `${connection.user_uuid}:${mcpConnectionKey(connection)}`;
}

async function reportAccessLost<T>(request: Promise<T>, onAccessLost?: () => void): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isMcpAccessLost(error)) onAccessLost?.();
    throw error;
  }
}

/** Owner governance of AI apps in a workspace: requests, approvals and member connections. */
export function useMcpGovernance(
  workspaceId: string,
  { enabled, onAccessLost, onConnectionsChanged }: UseMcpGovernanceOptions
): McpGovernanceState {
  const { t } = useTranslation();

  const loadSettings = useCallback(
    (signal: AbortSignal) => reportAccessLost(McpService.getMcpWorkspaceSettings(workspaceId, { signal }), onAccessLost),
    [workspaceId, onAccessLost]
  );
  const loadRequests = useCallback(
    (signal: AbortSignal) => reportAccessLost(McpService.listMcpAccessRequests(workspaceId, { signal }), onAccessLost),
    [workspaceId, onAccessLost]
  );
  const loadConnections = useCallback(
    (signal: AbortSignal) =>
      reportAccessLost(McpService.listMcpWorkspaceConnections(workspaceId, { signal }), onAccessLost),
    [workspaceId, onAccessLost]
  );
  const settings = useMcpResource(loadSettings, enabled);
  const requests = useMcpResource(loadRequests, enabled);
  const connections = useMcpResource(loadConnections, enabled);
  const { pending, run } = useMcpAction<McpGovernanceAction>();
  const { update: updateSettings, reload: reloadSettings } = settings;
  const { data: requestList, update: updateRequests, reload: reloadRequests } = requests;
  const { update: updateConnections, reload: reloadConnections } = connections;

  // The Settings menu badge follows the list the owner sees.
  useEffect(() => {
    if (requestList) publishMcpPendingRequestCount(workspaceId, requestList.length);
  }, [requestList, workspaceId]);

  const onError = useCallback(
    (error: unknown) => {
      if (isMcpAccessLost(error)) onAccessLost?.();
    },
    [onAccessLost]
  );

  const approve = useCallback(
    (target: string, requestKey?: string) =>
      run(
        { kind: 'approve', id: target },
        (signal) => McpService.approveMcpClient(workspaceId, target, { signal }),
        () => {
          notify.success(t('settings.mcp.approved'));
          // The request filed under the approved key; a client ID also clears its own request.
          updateRequests((current) =>
            current?.filter((request) => request.approval_key !== (requestKey ?? target) && request.client_id !== target)
          );
          void reloadSettings();
          void reloadRequests();
        },
        onError
      ),
    [run, workspaceId, t, updateRequests, reloadSettings, reloadRequests, onError]
  );

  const dismiss = useCallback(
    (requestKey: string) =>
      run(
        { kind: 'dismiss', id: requestKey },
        (signal) => McpService.dismissMcpAccessRequest(workspaceId, requestKey, { signal }),
        () => {
          updateRequests((current) => current?.filter((request) => request.approval_key !== requestKey));
          void reloadRequests();
        },
        onError
      ),
    [run, workspaceId, updateRequests, reloadRequests, onError]
  );

  const revoke = useCallback(
    (approval: McpApprovedClient) =>
      run(
        { kind: 'revoke', id: approval.approval_key },
        (signal) => McpService.revokeMcpClientApproval(workspaceId, approval.approval_key, { signal }),
        () => {
          updateSettings(
            (current) =>
              current && {
                ...current,
                approved_clients: current.approved_clients.filter(
                  (client) => client.approval_key !== approval.approval_key
                ),
              }
          );
          updateConnections((current) => current?.filter((connection) => !mcpApprovalCovers(approval, connection)));
          void reloadSettings();
          void reloadConnections();
          onConnectionsChanged?.();
        },
        onError
      ),
    [
      run,
      workspaceId,
      updateSettings,
      updateConnections,
      reloadSettings,
      reloadConnections,
      onConnectionsChanged,
      onError,
    ]
  );

  const disconnectMember = useCallback(
    (target: McpWorkspaceConnection) =>
      run(
        { kind: 'disconnect', id: mcpMemberConnectionId(target) },
        (signal) =>
          McpService.disconnectMcpWorkspaceConnections(
            workspaceId,
            { clientId: target.client_id, userUuid: target.user_uuid, familyId: target.family_id },
            { signal }
          ),
        () => {
          notify.success(t('settings.mcp.disconnected'));
          updateConnections((current) => current?.filter((connection) => !mcpDisconnectRemoves(target, connection)));
          void reloadConnections();
          onConnectionsChanged?.();
        },
        onError
      ),
    [run, workspaceId, t, updateConnections, reloadConnections, onConnectionsChanged, onError]
  );

  const disconnectAll = useCallback(
    () =>
      run(
        { kind: 'disconnectAll' },
        (signal) => McpService.disconnectAllMcpWorkspaceConnections(workspaceId, { signal }),
        ({ disconnected }) => {
          notify.success(t('settings.mcp.disconnectedAll', { count: disconnected }));
          updateConnections(() => []);
          void reloadConnections();
          onConnectionsChanged?.();
        },
        onError
      ),
    [run, workspaceId, t, updateConnections, reloadConnections, onConnectionsChanged, onError]
  );

  return {
    settings,
    requests,
    connections,
    pending,
    approve,
    dismiss,
    revoke,
    disconnectMember,
    disconnectAll,
  };
}
