import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isMcpAppApprovalKey,
  type McpApprovalMode,
  type McpApprovedApp,
  type McpMemberStatus,
  type McpMyConnection,
} from '@/application/services/domains/mcp';
import { ReactComponent as ArrowRightIcon } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/info_colored.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { McpSetupGuide } from '@/components/mcp/McpSetupGuide';
import { RAW_INTERPOLATION } from '@/components/mcp/rawInterpolation';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipGroupProvider } from '@/components/ui/tooltip';

import { mcpClientName, mcpErrorText } from './format';
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
import { mcpManagesApprovals, publishMcpPendingRequestCount } from './pendingRequestCount';
import { useMcpConnectionsOverview } from './useMcpConnectionsOverview';
import { useMcpGovernance } from './useMcpGovernance';
import { useMcpMemberStatus } from './useMcpMemberStatus';
import { useMyMcpConnections } from './useMyMcpConnections';

export interface McpPanelProps {
  workspaceId: string;
  /** Shows Settings > Connections; without it, Connect AI apps does not point there. */
  onOpenConnections?: () => void;
}

type McpPanelTab = 'connect' | 'manage';

/** Tab buttons as in Settings > People (Figma Tab button), with the hover fill. */
const TAB_TRIGGER_CLASS =
  'h-8 min-w-0 items-center gap-1.5 rounded-300 px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-fill-content-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick data-[state=active]:bg-fill-content-hover data-[state=active]:text-text-primary data-[state=active]:after:hidden';

/**
 * Settings > MCP, rendered lazily with `key={workspaceId}`, in two tabs: Connect
 * AI apps (how to connect them through the MCP server) and Manage AI apps (the
 * caller's own connections and, for owners, which apps members may connect,
 * with a count of pending approval requests on the tab). See doc/MCP.md.
 *
 * Everything shown is gated on the member status: unreachable service, AI app
 * connections turned off for the server, ineligible account (email gate or
 * guest), member, or owner. The caller's own connections load alongside it;
 * the owner lists wait for it, since only owners may read them.
 */
