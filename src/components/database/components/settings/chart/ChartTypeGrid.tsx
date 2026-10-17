import { useTranslation } from 'react-i18next';

import type { ChartType } from '@/application/database-yjs/chart.type';
import { ReactComponent as ProBadgeIcon } from '@/assets/icons/pro_badge.svg';
import {
  CHART_TYPE_OPTIONS,
  ChartTypeOption,
  isPremiumChartType,
} from '@/components/database/components/settings/chart/chartSettingsOptions';
import type { ChartPlanState } from '@/components/database/components/settings/chart/useChartTypeAccess';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { KeyboardEvent } from 'react';

/**
 * Desktop `_NotchedRoundedBorderPainter` for a 46x36 button with an 8px corner
 * radius: the outline skips a 10px notch at the top-right corner so the pro
 * badge never sits on the border line. Inset by half the 1px stroke so the line
 * covers the same pixels as a CSS border.
 */
const NOTCHED_BORDER_PATH = 'M0.5 8Q0.5 0.5 8 0.5H36M45.5 10V28Q45.5 35.5 38 35.5H8Q0.5 35.5 0.5 28V8';

function ChartTypeButton({
  option,
  selected,
  inert,
  showProBadge,
  onTypeSelect,
  onUpgradePrompt,
}: {
  option: ChartTypeOption;
  selected: boolean;
  /** Locked without an upgrade path: a plain button that does nothing. */
  inert: boolean;
  showProBadge: boolean;
  onTypeSelect: (type: ChartType) => void;
  /** Returns whether the plan modal takes over, so the menu may close. */
  onUpgradePrompt: () => boolean;
}) {
  const { t } = useTranslation();
  const label = t(option.labelKey, option.fallback);
  // Desktop's crown is visual only; keep the spoken cue for the paywalled
  // state while the tooltip and the typeahead stay the plain type name.
  const accessibleName = showProBadge ? `${label} (${t('chart.upgradeRequired', 'Upgrade Required')})` : label;
  const Icon = option.Icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem
          aria-disabled={inert || undefined}
          aria-label={accessibleName}
          aria-pressed={selected}
          className={cn(
            'h-9 min-h-0 w-[46px] shrink-0 justify-center gap-0 border p-0',
            selected
              ? 'border-border-info-thick bg-surface-layer-01-hover hover:bg-surface-layer-01-hover focus:bg-surface-layer-01-hover'
              : 'border-border-primary',
            // The notched outline below replaces the CSS border.
            showProBadge && 'border-0'
          )}
          data-chart-type-button=''
          data-locked={showProBadge ? 'true' : undefined}
          data-testid={`chart-type-button-${option.slug}`}
          role='button'
          textValue={label}
          onSelect={(event) => {
            if (inert) {
              // Neither a write nor a prompt until the plan is known: a Pro
              // user must not be sent to the upgrade flow while it loads.
              event.preventDefault();
              return;
            }

            if (showProBadge) {
              // Owners leave the menu so the plan modal can take focus and
              // pointer input; everyone else stays in it, like desktop.
              if (!onUpgradePrompt()) event.preventDefault();
              return;
            }

            event.preventDefault();
            onTypeSelect(option.type);
          }}
        >
          {showProBadge ? (
            <svg
              aria-hidden='true'
              className={cn(
                'absolute inset-0 !h-9 !w-[46px]',
                selected ? 'text-border-info-thick' : 'text-border-primary'
              )}
              data-chart-type-notched-border=''
              fill='none'
              viewBox='0 0 46 36'
            >
              <path d={NOTCHED_BORDER_PATH} stroke='currentColor' />
            </svg>
          ) : null}
          <Icon aria-hidden='true' className={selected ? 'text-icon-info-thick' : 'text-icon-primary'} />
          {showProBadge ? (
            <ProBadgeIcon
              aria-hidden='true'
              className='absolute -right-1 -top-2 !h-[18px] !w-3'
              data-chart-type-pro-badge=''
            />
          ) : null}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side='top' sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Desktop `ChartTypeGrid`: four 46x36 buttons spread across the row. The
 * buttons are menu items, so ArrowUp/ArrowDown reach them like any other row;
 * ArrowLeft/ArrowRight also move between them since they sit side by side.
 */
export function ChartTypeGrid({
  labelledBy,
  selectedType,
  planState,
  isHosted,
  onTypeSelect,
  onUpgradePrompt,
}: {
  labelledBy?: string;
  selectedType: ChartType;
  planState: ChartPlanState;
  isHosted: boolean;
  onTypeSelect: (type: ChartType) => void;
  onUpgradePrompt: () => boolean;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-chart-type-button]:not([data-disabled])')
    );
    const index = buttons.indexOf(event.target as HTMLElement);

    if (index === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;

    buttons[(index + step + buttons.length) % buttons.length].focus();
  };

  return (
    <DropdownMenuGroup
      aria-labelledby={labelledBy}
      className='flex items-center justify-between px-2 pb-1.5'
      data-testid='chart-type-grid'
      onKeyDown={handleKeyDown}
    >
      {CHART_TYPE_OPTIONS.map((option) => {
        // Mirrors desktop's `showCrown: !canUsePro && _isPremiumChartType(type)`.
        // Desktop reads an already-loaded plan; here only a confirmed Free plan
        // crowns a type, and the crown and upgrade prompt only exist on official
        // hosting. A locked type whose plan (or hosting mode) is still unknown
        // is inert instead, so nothing flashes while the plan loads.
        const locked = planState !== 'pro' && isPremiumChartType(option.type);
        const showProBadge = locked && isHosted && planState === 'free';

        return (
          <ChartTypeButton
            key={option.type}
            inert={locked && !showProBadge}
            option={option}
            selected={selectedType === option.type}
            showProBadge={showProBadge}
            onTypeSelect={onTypeSelect}
            onUpgradePrompt={onUpgradePrompt}
          />
        );
      })}
    </DropdownMenuGroup>
  );
}
