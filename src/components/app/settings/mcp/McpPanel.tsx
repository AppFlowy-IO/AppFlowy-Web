import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isMcpAppApprovalKey,
  type McpApprovalMode,
  type McpApprovedApp,
  type McpMemberStatus,
  type McpMyConnection,
} from '@/application/services/domains/mcp';
import { McpSetupGuide } from '@/components/mcp/McpSetupGuide';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { TooltipGroupProvider } from '@/components/ui/tooltip';

import { mcpClientName, mcpErrorText, RAW_INTERPOLATION } from './format';
import { McpMyConnections } from './McpMyConnections';
import {
  EmptyState,
  McpPanelContainerContext,
  Notice,
  PanelClientIdentity,
  PanelSection,
  ROW_CLASS,
  RowList,
} from './McpPanelParts';
import { McpWorkspaceAccess } from './McpWorkspaceAccess';
import { publishMcpPendingRequestCount } from './pendingRequestCount';
import { useMcpConnectionsOverview } from './useMcpConnectionsOverview';
import { useMcpGovernance } from './useMcpGovernance';
import { useMcpMemberStatus } from './useMcpMemberStatus';
import { useMyMcpConnections } from './useMyMcpConnections';

export interface McpPanelProps {
  workspaceId: string;
}

/**
 * Settings > MCP, rendered lazily with `key={workspaceId}`: how to connect
 * AI apps through the MCP server, the caller's own connections and, for
 * owners, which apps members may connect. See doc/MCP.md.
 *
 * Everything shown is gated on the member status: unreachable service, AI app
 * connections turned off for the server, ineligible account (email gate or
 * guest), member, or owner. The caller's own connections load alongside it;
 * the owner lists wait for it, since only owners may read them.
 */
export default function McpPanel({ workspaceId }: McpPanelProps) {
  const { t } = useTranslation();
  // Tooltips render here so they stay inside the Settings dialog.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const member = useMcpMemberStatus(workspaceId);
  const { status, disabled } = member;
  // While AI apps are turned off the panel offers only the caller's own connections, so the
  // owner lists stay unloaded (approving, for one, is refused then).
  const isOwner = !disabled && status?.eligible === true && status.role === 'owner';
  // The caller's own connections and their cross-workspace summary need nothing from the member
  // status, so they load alongside it instead of a round trip after it. A failed status (other
  // than AI apps turned off) shows neither and pauses them; its Retry loads them again.
  const loadOwnConnections = !member.failed || disabled;
  // Own connections stay listed for ineligible accounts and while AI apps are turned off:
  // revoking must remain possible.
  const mine = useMyMcpConnections(workspaceId, loadOwnConnections);
  // An ineligible account sees Your connections only when it has some to revoke, or once loading
  // them failed: the error and its Retry must show, and the section stays through the Retry.
  const [mineFailedOnce, setMineFailedOnce] = useState(false);

  if (mine.failed && !mineFailedOnce) setMineFailedOnce(true);

  const connectionsOverview = useMcpConnectionsOverview(loadOwnConnections);
  const { reload: reloadOverview } = connectionsOverview;
  // The cross-workspace summary is only for accounts that may connect apps.
  const overview = status?.eligible === true ? connectionsOverview.overview : undefined;
  const { reload: reloadMine } = mine;
  const reloadMyConnections = useCallback(() => {
    void reloadMine();
    void reloadOverview();
  }, [reloadMine, reloadOverview]);
  const governance = useMcpGovernance(workspaceId, {
    enabled: isOwner,
    onAccessLost: member.reload,
    onConnectionsChanged: reloadMyConnections,
  });
  const { disconnect: disconnectMine } = mine;
  const reloadMemberConnections = governance.connections.reload;

  useEffect(() => {
    // Requests cannot be approved while AI apps are turned off; the menu badge goes.
    if (disabled) publishMcpPendingRequestCount(workspaceId, undefined);
  }, [disabled, workspaceId]);

  const handleDisconnectMine = useCallback(
    async (connection: McpMyConnection) => {
      const success = await disconnectMine(connection);

      if (success) void reloadOverview();
      // The owner's own connection is also listed under member connections.
      if (success && isOwner) void reloadMemberConnections();
      return success;
    },
    [disconnectMine, isOwner, reloadMemberConnections, reloadOverview]
  );

  let body: ReactNode;

  if (disabled) {
    // Nothing can connect; the caller's own connections stay so they can still be removed.
    body = (
      <div className='flex flex-col gap-8'>
        <DisabledNotice />
        <McpMyConnections state={mine} onDisconnect={handleDisconnectMine} overview={overview} />
      </div>
    );
  } else if (member.failed) {
    body = member.unavailable ? (
      <PanelFailure
        title={t('settings.mcp.unavailableTitle')}
        description={t('settings.mcp.unavailableDescription')}
        loading={member.loading}
        onRetry={member.reload}
        testId='mcp-panel-unavailable'
      />
    ) : (
      <PanelFailure
        title={t('settings.mcp.loadFailed')}
        description={mcpErrorText(member.error, t)}
        loading={member.loading}
        onRetry={member.reload}
        testId='mcp-panel-error'
      />
    );
  } else if (!status) {
    body = (
      <div
        role='status'
        aria-label={t('settings.mcp.loading')}
        className='flex justify-center py-12'
        data-testid='mcp-panel-loading'
      >
        <Progress variant='primary' />
      </div>
    );
  } else if (!status.eligible) {
    body = (
      <div className='flex flex-col gap-8'>
        <IneligibleNotice status={status} />
        {(mine.connections.length > 0 || mineFailedOnce) && (
          <McpMyConnections state={mine} onDisconnect={handleDisconnectMine} />
        )}
      </div>
    );
  } else {
    body = (
      <div className='flex flex-col gap-8'>
        <PanelSection
          title={t('settings.mcp.connectTitle')}
          description={t('settings.mcp.connectDescription')}
          testId='mcp-connect-section'
        >
          {status.requires_approval && status.role === 'member' && (
            <Notice testId='mcp-approval-notice'>
              {/* Verified web apps connect without approval in this mode; members should not request them. */}
              {status.approval_mode === 'verified_and_approved'
                ? t('settings.mcp.approvalNoticeVerified')
                : t('settings.mcp.approvalNotice')}
            </Notice>
          )}
          {/* "Connected apps (N)" and the cards' Connected badges come from the caller's connections. */}
          <McpSetupGuide serverUrl={status.endpoint} connections={mine.loaded ? mine.connections : undefined} />
        </PanelSection>
        <McpMyConnections state={mine} onDisconnect={handleDisconnectMine} overview={overview} />
        {/* Owners manage approvals below; members see what connects without a request. */}
        {!isOwner && status.requires_approval && status.approved_apps && (
          <ApprovedForWorkspace apps={status.approved_apps} mode={status.approval_mode} />
        )}
        {isOwner && <McpWorkspaceAccess governance={governance} />}
      </div>
    );
  }

  return (
    <div
      className='flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
      data-testid='mcp-panel'
      data-workspace-id={workspaceId}
      ref={setContainer}
    >
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>{t('settings.mcp.title')}</h2>
        <p className='mt-1 text-sm text-text-secondary'>{t('settings.mcp.description')}</p>
      </div>
      <McpPanelContainerContext.Provider value={container}>
        {/* One provider for the time and "Not verified" tooltips of every row. */}
        <TooltipGroupProvider>
          <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-6'>{body}</div>
        </TooltipGroupProvider>
      </McpPanelContainerContext.Provider>
    </div>
  );
}

