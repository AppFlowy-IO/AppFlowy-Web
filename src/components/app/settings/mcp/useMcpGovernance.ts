import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import * as McpService from '@/application/services/domains/mcp';
import type {
  McpAccessRequest,
  McpApprovalMode,
  McpApprovedClient,
  McpWorkspaceConnection,
  McpWorkspaceSettings,
} from '@/application/services/domains/mcp';
import { notify } from '@/components/_shared/notify';

import { isMcpAccessLost, mcpApprovalCovers, mcpClientNames, mcpConnectionKey, RAW_INTERPOLATION } from './format';
import { publishMcpPendingRequestCount } from './pendingRequestCount';
import { type McpResource, useMcpAction, useMcpResource } from './useMcpRequest';

/**
 * The owner action in flight. `id` names its target: the approval mode, the
 * client ID being approved, a request's or an approval's key, or a member
 * connection (`mcpMemberConnectionId`).
 */
export type McpGovernanceAction =
  | { kind: 'settings'; id: McpApprovalMode }
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
   * Sets the approval policy (no confirmation). A stricter policy toasts the
   * apps the server approved so members keep working.
   */
  setApprovalMode: (mode: McpApprovalMode) => Promise<boolean>;
  /**
   * Approves a client (as its app when the catalog recognizes it); this also
   * clears its pending request, `requestKey` when approving from one.
   */
  approve: (clientId: string, requestKey?: string) => Promise<boolean>;
  /** Dismisses the request with this `mcpApprovalKey`. */
  dismiss: (requestKey: string) => Promise<boolean>;
  /** Revokes an approval, which disconnects every member using what it covered. */
  revoke: (approval: McpApprovedClient) => Promise<boolean>;
  /** Disconnects one member connection (one device), or all of a member's connections with a legacy client. */
  disconnectMember: (connection: McpWorkspaceConnection) => Promise<boolean>;
  /** Disconnects every member's AI app connections in the workspace. */
  disconnectAll: () => Promise<boolean>;
}

/** The pending-action id of one member connection. */
export function mcpMemberConnectionId(connection: McpWorkspaceConnection): string {
  return `${connection.user_uuid}:${mcpConnectionKey(connection)}`;
}

/** Whether `connection` goes when the owner disconnects `target`. */
function removedWith(target: McpWorkspaceConnection, connection: McpWorkspaceConnection): boolean {
  if (connection.client_id !== target.client_id || connection.user_uuid !== target.user_uuid) return false;
  // Without a family, the server disconnects every connection of the member with the client.
  return !target.family_id || mcpConnectionKey(connection) === mcpConnectionKey(target);
}

async function reportAccessLost<T>(request: Promise<T>, onAccessLost?: () => void): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isMcpAccessLost(error)) onAccessLost?.();
    throw error;
  }
}

/** Owner governance of AI apps in a workspace: approval policy, requests, approvals and member connections. */
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

  const setApprovalMode = useCallback(
    (mode: McpApprovalMode) =>
      run(
        { kind: 'settings', id: mode },
        (signal) => McpService.updateMcpWorkspaceSettings(workspaceId, mode, { signal }),
        ({ auto_approved_clients: autoApproved, ...result }) => {
          // Keep the loaded approved apps: they carry the resolved names and logos.
          updateSettings((current) => (current ? { ...result, approved_clients: current.approved_clients } : result));
          if (autoApproved.length === 0) return;

          // The stricter policy approved the apps members were using; the list now includes them.
          notify.success(
            t('settings.mcp.autoApproved', {
              count: autoApproved.length,
              names: mcpClientNames(autoApproved, t),
              ...RAW_INTERPOLATION,
            })
          );
          void reloadSettings();
        },
        onError
      ),
    [run, workspaceId, updateSettings, reloadSettings, t, onError]
  );

  const approve = useCallback(
    (clientId: string, requestKey?: string) =>
      run(
        { kind: 'approve', id: clientId },
        (signal) => McpService.approveMcpClient(workspaceId, clientId, { signal }),
        () => {
          notify.success(t('settings.mcp.approved'));
          updateRequests((current) =>
            current?.filter(
              (request) =>
                request.client_id !== clientId && (!requestKey || McpService.mcpApprovalKey(request) !== requestKey)
            )
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
          updateRequests((current) => current?.filter((request) => McpService.mcpApprovalKey(request) !== requestKey));
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
          updateConnections((current) => current?.filter((connection) => !removedWith(target, connection)));
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
    setApprovalMode,
    approve,
    dismiss,
    revoke,
    disconnectMember,
    disconnectAll,
  };
}
