import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MCP_SETUP_PAGE_PATH, type McpScope } from '@/application/mcp/setup';
import type { McpClientInfo, McpMemberStatus } from '@/application/services/domains/mcp';
import type { Workspace } from '@/application/types';
import { McpClientAvatar } from '@/components/mcp/McpClientAvatar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import {
  consentErrorMessageKey,
  consentHostToAcknowledge,
  consentPrimaryAction,
  isReadOnlyConsentRequest,
  type ConsentErrorReason,
} from './consentModel';
import { McpConsentAccount } from './McpConsentAccount';
import { McpConsentDetails } from './McpConsentDetails';
import { CONSENT_FOCUS_RING, McpConsentLayout } from './McpConsentLayout';
import { McpConsentNotice } from './McpConsentNotice';
import { McpConsentScopes } from './McpConsentScopes';
import { McpConsentWorkspacePicker } from './McpConsentWorkspacePicker';
import { type ConsentAction } from './useMcpConsent';

// The client name is rendered by React inside the translated sentence; i18next only sees this marker.
const NAME_MARKER = '\u2063';
const RAW_INTERPOLATION = { interpolation: { escapeValue: false } };
const ACTION_BUTTON_CLASS = cn('sm:flex-1', CONSENT_FOCUS_RING);

function ConsentTitle({ name }: { name: string }) {
  const { t } = useTranslation();
  const sentence = t('mcp.consent.title', { name: NAME_MARKER, ...RAW_INTERPOLATION });
  const markerIndex = sentence.indexOf(NAME_MARKER);
  const nameNode = (
    <span className='text-text-primary' data-testid='mcp-consent-client-name'>
      {name}
    </span>
  );

  return (
    <h1 className='break-words text-xl font-semibold text-text-primary' data-testid='mcp-consent-title'>
      {markerIndex < 0 ? (
        <>
          <span className='block'>{nameNode}</span>
          {sentence}
        </>
      ) : (
        <>
          {sentence.slice(0, markerIndex)}
          {nameNode}
          {sentence.slice(markerIndex + NAME_MARKER.length)}
        </>
      )}
    </h1>
  );
}

export interface McpConsentViewProps {
  client: McpClientInfo;
  /** The client's display name ("Unknown app" when it has neither name nor host). */
  name: string;
  redirectUri: string;
  /** The `scope` the app asked for; without write or admin the page says it will only read. */
  requestedScope?: string;
  workspaces: readonly Workspace[];
  workspaceId?: string;
  onSelectWorkspace: (workspaceId: string) => void;
  /** The selected workspace's member status; undefined while loading or after a failure. */
  status?: McpMemberStatus;
  statusLoading: boolean;
  statusError: ConsentErrorReason | null;
  onRetryStatus: () => void;
  scopes: readonly McpScope[];
  onToggleScope: (scope: McpScope, checked: boolean) => void;
  busy: ConsentAction | null;
  actionError: ConsentErrorReason | null;
  email?: string;
  onSwitchAccount: () => void;
  onAllow: () => void;
  onApproveAndAllow: () => void;
  onRequestApproval: () => void;
  onDeny: () => void;
}