/**
 * A member's read-only list of the apps owners approved here (names only, no
 * approvers). Under `verified_and_approved` an empty list does not mean every
 * app needs a request: verified web apps connect without one.
 */
function ApprovedForWorkspace({ apps, mode }: { apps: readonly McpApprovedApp[]; mode?: McpApprovalMode }) {
  const { t } = useTranslation();

  return (
    <PanelSection
      title={t('settings.mcp.approvedForWorkspaceTitle')}
      description={t('settings.mcp.approvedForWorkspaceDescription')}
      testId='mcp-approved-for-workspace'
    >
      {apps.length === 0 ? (
        <EmptyState testId='mcp-approved-for-workspace-empty'>
          {mode === 'verified_and_approved'
            ? t('settings.mcp.approvedForWorkspaceEmptyVerified')
            : t('settings.mcp.approvedForWorkspaceEmpty')}
        </EmptyState>
      ) : (
        <RowList>
          {apps.map((app) => (
            <li
              key={app.approval_key}
              className={ROW_CLASS}
              data-testid='mcp-approved-app-row'
              data-client-id={app.client_id}
              data-approval-key={app.approval_key}
            >
              <PanelClientIdentity client={app} className='flex-1'>
                {isMcpAppApprovalKey(app.approval_key) && (
                  <span className='text-xs text-text-secondary' data-testid='mcp-approved-app-scope'>
                    {t('settings.mcp.allInstalls', { name: mcpClientName(app, t), ...RAW_INTERPOLATION })}
                  </span>
                )}
              </PanelClientIdentity>
            </li>
          ))}
        </RowList>
      )}
    </PanelSection>
  );
}

/** AI app connections are turned off for the whole server (Admin → AI apps (MCP), or the deployment). */
function DisabledNotice() {
  const { t } = useTranslation();

  return (
    <div
      role='status'
      className='flex flex-col gap-1 rounded-400 border border-border-primary p-5'
      data-testid='mcp-panel-disabled'
    >
      <h3 className='text-base font-semibold text-text-primary'>{t('settings.mcp.disabledTitle')}</h3>
      <p className='text-sm text-text-secondary'>{t('settings.mcp.disabledDescription')}</p>
    </div>
  );
}

function IneligibleNotice({ status }: { status: McpMemberStatus }) {
  const { t } = useTranslation();
  const reason = status.ineligible_reason ?? (status.role === 'guest' ? 'guest_not_allowed' : null);

  return (
    <div
      role='status'
      className='flex flex-col gap-1 rounded-400 border border-border-primary p-5'
      data-testid='mcp-panel-ineligible'
      data-reason={reason ?? undefined}
    >
      <h3 className='text-base font-semibold text-text-primary'>{t('settings.mcp.ineligibleTitle')}</h3>
      {reason && <p className='text-sm text-text-secondary'>{t(`settings.mcp.ineligible_${reason}`)}</p>}
    </div>
  );
}

/** The member status could not be loaded: what went wrong, with Retry. */
function PanelFailure({
  title,
  description,
  loading,
  onRetry,
  testId,
}: {
  title: string;
  description: string;
  loading: boolean;
  onRetry: () => Promise<void>;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role='alert'
      className='flex flex-col items-start gap-3 rounded-400 border border-border-primary p-5'
      data-testid={testId}
    >
      <h3 className='text-base font-semibold text-text-primary'>{title}</h3>
      <p className='text-sm text-text-secondary'>{description}</p>
      <Button variant='outline' loading={loading} onClick={() => void onRetry()} data-testid='mcp-panel-retry'>
        {t('settings.mcp.retry')}
      </Button>
    </div>
  );
}
