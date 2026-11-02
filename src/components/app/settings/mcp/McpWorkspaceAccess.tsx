import { ReactNode, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isMcpAppApprovalKey,
  MCP_APPROVAL_MODES,
  mcpApprovalKey,
  type McpApprovalMode,
  type McpApprovedClient,
  type McpClientSummary,
  type McpWorkspaceConnection,
} from '@/application/services/domains/mcp';
import { ReactComponent as ArrowRightIcon } from '@/assets/icons/alt_arrow_right_small.svg';
import { ConfirmModal } from '@/components/_shared/modal/ConfirmModal';
import { RAW_INTERPOLATION } from '@/components/mcp/rawInterpolation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import {
  groupMcpConnectionsByMember,
  isStricterMcpApprovalMode,
  mcpApprovalCovers,
  mcpClientName,
  mcpClientNames,
  mcpClientsKeptApproved,
  mcpConnectionKey,
  mcpDate,
  mcpDeviceLabel,
  mcpMemberLabel,
  mcpModeAdmitsWithoutApproval,
  mcpOthersKeepWorking,
  mcpRemainingAppApproval,
  mcpRequestedBy,
} from './format';
import {
  ConnectionDetails,
  DisconnectDescription,
  EmptyState,
  McpTime,
  PanelClientIdentity,
  PanelScopeBadge,
  PanelSection,
  ROW_CLASS,
  RowList,
  SectionError,
  SectionLoading,
  SubSection,
} from './McpPanelParts';
import type { McpGovernanceAction, McpGovernanceState } from './useMcpGovernance';

const NO_APPROVED_CLIENTS: McpApprovedClient[] = [];
const NO_CLIENTS: McpClientSummary[] = [];
/** The server's longest client ID (`MAX_CLIENT_ID_BYTES`, in bytes; the server still decides). */
const MAX_CLIENT_ID_LENGTH = 2048;

/** i18n keys of each approval policy option. */
const APPROVAL_MODE_TEXT = {
  verified_and_approved: {
    title: 'settings.mcp.approvalModeVerified',
    description: 'settings.mcp.approvalModeVerifiedDescription',
  },
  approved_only: {
    title: 'settings.mcp.approvalModeApproved',
    description: 'settings.mcp.approvalModeApprovedDescription',
  },
  any: { title: 'settings.mcp.approvalModeAny', description: 'settings.mcp.approvalModeAnyDescription' },
} as const;

/** What the open confirmation dialog asks about. */
type Confirmation =
  /** A policy that admits more apps without approval. */
  | { kind: 'loosen'; mode: McpApprovalMode }
  /** A stricter policy keeps `clients` approved (members are connected to them). */
  | { kind: 'tighten'; mode: McpApprovalMode; clients: McpClientSummary[] }
  | { kind: 'revoke'; approval: McpApprovedClient }
  | { kind: 'disconnect'; connection: McpWorkspaceConnection }
  | { kind: 'disconnectAll' };

function isPending(pending: McpGovernanceAction | undefined, kind: McpGovernanceAction['kind'], id?: string): boolean {
  return pending?.kind === kind && (id === undefined || ('id' in pending && pending.id === id));
}

/**
 * Owner-only "Workspace access": the approval policy, members' approval
 * requests, approved apps, every member's connections (by member, one row per
 * device), approval by client ID and disconnecting every AI app.
 */
