import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { getMcpClientOwnName } from '@/application/mcp/setup';
import type { McpClientSummary } from '@/application/services/domains/mcp';
import { McpClientAvatar, type McpClientAvatarSize } from '@/components/mcp/McpClientAvatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type McpClientIdentityClient = Pick<
  McpClientSummary,
  | 'client_name'
  | 'client_host'
  | 'client_kind'
  | 'loopback_only'
  | 'logo_uri'
  | 'app_name'
  | 'verified_app'
  | 'identity_verified'
>;

export interface McpClientIdentityProps {
  /** Null or undefined renders "Unknown app" without badges. */
  client?: McpClientIdentityClient | null;
  /** Render the avatar before the name (default true). */
  showAvatar?: boolean;
  /**
   * `app` (default): the app's name with every badge beside it, then its host.
   * `publisher`: only who publishes it, for the consent page's publisher row:
   * the host leads with its badge below, and only a proven identity counts as a
   * verified app; where the app runs belongs to the redirect row.
   */
  variant?: 'app' | 'publisher';
  avatarSize?: McpClientAvatarSize;
  /** `app` only: what follows the host on its line, such as the device a connection signed in from. */
  detail?: string;
  detailTestId?: string;
  /** Extra lines under the host line, such as a connected time. */
  children?: ReactNode;
  /** Where the "Not verified" tooltip renders; inside an MUI dialog pass an element of the dialog. */
  tooltipContainer?: Element | null;
  className?: string;
}

const BADGE_CLASS =
  'inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-sm font-normal';

/**
 * Who an AI app is: its name (or host, or "Unknown app"), its host, whether
 * AppFlowy verified it and whether it runs on the user's computer. "Verified
 * app" is only for a catalog app whose identity the server proves (a web app
 * that signs in through its publisher's website). A catalog app that runs on
 * the user's computer keeps its catalog name but reads "Runs on your
 * computer": any program there could use that name. Other apps show a
 * verified domain (a client ID metadata document on the client's own https
 * domain) or "Not verified" (they registered themselves).
 */
export function McpClientIdentity({
  client,
  showAvatar = true,
  variant = 'app',
  avatarSize = 'md',
  detail,
  detailTestId,
  children,
  tooltipContainer,
  className,
}: McpClientIdentityProps) {
  const { t } = useTranslation();
  const publisher = variant === 'publisher';
  const verifiedApp = client?.verified_app === true;
  // Recognized and proven: a web app whose sign-ins only return to its publisher.
  const verifiedIdentity = verifiedApp && client?.identity_verified === true;
  // Recognized, but it runs on the user's computer, where any program can claim it.
  const nativeApp = !publisher && verifiedApp && !verifiedIdentity;
  // A recognized app is named by the catalog, not by its own registration.
  const name = publisher ? undefined : getMcpClientOwnName(client);
  const host = client?.client_host?.trim();
  const title = name || host || t('settings.mcp.unknownApp');

  const nameLabel = (
    <span
      className='min-w-0 truncate text-sm font-medium text-text-primary'
      title={title}
      data-testid='mcp-client-identity-name'
    >
      {title}
    </span>
  );
  const badges = client && (
    <>
      {verifiedIdentity ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className={cn(
                BADGE_CLASS,
                'cursor-help bg-fill-success-light text-text-success-on-fill outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
              )}
              data-testid='mcp-client-verified-app-badge'
            >
              {t('settings.mcp.verifiedApp')}
            </span>
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer ?? undefined}>
            {t('settings.mcp.verifiedAppTooltip')}
          </TooltipContent>
        </Tooltip>
      ) : nativeApp ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className={cn(
                BADGE_CLASS,
                'cursor-help bg-fill-content-visible text-text-secondary outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
              )}
              data-testid='mcp-client-native-app-badge'
            >
              {t('settings.mcp.localApp')}
            </span>
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer ?? undefined}>{t('settings.mcp.nativeAppTooltip')}</TooltipContent>
        </Tooltip>
      ) : client.client_kind === 'cimd' ? (
        <span
          className={cn(BADGE_CLASS, 'bg-fill-success-light text-text-success-on-fill')}
          data-testid='mcp-client-verified-badge'
        >
          {t('settings.mcp.verified')}
        </span>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className={cn(
                BADGE_CLASS,
                'cursor-help bg-fill-content-visible text-text-secondary outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
              )}
              data-testid='mcp-client-unverified-badge'
            >
              {t('settings.mcp.unverified')}
            </span>
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer ?? undefined}>
            {t('settings.mcp.unverifiedTooltip')}
          </TooltipContent>
        </Tooltip>
      )}
      {client.loopback_only && !nativeApp && !publisher && (
        <span
          className={cn(BADGE_CLASS, 'bg-fill-content-visible text-text-secondary')}
          data-testid='mcp-client-local-badge'
        >
          {t('settings.mcp.localApp')}
        </span>
      )}
    </>
  );

  if (publisher) {
    return (
      <div className={cn('flex min-w-0 items-center gap-3', className)} data-testid='mcp-client-identity'>
        {showAvatar && <McpClientAvatar client={client} size={avatarSize} />}
        <div className='flex min-w-0 flex-col gap-1'>
          {nameLabel}
          {badges && (
            <div className='flex min-w-0 flex-wrap items-center gap-1.5 text-xs leading-[18px] text-text-secondary'>
              {badges}
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }

  // The host only has a line of its own when the name is not already the host.
  const hostLabel = name ? host : undefined;

  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)} data-testid='mcp-client-identity'>
      {showAvatar && <McpClientAvatar client={client} size={avatarSize} />}
      <div className='flex min-w-0 flex-col gap-0.5'>
        {/* What the app is and whether to trust it; a long name pushes the badges to the next line. */}
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          {nameLabel}
          {badges}
        </div>
        <div className='flex min-w-0 flex-col text-xs leading-[18px] text-text-secondary empty:hidden'>
          {(hostLabel || detail) && (
            <div className='flex min-w-0 items-center gap-1.5'>
              {hostLabel && (
                <span className='min-w-0 truncate' title={hostLabel} data-testid='mcp-client-identity-host'>
                  {hostLabel}
                </span>
              )}
              {hostLabel && detail && (
                <span aria-hidden='true' className='shrink-0'>
                  ·
                </span>
              )}
              {detail && (
                <span className='min-w-0 truncate' title={detail} data-testid={detailTestId}>
                  {detail}
                </span>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

export default McpClientIdentity;
