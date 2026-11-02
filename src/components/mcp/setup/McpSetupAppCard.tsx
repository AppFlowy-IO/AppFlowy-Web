import { ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { McpSetupAppId } from '@/application/mcp/setupApps';
import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down_small.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { cn } from '@/lib/utils';

/**
 * Lettered tiles in place of logos: the guide ships no third-party artwork.
 * Colors come from the tag palette, which has light and dark variants.
 */
const MONOGRAMS: Record<McpSetupAppId, { text: string; className: string }> = {
  claude: { text: 'Cl', className: 'bg-tag-fill-04-light text-tag-text-04-light' },
  chatgpt: { text: 'Ch', className: 'bg-tag-fill-08-light text-tag-text-08-light' },
  'claude-code': { text: 'CC', className: 'bg-tag-fill-05-light text-tag-text-05-light' },
  codex: { text: 'Cx', className: 'bg-tag-fill-10-light text-tag-text-10-light' },
  cursor: { text: 'Cu', className: 'bg-tag-fill-01-light text-tag-text-01-light' },
  vscode: { text: 'VS', className: 'bg-tag-fill-09-light text-tag-text-09-light' },
  gemini: { text: 'Ge', className: 'bg-tag-fill-02-light text-tag-text-02-light' },
  windsurf: { text: 'Wi', className: 'bg-tag-fill-07-light text-tag-text-07-light' },
  other: { text: '+', className: 'bg-fill-content-visible text-text-secondary' },
};

export interface McpSetupAppCardProps {
  app: McpSetupAppId;
  name: string;
  description: string;
  /** This card's steps are shown. */
  selected: boolean;
  /** One of the caller's connections is this app (its verified catalog id matches). */
  connected: boolean;
  /** Id of the steps region this card expands. */
  panelId: string;
  onToggle: () => void;
  /** The card's primary action (install link, vendor page or copy); it sits above the card's click area. */
  action?: ReactNode;
}

/**
 * One app of the setup gallery. The name is a disclosure button whose click
 * area stretches over the whole card (an `::after` overlay), so a click
 * anywhere expands the app's steps; the primary action stacks above it.
 */
export function McpSetupAppCard({
  app,
  name,
  description,
  selected,
  connected,
  panelId,
  onToggle,
  action,
}: McpSetupAppCardProps) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const badgeId = useId();
  const monogram = MONOGRAMS[app];

  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col gap-2 rounded-400 border p-3 transition-colors',
        selected
          ? 'border-border-theme-thick bg-fill-theme-select'
          : 'border-border-primary hover:border-border-primary-hover hover:bg-fill-content-hover'
      )}
      data-testid={`mcp-setup-app-card-${app}`}
      data-selected={selected}
      data-connected={connected}
    >
      <div className='flex min-w-0 items-center gap-2.5'>
        <span
          aria-hidden='true'
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-300 text-xs font-semibold',
            monogram.className
          )}
        >
          {monogram.text}
        </span>
        <button
          type='button'
          aria-expanded={selected}
          aria-controls={selected ? panelId : undefined}
          aria-describedby={connected ? `${descriptionId} ${badgeId}` : descriptionId}
          onClick={onToggle}
          className={cn(
            'min-w-0 flex-1 break-words text-left text-sm font-medium text-text-primary outline-none',
            "after:absolute after:inset-0 after:rounded-400 after:content-['']",
            'focus-visible:after:ring-2 focus-visible:after:ring-border-theme-thick'
          )}
          data-testid={`mcp-client-tab-${app}`}
        >
          {name}
        </button>
        <ChevronDownIcon
          aria-hidden='true'
          className={cn('h-5 w-5 shrink-0 text-icon-secondary transition-transform', selected && 'rotate-180')}
        />
      </div>
      <p id={descriptionId} className='text-xs text-text-secondary'>
        {description}
      </p>
      {connected && (
        <span
          id={badgeId}
          className='inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border-success-thick bg-fill-success-light px-2 py-0.5 text-xs font-medium text-text-success'
          data-testid={`mcp-setup-app-connected-${app}`}
        >
          <CheckIcon aria-hidden='true' className='h-3.5 w-3.5' />
          {t('mcp.setup.connected')}
        </span>
      )}
      {/* Above the stretched click area, so the action keeps its own click. */}
      {action && <div className='relative z-10 mt-auto min-w-0 pt-1'>{action}</div>}
    </div>
  );
}
