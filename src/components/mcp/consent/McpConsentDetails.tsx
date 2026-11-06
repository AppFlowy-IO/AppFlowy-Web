import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { describeRedirectUri } from '@/application/mcp/setup';
import type { McpClientInfo } from '@/application/services/domains/mcp';
import { McpClientIdentity } from '@/components/mcp/McpClientIdentity';

import { McpConsentNotice } from './McpConsentNotice';

export interface McpConsentDetailsProps {
  client: McpClientInfo;
  /** The `redirect_uri` of the request; the server has matched it against the client's registration. */
  redirectUri: string;
}

function DetailRow({ label, children, testId }: { label: ReactNode; children: ReactNode; testId: string }) {
  return (
    <div className='flex items-start gap-4 px-4 py-3' data-testid={testId}>
      <dt className='w-24 shrink-0 text-text-secondary'>{label}</dt>
      <dd className='flex min-w-0 flex-1 flex-wrap items-center gap-1.5'>{children}</dd>
    </div>
  );
}

/**
 * Who is asking and where the browser goes next: the publisher's host with
 * Verified app (the server's catalog proves who the app is) / Verified domain
 * / Not verified (a DCR client's name is self-asserted), the redirect host
 * (with its scheme for a private-use URI such as `cursor://…`), and a warning
 * when it returns to an app on this computer, over loopback or a private-use
 * scheme: any program there could claim it. A catalog app that runs on the
 * user's computer (Claude Code, Cursor) is not a verified app here: any
 * program there could use its name, so its publisher row reads like any
 * other client's and the redirect row carries the warning.
 */
export function McpConsentDetails({ client, redirectUri }: McpConsentDetailsProps) {
  const { t } = useTranslation();
  const target = describeRedirectUri(redirectUri);
  const onThisComputer = target?.kind === 'loopback' || target?.kind === 'private-use';

  return (
    <div className='flex flex-col gap-3'>
      <dl className='flex flex-col divide-y divide-border-primary rounded-400 border border-border-primary text-sm'>
        <DetailRow label={t('mcp.consent.publisher')} testId='mcp-consent-publisher'>
          {/* The host leads (the title names the app); "Runs on your computer" belongs to the redirect row. */}
          <McpClientIdentity showAvatar={false} variant='publisher' client={client} />
        </DetailRow>
        <DetailRow label={t('mcp.consent.returnsTo')} testId='mcp-consent-returns-to'>
          {/* Stacked like the publisher row's McpClientIdentity: the host above its badge. */}
          <div className='flex min-w-0 flex-col gap-1'>
            <span
              className='min-w-0 truncate font-medium text-text-primary'
              title={redirectUri}
              data-testid='mcp-consent-redirect-host'
            >
              {target?.label ?? redirectUri}
            </span>
            {onThisComputer && (
              <span
                className='inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full bg-fill-content-visible px-2 py-px text-sm text-text-secondary'
                data-testid='mcp-consent-local-app'
              >
                {t('settings.mcp.localApp')}
              </span>
            )}
          </div>
        </DetailRow>
      </dl>
      {onThisComputer && (
        <McpConsentNotice tone='warning' data-testid='mcp-consent-localhost-warning'>
          {t('mcp.consent.localhostWarning')}
        </McpConsentNotice>
      )}
    </div>
  );
}

export default McpConsentDetails;
