import { createContext, ReactNode, useContext, useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { McpConnectionDetails, McpTimestamp } from '@/application/services/domains/mcp';
import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { McpClientIdentity, type McpClientIdentityProps } from '@/components/mcp/McpClientIdentity';
import { McpScopeBadge } from '@/components/mcp/McpScopeBadge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { formatMcpDateTime, formatMcpRelativeTime, mcpDate, mcpDeviceLabel, RAW_INTERPOLATION } from './format';

/**
 * An element inside the Settings dialog. Radix tooltips portal to `body` by
 * default, which renders them below the MUI dialog and outside its focus trap.
 */
export const McpPanelContainerContext = createContext<HTMLElement | null>(null);

export function PanelSection({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description?: string;
  testId?: string;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className='flex min-w-0 flex-col gap-4' data-testid={testId}>
      <div className='flex flex-col gap-1'>
        <h3 id={titleId} className='text-base font-semibold text-text-primary'>
          {title}
        </h3>
        {description && <p className='text-sm text-text-secondary'>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function SubSection({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className='flex min-w-0 flex-col gap-2' data-testid={testId}>
      <h4 id={titleId} className='text-sm font-medium text-text-primary'>
        {title}
      </h4>
      {children}
    </section>
  );
}

export function RowList({ children }: { children: ReactNode }) {
  return (
    <ul className='flex min-w-0 flex-col divide-y divide-border-primary rounded-400 border border-border-primary'>
      {children}
    </ul>
  );
}

/** Layout of one `RowList` item: details on the left, actions on the right. */
export const ROW_CLASS = 'flex min-w-0 items-center justify-between gap-4 px-4 py-3';

export function EmptyState({ testId, children }: { testId?: string; children: ReactNode }) {
  return (
    <p
      className='rounded-400 border border-dashed border-border-primary px-4 py-5 text-center text-sm text-text-secondary'
      data-testid={testId}
    >
      {children}
    </p>
  );
}

export function SectionLoading() {
  const { t } = useTranslation();

  return (
    <div role='status' aria-label={t('settings.mcp.loading')} className='flex justify-center py-6'>
      <Progress variant='primary' />
    </div>
  );
}

/**
 * "Couldn't load MCP settings." with Retry, in place of a section's content. Retry clears the
 * failure as the reload starts, so a section shows its loading state, not this, while it runs.
 */
export function SectionError({ onRetry, testId }: { onRetry: () => void; testId?: string }) {
  const { t } = useTranslation();

  return (
    <div
      role='alert'
      className='flex items-center justify-between gap-4 rounded-400 border border-border-primary px-4 py-3 text-sm'
      data-testid={testId}
    >
      <p className='min-w-0 text-text-error'>{t('settings.mcp.loadFailed')}</p>
      <Button variant='outline' size='sm' onClick={onRetry} data-testid={testId ? `${testId}-retry` : undefined}>
        {t('settings.mcp.retry')}
      </Button>
    </div>
  );
}

export function Notice({ testId, children }: { testId?: string; children: ReactNode }) {
  return (
    <div
      role='note'
      className='flex items-start gap-2 rounded-400 border border-border-info-thick bg-fill-info-light px-4 py-3 text-sm text-text-primary'
      data-testid={testId}
    >
      <InfoIcon aria-hidden='true' className='mt-px h-4 w-4 shrink-0 text-icon-info-thick' />
      <span className='min-w-0'>{children}</span>
    </div>
  );
}

/** An app's identity with its "Not verified" tooltip kept inside the Settings dialog. */
export function PanelClientIdentity(props: Omit<McpClientIdentityProps, 'tooltipContainer'>) {
  const container = useContext(McpPanelContainerContext);

  return <McpClientIdentity {...props} tooltipContainer={container} />;
}

/** A granted scope; its tooltip says that changing it takes a new connection. */
export function PanelScopeBadge({ scope }: { scope?: string | null }) {
  const { t } = useTranslation();
  const container = useContext(McpPanelContainerContext);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className='inline-flex w-fit shrink-0 cursor-help rounded-full' data-testid='mcp-scope'>
          <McpScopeBadge scope={scope} />
        </span>
      </TooltipTrigger>
      <TooltipContent container={container ?? undefined}>{t('settings.mcp.scopeTooltip')}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The device a connection signed in from (when the app described it) and its
 * times: "Connected 2 days ago · Last used 5 minutes ago".
 */
export function ConnectionDetails({
  connection,
  testIdPrefix,
}: {
  connection: Pick<McpConnectionDetails, 'device_label' | 'connected_at' | 'last_used_at'>;
  /** `mcp-my-connection` or `mcp-member-connection`: the parts get `-device`, `-time` and `-last-used`. */
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  const device = mcpDeviceLabel(connection);
  const lastUsed = mcpDate(connection.last_used_at);

  return (
    <div className='flex min-w-0 flex-col gap-0.5'>
      {device && (
        <span className='truncate text-xs text-text-primary' title={device} data-testid={`${testIdPrefix}-device`}>
          {device}
        </span>
      )}
      <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5'>
        <McpTime
          value={connection.connected_at}
          label={(time) => t('settings.mcp.connectedAt', { time, ...RAW_INTERPOLATION })}
          testId={`${testIdPrefix}-time`}
        />
        {lastUsed && (
          <>
            {mcpDate(connection.connected_at) && (
              <span aria-hidden='true' className='text-xs text-text-secondary'>
                ·
              </span>
            )}
            <McpTime
              value={connection.last_used_at}
              label={(time) => t('settings.mcp.lastUsedAt', { time, ...RAW_INTERPOLATION })}
              testId={`${testIdPrefix}-last-used`}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A disconnect confirmation's text: what ends, then, when the person has other
 * connections with the app, that only this device's connection ends.
 */
export function DisconnectDescription({
  main,
  device,
  othersKeepWorking,
}: {
  main: string;
  /** The connection's device label, when the app described one. */
  device?: string;
  othersKeepWorking: boolean;
}) {
  const { t } = useTranslation();

  return (
    <span className='flex flex-col gap-2'>
      <span>{main}</span>
      {othersKeepWorking && (
        <span data-testid='mcp-disconnect-device-note'>
          {device
            ? t('settings.mcp.disconnectDeviceNote', { device, ...RAW_INTERPOLATION })
            : t('settings.mcp.disconnectOneNote')}
        </span>
      )}
    </span>
  );
}

/** A relative time ("2 hours ago"), optionally inside a label, with the absolute time as a tooltip. */
export function McpTime({
  value,
  label,
  testId,
}: {
  value?: McpTimestamp | null;
  label?: (relative: string) => string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const container = useContext(McpPanelContainerContext);
  const date = mcpDate(value);

  if (!date) return null;
  const relative = formatMcpRelativeTime(date, t);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={date.toISOString()}
          tabIndex={0}
          className='w-fit cursor-default text-xs text-text-secondary'
          data-testid={testId}
        >
          {label ? label(relative) : relative}
        </time>
      </TooltipTrigger>
      <TooltipContent container={container ?? undefined}>{formatMcpDateTime(date)}</TooltipContent>
    </Tooltip>
  );
}