export function McpWorkspaceAccess({ governance }: { governance: McpGovernanceState }) {
  const { t } = useTranslation();
  const {
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
  } = governance;
  const busy = Boolean(pending);
  // The confirmation outlives `confirmOpen` so a dialog keeps its text while it fades out.
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const approvedClients = settings.data?.approved_clients ?? NO_APPROVED_CLIENTS;
  const approvalMode = settings.data?.approval_mode;
  const memberGroups = useMemo(() => {
    let index = 0;

    // Row indexes run across groups in display order (`mcp-member-disconnect-{index}`).
    return groupMcpConnectionsByMember(connections.data ?? []).map((group) => ({
      ...group,
      rows: group.connections.map((connection) => ({ connection, index: index++ })),
    }));
  }, [connections.data]);

  const ask = (next: Confirmation) => {
    setConfirmation(next);
    setConfirmOpen(true);
  };

  const closeConfirmation = () => {
    if (!busy) setConfirmOpen(false);
  };

  const closeOnSuccess = (action: Promise<boolean>) => {
    void action.then((success) => {
      if (success) setConfirmOpen(false);
    });
  };

  const chooseMode = (mode: McpApprovalMode) => {
    if (!approvalMode || mode === approvalMode) return;
    if (!isStricterMcpApprovalMode(mode, approvalMode)) {
      ask({ kind: 'loosen', mode });
      return;
    }

    // A stricter policy keeps the apps members already use approved; name them first.
    // Unknown while member connections load or failed: the toast names what the server kept.
    const kept = mcpClientsKeptApproved(connections.data, approvedClients, mode, approvalMode);

    if (kept.length > 0) ask({ kind: 'tighten', mode, clients: kept });
    else void setApprovalMode(mode);
  };

  return (
    <PanelSection
      title={t('settings.mcp.workspaceAccessTitle')}
      description={t('settings.mcp.workspaceAccessDescription')}
      testId='mcp-workspace-access'
    >
      {/* The policy and the approved apps load together: one alert here when that fails, no list below. */}
      {settings.failed ? (
        <SectionError onRetry={() => void settings.reload()} testId='mcp-settings-error' />
      ) : !settings.data || !approvalMode ? (
        <SectionLoading />
      ) : (
        <ApprovalPolicy mode={approvalMode} disabled={busy} onChoose={chooseMode} />
      )}

      <SubSection title={t('settings.mcp.requestsTitle')} testId='mcp-access-requests'>
        {requests.failed ? (
          <SectionError onRetry={() => void requests.reload()} testId='mcp-access-requests-error' />
        ) : !requests.data ? (
          <SectionLoading />
        ) : requests.data.length === 0 ? (
          <EmptyState testId='mcp-access-requests-empty'>{t('settings.mcp.requestsEmpty')}</EmptyState>
        ) : (
          <RowList>
            {requests.data.map((request, index) => {
              const requestedBy = mcpRequestedBy(request.requesters, t);
              const requestKey = mcpApprovalKey(request);
              // A merged app request is approved by its app key, which needs no lookup of the
              // registration that asked last (a CIMD document can be unreachable by then).
              const approveTarget = isMcpAppApprovalKey(requestKey) ? requestKey : request.client_id;

              return (
                <li
                  key={requestKey}
                  className={ROW_CLASS}
                  data-testid='mcp-access-request-row'
                  data-client-id={request.client_id}
                >
                  <PanelClientIdentity client={request} className='flex-1'>
                    {isMcpAppApprovalKey(requestKey) && (
                      // Approving a recognized app approves it as an app.
                      <span className='text-xs text-text-secondary' data-testid='mcp-access-request-scope'>
                        {t('settings.mcp.approveCoversAllInstalls', {
                          name: mcpClientName(request, t),
                          ...RAW_INTERPOLATION,
                        })}
                      </span>
                    )}
                    {requestedBy && (
                      <span className='text-xs text-text-secondary' data-testid='mcp-access-request-requesters'>
                        {requestedBy}
                      </span>
                    )}
                    <McpTime value={request.last_requested_at} testId='mcp-access-request-time' />
                  </PanelClientIdentity>
                  <div className='flex shrink-0 items-center gap-2'>
                    <Button
                      size='sm'
                      disabled={busy}
                      loading={isPending(pending, 'approve', approveTarget)}
                      onClick={() => void approve(approveTarget, requestKey)}
                      data-testid={`mcp-approve-request-${index}`}
                    >
                      {t('settings.mcp.approve')}
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={busy}
                      loading={isPending(pending, 'dismiss', requestKey)}
                      onClick={() => void dismiss(requestKey)}
                      data-testid={`mcp-dismiss-request-${index}`}
                    >
                      {t('settings.mcp.dismiss')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </RowList>
        )}
      </SubSection>

      {!settings.failed && (
        <SubSection title={t('settings.mcp.approvedTitle')} testId='mcp-approved-clients'>
          {!settings.data ? (
            <SectionLoading />
          ) : approvedClients.length === 0 ? (
            <EmptyState testId='mcp-approved-clients-empty'>{t('settings.mcp.approvedEmpty')}</EmptyState>
          ) : (
            <RowList>
              {approvedClients.map((approval, index) => {
                const approver = approval.approved_by_name?.trim() || approval.approved_by_email?.trim();
                const appLevel = isMcpAppApprovalKey(approval.approval_key);
                // Without the member connection list, a count of 0 would be a guess.
                const count = connections.data?.filter((connection) => mcpApprovalCovers(approval, connection)).length;

                return (
                  <li
                    key={approval.approval_key}
                    className={ROW_CLASS}
                    data-testid='mcp-approved-client-row'
                    data-client-id={approval.client_id}
                    data-approval-key={approval.approval_key}
                  >
                    <PanelClientIdentity client={approval} className='flex-1'>
                      {appLevel && (
                        <span className='text-xs text-text-primary' data-testid='mcp-approved-client-scope'>
                          {t('settings.mcp.allInstalls', { name: mcpClientName(approval, t), ...RAW_INTERPOLATION })}
                        </span>
                      )}
                      <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-secondary'>
                        {approver && (
                          <span data-testid='mcp-approved-client-approver'>
                            {t('settings.mcp.approvedBy', { name: approver, ...RAW_INTERPOLATION })}
                          </span>
                        )}
                        {approver && mcpDate(approval.approved_at) && <span aria-hidden='true'>·</span>}
                        <McpTime value={approval.approved_at} testId='mcp-approved-client-time' />
                      </div>
                    </PanelClientIdentity>
                    <div className='flex shrink-0 items-center gap-3'>
                      {count !== undefined && (
                        <span className='text-xs text-text-secondary' data-testid='mcp-approved-client-connections'>
                          {t('settings.mcp.activeConnections', { count })}
                        </span>
                      )}
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={busy}
                        onClick={() => ask({ kind: 'revoke', approval })}
                        data-testid={`mcp-revoke-client-${index}`}
                      >
                        {t('settings.mcp.revoke')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </RowList>
          )}
        </SubSection>
      )}

      <SubSection title={t('settings.mcp.memberConnectionsTitle')} testId='mcp-member-connections'>
        {connections.failed ? (
          <SectionError onRetry={() => void connections.reload()} testId='mcp-member-connections-error' />
        ) : !connections.data ? (
          <SectionLoading />
        ) : connections.data.length === 0 ? (
          <EmptyState testId='mcp-member-connections-empty'>{t('settings.mcp.memberConnectionsEmpty')}</EmptyState>
        ) : (
          <RowList>
            {memberGroups.map(({ userUuid, member, rows }) => (
              <li
                key={userUuid}
                className='flex min-w-0 flex-col pb-1'
                data-testid='mcp-member-connection-group'
                data-user-uuid={userUuid}
              >
                <div className='flex min-w-0 items-center justify-between gap-4 px-4 pb-1 pt-3'>
                  <div className='flex min-w-0 flex-col gap-0.5'>
                    <span
                      className='truncate text-sm font-medium text-text-primary'
                      title={member.name}
                      data-testid='mcp-member-connection-member'
                    >
                      {member.name}
                    </span>
                    {member.email && (
                      <span
                        className='truncate text-xs text-text-secondary'
                        title={member.email}
                        data-testid='mcp-member-connection-email'
                      >
                        {member.email}
                      </span>
                    )}
                  </div>
                  <span
                    className='inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-border-primary bg-fill-content px-2 py-0.5 text-xs text-text-secondary'
                    data-testid='mcp-member-connection-count'
                  >
                    {t('settings.mcp.connectionCount', { count: rows.length })}
                  </span>
                </div>
                <ul className='flex min-w-0 flex-col'>
                  {rows.map(({ connection, index }) => (
                    <li
                      key={mcpConnectionKey(connection)}
                      className='flex min-w-0 items-center justify-between gap-4 py-2 pl-8 pr-4'
                      data-testid='mcp-member-connection-row'
                      data-client-id={connection.client_id}
                      data-user-uuid={connection.user_uuid}
                      data-family-id={connection.family_id ?? undefined}
                    >
                      <PanelClientIdentity client={connection} avatarSize='sm' className='flex-1'>
                        <ConnectionDetails connection={connection} testIdPrefix='mcp-member-connection' />
                      </PanelClientIdentity>
                      <div className='flex shrink-0 items-center gap-3'>
                        <PanelScopeBadge scope={connection.scope} />
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={busy}
                          onClick={() => ask({ kind: 'disconnect', connection })}
                          data-testid={`mcp-member-disconnect-${index}`}
                        >
                          {t('settings.mcp.disconnect')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </RowList>
        )}
      </SubSection>

      <ApproveById
        busy={busy}
        approvingClientId={pending?.kind === 'approve' ? pending.id : undefined}
        onApprove={approve}
      />

      <DisconnectAll
        // An empty list leaves nothing to disconnect; an unknown one (loading, failed) might not be empty.
        disabled={busy || connections.data?.length === 0}
        onDisconnectAll={() => ask({ kind: 'disconnectAll' })}
      />

      <p className='text-xs text-text-secondary' data-testid='mcp-propagation-note'>
        {t('settings.mcp.propagationNote')}
      </p>

      <PolicyDialogs
        confirmation={confirmation}
        open={confirmOpen}
        loading={isPending(pending, 'settings')}
        onClose={closeConfirmation}
        onConfirm={(mode) => closeOnSuccess(setApprovalMode(mode))}
      />

      <RevokeDialog
        approval={confirmation?.kind === 'revoke' ? confirmation.approval : undefined}
        approvals={approvedClients}
        mode={approvalMode}
        open={confirmOpen && confirmation?.kind === 'revoke'}
        loading={isPending(pending, 'revoke')}
        onClose={closeConfirmation}
        onConfirm={(approval) => closeOnSuccess(revoke(approval))}
      />

      <MemberDisconnectDialog
        connection={confirmation?.kind === 'disconnect' ? confirmation.connection : undefined}
        connections={connections.data}
        open={confirmOpen && confirmation?.kind === 'disconnect'}
        loading={isPending(pending, 'disconnect')}
        onClose={closeConfirmation}
        onConfirm={(connection) => closeOnSuccess(disconnectMember(connection))}
      />

      <ConfirmModal
        open={confirmOpen && confirmation?.kind === 'disconnectAll'}
        title={t('settings.mcp.disconnectAllTitle')}
        description={t('settings.mcp.disconnectAllConfirmDescription')}
        confirmText={t('settings.mcp.disconnectAllConfirm')}
        loading={isPending(pending, 'disconnectAll')}
        dialogTestId='mcp-disconnect-all-dialog'
        confirmTestId='mcp-confirm-disconnect-all'
        onClose={closeConfirmation}
        onConfirm={() => closeOnSuccess(disconnectAll())}
      />
    </PanelSection>
  );
}

/** One radio per approval policy, strictest last but "verified and approved" (the default) first. */
function ApprovalPolicy({
  mode,
  disabled,
  onChoose,
}: {
  mode: McpApprovalMode;
  disabled: boolean;
  onChoose: (mode: McpApprovalMode) => void;
}) {
  const { t } = useTranslation();
  const groupId = useId();

  return (
    <fieldset className='flex min-w-0 flex-col gap-2' disabled={disabled} data-testid='mcp-approval-mode'>
      <legend className='mb-2 text-sm font-medium text-text-primary'>{t('settings.mcp.approvalModeTitle')}</legend>
      {MCP_APPROVAL_MODES.map((option) => {
        const checked = option === mode;
        const descriptionId = `${groupId}-${option}`;

        return (
          <label
            key={option}
            className={cn(
              'flex min-w-0 items-start gap-3 rounded-400 border px-4 py-3 transition-colors',
              checked ? 'border-border-theme-thick bg-fill-theme-select' : 'border-border-primary',
              disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-fill-content-hover'
            )}
          >
            <input
              type='radio'
              name={groupId}
              value={option}
              checked={checked}
              onChange={() => onChoose(option)}
              aria-describedby={descriptionId}
              className='mt-0.5 h-4 w-4 shrink-0 accent-fill-theme-thick'
              data-testid={`mcp-approval-mode-${option}`}
            />
            <span className='flex min-w-0 flex-col gap-0.5'>
              <span className='flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary'>
                {t(APPROVAL_MODE_TEXT[option].title)}
                {option === 'verified_and_approved' && (
                  <span className='rounded-full border border-border-primary px-2 py-0.5 text-xs font-normal text-text-secondary'>
                    {t('settings.mcp.approvalModeRecommended')}
                  </span>
                )}
              </span>
              <span id={descriptionId} className='text-xs text-text-secondary'>
                {t(APPROVAL_MODE_TEXT[option].description)}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * Confirmations of a policy change. Loosening warns what members can now
 * connect; tightening names the apps the server keeps approved so members keep
 * working (only asked when there are any).
 */
function PolicyDialogs({
  confirmation,
  open,
  loading,
  onClose,
  onConfirm,
}: {
  confirmation: Confirmation | undefined;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: (mode: McpApprovalMode) => void;
}) {
  const { t } = useTranslation();
  const loosen = confirmation?.kind === 'loosen' ? confirmation : undefined;
  const tighten = confirmation?.kind === 'tighten' ? confirmation : undefined;
  const kept = tighten?.clients ?? NO_CLIENTS;
  const allowAny = loosen?.mode === 'any';

  return (
    <>
      <ConfirmModal
        open={open && Boolean(loosen)}
        title={allowAny ? t('settings.mcp.allowAllTitle') : t('settings.mcp.allowVerifiedTitle')}
        description={allowAny ? t('settings.mcp.allowAllDescription') : t('settings.mcp.allowVerifiedDescription')}
        confirmText={allowAny ? t('settings.mcp.allowAllConfirm') : t('settings.mcp.allowVerifiedConfirm')}
        loading={loading}
        dialogTestId={allowAny ? 'mcp-allow-all-dialog' : 'mcp-allow-verified-dialog'}
        confirmTestId={allowAny ? 'mcp-confirm-allow-all' : 'mcp-confirm-allow-verified'}
        onClose={onClose}
        onConfirm={() => {
          if (loosen) onConfirm(loosen.mode);
        }}
      />

      <ConfirmModal
        open={open && Boolean(tighten)}
        title={
          tighten?.mode === 'verified_and_approved'
            ? t('settings.mcp.requireApprovalUnverifiedTitle')
            : t('settings.mcp.requireApprovalTitle')
        }
        description={t('settings.mcp.requireApprovalKeepApps', {
          count: kept.length,
          names: mcpClientNames(kept, t),
          ...RAW_INTERPOLATION,
        })}
        confirmText={t('settings.mcp.requireApprovalConfirm')}
        loading={loading}
        dialogTestId='mcp-require-approval-dialog'
        confirmTestId='mcp-confirm-require-approval'
        onClose={onClose}
        onConfirm={() => {
          if (tighten) onConfirm(tighten.mode);
        }}
      />
    </>
  );
}

/**
 * "Revoke …?": what revoking ends, and whether members can still connect the
 * app: through the policy, or through an approval of all the app's installs
 * that outlives this per-client one.
 */
function RevokeDialog({
  approval,
  approvals,
  mode,
  open,
  loading,
  onClose,
  onConfirm,
}: {
  approval: McpApprovedClient | undefined;
  /** Every approval of the workspace, `approval` included. */
  approvals: readonly McpApprovedClient[];
  mode: McpApprovalMode | undefined;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: (approval: McpApprovedClient) => void;
}) {
  const { t } = useTranslation();
  const values = { name: approval ? mcpClientName(approval, t) : '', ...RAW_INTERPOLATION };
  let description = '';

  if (approval) {
    if (mode && mcpModeAdmitsWithoutApproval(mode, approval)) {
      description = t('settings.mcp.revokeStillAllowedDescription', values);
    } else if (mcpRemainingAppApproval(approval, approvals)) {
      description = t('settings.mcp.revokeStillApprovedAsAppDescription', values);
    } else if (isMcpAppApprovalKey(approval.approval_key)) {
      description = t('settings.mcp.revokeAppDescription', values);
    } else {
      description = t('settings.mcp.revokeDescription', values);
    }
  }

  return (
    <ConfirmModal
      open={open && Boolean(approval)}
      title={t('settings.mcp.revokeTitle', values)}
      description={description}
      confirmText={t('settings.mcp.revoke')}
      loading={loading}
      dialogTestId='mcp-revoke-dialog'
      confirmTestId='mcp-confirm-revoke'
      onClose={onClose}
      onConfirm={() => {
        if (approval) onConfirm(approval);
      }}
    />
  );
}

/**
 * "Disconnect {member} from {app}?" for one device. When the member has other
 * connections with the app, says that they keep working.
 */
function MemberDisconnectDialog({
  connection,
  connections,
  open,
  loading,
  onClose,
  onConfirm,
}: {
  connection: McpWorkspaceConnection | undefined;
  connections: readonly McpWorkspaceConnection[] | undefined;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: (connection: McpWorkspaceConnection) => void;
}) {
  const { t } = useTranslation();
  const values = connection
    ? { member: mcpMemberLabel(connection).name, name: mcpClientName(connection, t), ...RAW_INTERPOLATION }
    : { member: '', name: '', ...RAW_INTERPOLATION };
  let description: ReactNode = '';

  if (connection) {
    description = (
      <DisconnectDescription
        main={t('settings.mcp.memberDisconnectDescription', values)}
        device={mcpDeviceLabel(connection)}
        othersKeepWorking={mcpOthersKeepWorking(connection, connections ?? [])}
      />
    );
  }

  return (
    <ConfirmModal
      open={open && Boolean(connection)}
      title={t('settings.mcp.memberDisconnectTitle', values)}
      description={description}
      confirmText={t('settings.mcp.disconnect')}
      loading={loading}
      dialogTestId='mcp-member-disconnect-dialog'
      confirmTestId='mcp-confirm-member-disconnect'
      onClose={onClose}
      onConfirm={() => {
        if (connection) onConfirm(connection);
      }}
    />
  );
}

/** The danger zone: disconnect every member's AI apps in the workspace. */
function DisconnectAll({ disabled, onDisconnectAll }: { disabled: boolean; onDisconnectAll: () => void }) {
  const { t } = useTranslation();
  const descriptionId = useId();

  return (
    <div
      className='flex items-center justify-between gap-4 rounded-400 border border-border-error-thick px-4 py-3'
      data-testid='mcp-disconnect-all'
    >
      <div className='flex min-w-0 flex-col gap-1'>
        <span className='text-sm font-medium text-text-primary'>{t('settings.mcp.disconnectAllLabel')}</span>
        <p id={descriptionId} className='text-xs text-text-secondary'>
          {t('settings.mcp.disconnectAllDescription')}
        </p>
      </div>
      <Button
        variant='destructive-outline'
        size='sm'
        className='shrink-0'
        disabled={disabled}
        aria-describedby={descriptionId}
        onClick={onDisconnectAll}
        data-testid='mcp-disconnect-all-button'
      >
        {t('settings.mcp.disconnectAllConfirm')}
      </Button>
    </div>
  );
}

/** Collapsible "Approve an app by client ID" for apps nobody has requested yet. */
function ApproveById({
  busy,
  approvingClientId,
  onApprove,
}: {
  busy: boolean;
  /** The client ID an approval is in flight for. */
  approvingClientId?: string;
  onApprove: (clientId: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const contentId = useId();
  const descriptionId = useId();
  const trimmed = clientId.trim();
  const approving = Boolean(trimmed) && approvingClientId === trimmed;

  return (
    <div className='rounded-400 border border-border-primary' data-testid='mcp-approve-by-id'>
      <button
        type='button'
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((value) => !value)}
        className='flex w-full items-center gap-2 rounded-400 px-4 py-3 text-left text-sm font-medium text-text-primary outline-none hover:bg-fill-content-hover focus-visible:ring-2 focus-visible:ring-border-theme-thick'
        data-testid='mcp-approve-by-id-toggle'
      >
        <ArrowRightIcon
          aria-hidden='true'
          className={cn('h-5 w-5 shrink-0 text-icon-secondary transition-transform', open && 'rotate-90')}
        />
        {t('settings.mcp.advancedTitle')}
      </button>
      {open && (
        <form
          id={contentId}
          className='flex flex-col gap-3 px-4 pb-4'
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed || busy) return;
            void onApprove(trimmed).then((success) => {
              if (success) setClientId('');
            });
          }}
        >
          <p id={descriptionId} className='text-xs text-text-secondary'>
            {t('settings.mcp.advancedDescription')}
          </p>
          <div className='flex min-w-0 items-center gap-2'>
            <Input
              autoFocus
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              maxLength={MAX_CLIENT_ID_LENGTH}
              placeholder={t('settings.mcp.clientIdPlaceholder')}
              aria-label={t('settings.mcp.advancedTitle')}
              aria-describedby={descriptionId}
              className='min-w-0 flex-1 font-mono'
              data-testid='mcp-approve-by-id-input'
            />
            <Button type='submit' disabled={busy || !trimmed} loading={approving} data-testid='mcp-approve-by-id-submit'>
              {t('settings.mcp.approve')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