export default function McpPanel({ workspaceId, onOpenConnections }: McpPanelProps) {
  const { t } = useTranslation();
  // Tooltips render here so they stay inside the Settings dialog.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<McpPanelTab>('connect');
  const member = useMcpMemberStatus(workspaceId);
  const { status, disabled } = member;
  // While AI apps are turned off, and for an owner the email gate excludes, the panel offers only
  // the caller's own connections, so the owner lists stay unloaded (approving, for one, is refused
  // then). The server would let such owners withdraw access; doc/MCP.md lists that as not in v1.
  const isOwner = !disabled && mcpManagesApprovals(status);
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
  // The menu badge's count, on the tab that holds the requests.
  const pendingRequests = isOwner ? governance.requests.data?.length ?? 0 : 0;

  // Requests cannot be answered while AI apps are turned off, and the panel shows them only to a
  // caller who manages AI apps here (`mcpManagesApprovals`, the menu's rule too): not to an owner
  // the email gate excludes, nor to one the MCP service now lists as a member. The badge goes.
  const clearsBadge = disabled || (status !== undefined && !member.failed && !isOwner);

  useEffect(() => {
    if (clearsBadge) publishMcpPendingRequestCount(workspaceId, undefined);
  }, [clearsBadge, workspaceId]);

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
      <div className='flex flex-col gap-5'>
        <DisabledNotice />
        <McpMyConnections state={mine} onDisconnect={handleDisconnectMine} overview={overview} />
      </div>
    );
  } else if (member.failed) {
    body = member.unavailable ? (
      <PanelFailure
        title={t('settings.mcp.unavailableTitle')}
        description={t('settings.mcp.unavailableDescription')}
        onRetry={member.reload}
        testId='mcp-panel-unavailable'
      />
    ) : (
      <PanelFailure
        title={t('settings.mcp.loadFailed')}
        description={mcpErrorText(member.error, t)}
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
      <div className='flex flex-col gap-5'>
        <IneligibleNotice status={status} />
        {(mine.connections.length > 0 || mineFailedOnce) && (
          <McpMyConnections state={mine} onDisconnect={handleDisconnectMine} />
        )}
      </div>
    );
  } else {
    // Both tabs stay mounted, so switching keeps an expanded card, a typed client ID and open
    // confirmations. The `hidden` attribute hides the inactive one: no display class on TabsContent.
    body = (
      <Tabs value={tab} onValueChange={(value) => setTab(value as McpPanelTab)} className='gap-5'>
        <TabsList className='gap-1.5' data-testid='mcp-tabs'>
          <TabsTrigger value='connect' className={TAB_TRIGGER_CLASS} data-testid='mcp-tab-connect'>
            {t('settings.mcp.connectTab')}
          </TabsTrigger>
          <TabsTrigger value='manage' className={TAB_TRIGGER_CLASS} data-testid='mcp-tab-manage'>
            {t('settings.mcp.manageTab')}
            {pendingRequests > 0 && (
              <>
                <span
                  aria-hidden='true'
                  className='inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-fill-theme-thick px-1.5 text-xs font-medium text-text-on-fill'
                  data-testid='mcp-tab-manage-badge'
                >
                  {pendingRequests > 99 ? '99+' : pendingRequests}
                </span>
                <span className='sr-only'>{t('settings.mcp.pendingRequestsBadge', { count: pendingRequests })}</span>
              </>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='connect' forceMount hidden={tab !== 'connect'} data-testid='mcp-tab-panel-connect'>
          <div className='flex flex-col gap-5'>
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
              {/* The cards' Connected badges come from the caller's connections. */}
              <McpSetupGuide serverUrl={status.endpoint} connections={mine.loaded ? mine.connections : undefined} />
            </PanelSection>
            {onOpenConnections && (
              // AI apps use AppFlowy here; Connections brings other services into AppFlowy.
              <p className='text-sm text-text-secondary' data-testid='mcp-connections-hint'>
                {t('settings.mcp.connectionsHint')}{' '}
                <button
                  type='button'
                  onClick={onOpenConnections}
                  className='inline-flex items-center gap-0.5 rounded-100 align-bottom font-medium text-text-action hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
                  data-testid='mcp-open-connections'
                >
                  {t('settings.connections.menuLabel')}
                  <ArrowRightIcon aria-hidden='true' className='h-5 w-5' />
                </button>
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent value='manage' forceMount hidden={tab !== 'manage'} data-testid='mcp-tab-panel-manage'>
          <div className='flex flex-col gap-5 divide-y divide-border-primary [&>:not(:first-child)]:pt-5'>
            <McpMyConnections state={mine} onDisconnect={handleDisconnectMine} overview={overview} />
            {/* Owners manage approvals below; members see what connects without a request. */}
            {!isOwner && status.requires_approval && (
              <ApprovedForWorkspace apps={status.approved_apps} mode={status.approval_mode} />
            )}
            {isOwner && <McpWorkspaceAccess governance={governance} />}
          </div>
        </TabsContent>
      </Tabs>
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
                  <span className='text-xs leading-[18px] text-text-secondary' data-testid='mcp-approved-app-scope'>
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
      className='flex items-start gap-3 rounded-400 bg-fill-warning-light py-4 pl-4 pr-3'
      data-testid='mcp-panel-disabled'
    >
      <WarningIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-warning-thick' />
      <div className='flex min-w-0 flex-col gap-1'>
        <h3 className='text-sm font-medium text-text-primary'>{t('settings.mcp.disabledTitle')}</h3>
        <p className='text-sm text-text-primary'>{t('settings.mcp.disabledDescription')}</p>
      </div>
    </div>
  );
}

function IneligibleNotice({ status }: { status: McpMemberStatus }) {
  const { t } = useTranslation();
  const reason = status.ineligible_reason ?? (status.role === 'guest' ? 'guest_not_allowed' : null);

  return (
    <div
      role='status'
      className='flex items-start gap-3 rounded-400 bg-fill-info-light py-4 pl-4 pr-3'
      data-testid='mcp-panel-ineligible'
      data-reason={reason ?? undefined}
    >
      <InfoIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-info-thick' />
      <div className='flex min-w-0 flex-col gap-1'>
        <h3 className='text-sm font-medium text-text-primary'>{t('settings.mcp.ineligibleTitle')}</h3>
        {reason && <p className='text-sm text-text-primary'>{t(`settings.mcp.ineligible_${reason}`)}</p>}
      </div>
    </div>
  );
}

/**
 * The member status could not be loaded: what went wrong, with Retry. Retry clears the failure as
 * the reload starts, so the panel's spinner, not this, shows while it runs.
 */
function PanelFailure({
  title,
  description,
  onRetry,
  testId,
}: {
  title: string;
  description: string;
  onRetry: () => Promise<void>;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role='alert'
      className='flex items-start gap-2 rounded-400 bg-fill-error-light py-3 pl-4 pr-3'
      data-testid={testId}
    >
      <div className='flex min-w-0 flex-1 items-start gap-3 py-1'>
        <ErrorIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-error-thick' />
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <h3 className='text-sm font-medium text-text-primary'>{title}</h3>
          <p className='text-sm text-text-primary'>{description}</p>
        </div>
      </div>
      <Button variant='destructive' size='sm' onClick={() => void onRetry()} data-testid='mcp-panel-retry'>
        {t('settings.mcp.retry')}
      </Button>
    </div>
  );
}