/** The consent decision: who is asking, for which workspace, with which permissions. */
export function McpConsentView({
  client,
  name,
  redirectUri,
  requestedScope,
  workspaces,
  workspaceId,
  onSelectWorkspace,
  status,
  statusLoading,
  statusError,
  onRetryStatus,
  scopes,
  onToggleScope,
  busy,
  actionError,
  email,
  onSwitchAccount,
  onAllow,
  onApproveAndAllow,
  onRequestApproval,
  onDeny,
}: McpConsentViewProps) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const workspaceName = workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? '';
  const values = { name, workspace: workspaceName, ...RAW_INTERPOLATION };
  const action = status ? consentPrimaryAction(status) : 'allow';
  const requestPending = action === 'request-approval' && Boolean(status?.client?.request_pending);
  const submitting = busy !== null;
  // Granting access (Allow, or an owner's Approve and allow) to an app whose name nobody vouches for
  // first needs the user to say they know where it returns; asking an owner grants nothing yet.
  const hostToAcknowledge = consentHostToAcknowledge(client, redirectUri);
  const mustAcknowledge = Boolean(hostToAcknowledge && status) && action !== 'request-approval';
  const primaryDisabled = submitting || !status || requestPending || (mustAcknowledge && !acknowledged);
  const readOnly = isReadOnlyConsentRequest(requestedScope) && !scopes.some((scope) => scope !== 'read');

  return (
    <McpConsentLayout data-testid='mcp-consent-page' aria-busy={submitting || undefined}>
      <div className='flex flex-col items-center gap-4 text-center'>
        <McpClientAvatar client={client} size='lg' />
        <ConsentTitle name={name} />
      </div>

      <McpConsentDetails client={client} redirectUri={redirectUri} />

      <McpConsentAccount email={email} onSwitch={onSwitchAccount} disabled={submitting} />

      <McpConsentWorkspacePicker
        workspaces={workspaces}
        selectedId={workspaceId}
        onSelect={onSelectWorkspace}
        disabled={submitting}
      />

      <div className='flex flex-col gap-3'>
        <McpConsentScopes scopes={scopes} onToggle={onToggleScope} disabled={submitting} />
        {readOnly && (
          <p className='text-xs text-text-secondary' data-testid='mcp-consent-read-only-hint'>
            {t('mcp.consent.readOnlyHint', values)}
          </p>
        )}
        <p className='text-xs text-text-secondary'>{t('mcp.consent.accessNote')}</p>
        {/* A new tab, so this request stays open; no referrer, since this URL carries OAuth parameters. */}
        <a
          href={MCP_SETUP_PAGE_PATH}
          target='_blank'
          rel='noopener noreferrer'
          className={cn('w-fit rounded-200 text-xs text-text-action hover:underline', CONSENT_FOCUS_RING)}
          data-testid='mcp-consent-learn-more'
        >
          {t('mcp.consent.learnMore')}
        </a>
      </div>

      {statusLoading && (
        <div
          role='status'
          aria-label={t('loading')}
          className='flex justify-center'
          data-testid='mcp-consent-status-loading'
        >
          <Progress variant='primary' />
        </div>
      )}

      {statusError && (
        <McpConsentNotice tone='error' data-testid='mcp-consent-status-error' data-reason={statusError}>
          <p role='alert'>{t(consentErrorMessageKey(statusError))}</p>
          <Button
            variant='outline'
            size='sm'
            className={cn('w-fit', CONSENT_FOCUS_RING)}
            onClick={onRetryStatus}
            data-testid='mcp-consent-status-retry'
          >
            {t('mcp.consent.tryAgain')}
          </Button>
        </McpConsentNotice>
      )}

      {status?.client?.connected && (
        <McpConsentNotice data-testid='mcp-consent-already-connected'>
          {t('mcp.consent.alreadyConnected', values)}
        </McpConsentNotice>
      )}

      {action === 'approve-and-allow' && (
        <McpConsentNotice data-testid='mcp-consent-owner-approval-notice'>
          {t('mcp.consent.ownerApprovalNotice', values)}
        </McpConsentNotice>
      )}

      {action === 'request-approval' &&
        (requestPending ? (
          <McpConsentNotice data-testid='mcp-consent-request-pending'>
            {t('mcp.consent.requestPending', values)}
          </McpConsentNotice>
        ) : (
          <McpConsentNotice data-testid='mcp-consent-member-approval-notice'>
            {t('mcp.consent.memberApprovalNotice', values)}
          </McpConsentNotice>
        ))}

      {actionError && (
        <McpConsentNotice tone='error' data-testid='mcp-consent-inline-error' data-reason={actionError}>
          <p role='alert'>{t(consentErrorMessageKey(actionError))}</p>
        </McpConsentNotice>
      )}

      {mustAcknowledge && hostToAcknowledge && (
        <McpConsentNotice tone='warning' data-testid='mcp-consent-acknowledge-host'>
          <label className='flex cursor-pointer items-start gap-2'>
            <input
              type='checkbox'
              checked={acknowledged}
              disabled={submitting}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className='mt-0.5 h-4 w-4 shrink-0 accent-fill-theme-thick'
              data-testid='mcp-consent-acknowledge'
            />
            <span className='min-w-0 break-words'>
              {t('mcp.consent.acknowledgeHost', { host: hostToAcknowledge, ...RAW_INTERPOLATION })}
            </span>
          </label>
        </McpConsentNotice>
      )}

      <div className='flex flex-col-reverse gap-3 sm:flex-row'>
        <Button
          variant='outline'
          size='lg'
          className={ACTION_BUTTON_CLASS}
          onClick={onDeny}
          disabled={submitting}
          loading={busy === 'deny'}
          data-testid='mcp-consent-deny'
        >
          {t('mcp.consent.cancel')}
        </Button>
        {action === 'approve-and-allow' ? (
          <Button
            size='lg'
            className={ACTION_BUTTON_CLASS}
            onClick={onApproveAndAllow}
            disabled={primaryDisabled}
            loading={busy === 'approve-and-allow'}
            data-testid='mcp-consent-approve-and-allow'
          >
            {busy === 'approve-and-allow' ? t('mcp.consent.submitting') : t('mcp.consent.approveAndAllow')}
          </Button>
        ) : action === 'request-approval' ? (
          <Button
            size='lg'
            className={ACTION_BUTTON_CLASS}
            onClick={onRequestApproval}
            disabled={primaryDisabled}
            loading={busy === 'request-approval'}
            data-testid='mcp-consent-request-approval'
          >
            {t('mcp.consent.requestApproval')}
          </Button>
        ) : (
          <Button
            size='lg'
            className={ACTION_BUTTON_CLASS}
            onClick={onAllow}
            disabled={primaryDisabled}
            loading={busy === 'allow'}
            data-testid='mcp-consent-allow'
          >
            {busy === 'allow' ? t('mcp.consent.submitting') : t('mcp.consent.allow')}
          </Button>
        )}
      </div>
    </McpConsentLayout>
  );
}

export default McpConsentView;
