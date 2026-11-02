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
   * `app` (default): the app's name, its host and every badge. `publisher`:
   * only who publishes it, for the consent page's publisher row. The host
   * leads, and only a proven identity counts as a verified app; where the
   * app runs belongs to the redirect row.
   */
  variant?: 'app' | 'publisher';
  avatarSize?: McpClientAvatarSize;
  /** Extra lines under the badges, such as a connected time. */
  children?: ReactNode;
  /** Where the "Not verified" tooltip renders; inside an MUI dialog pass an element of the dialog. */
  tooltipContainer?: Element | null;
  className?: string;
}

const BADGE_CLASS = 'inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs';

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

  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)} data-testid='mcp-client-identity'>
      {showAvatar && <McpClientAvatar client={client} size={avatarSize} />}
      <div className='flex min-w-0 flex-col gap-1'>
        <span
          className='truncate text-sm font-medium text-text-primary'
          title={title}
          data-testid='mcp-client-identity-name'
        >
          {title}
        </span>
        {client && (
          <div className='flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-text-secondary'>
            {name && host && (
              <span className='truncate' title={host} data-testid='mcp-client-identity-host'>
                {host}
              </span>
            )}
            {verifiedIdentity ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className={cn(
                      BADGE_CLASS,
                      'cursor-help border-border-success-thick bg-fill-success-light text-text-success'
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
                    className={cn(BADGE_CLASS, 'cursor-help border-border-primary bg-fill-content text-text-secondary')}
                    data-testid='mcp-client-native-app-badge'
                  >
                    {t('settings.mcp.localApp')}
                  </span>
                </TooltipTrigger>
                <TooltipContent container={tooltipContainer ?? undefined}>
                  {t('settings.mcp.nativeAppTooltip')}
                </TooltipContent>
              </Tooltip>
            ) : client.client_kind === 'cimd' ? (
              <span
                className={cn(BADGE_CLASS, 'border-border-success-thick bg-fill-success-light text-text-success')}
                data-testid='mcp-client-verified-badge'
              >
                {t('settings.mcp.verified')}
              </span>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className={cn(BADGE_CLASS, 'cursor-help border-border-primary bg-fill-content text-text-secondary')}
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
                className={cn(BADGE_CLASS, 'border-border-primary bg-fill-content text-text-secondary')}
                data-testid='mcp-client-local-badge'
              >
                {t('settings.mcp.localApp')}
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default McpClientIdentity;
