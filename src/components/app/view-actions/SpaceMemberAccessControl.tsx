import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { AccessLevel, SpaceMemberAccessOverride } from '@/application/types';
import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { TFunction } from 'i18next';

/** The levels an ordinary Custom-space person or group can be given instead of the space default. */
const CHOSEN_ACCESS_LEVELS = [AccessLevel.ReadOnly, AccessLevel.ReadAndComment, AccessLevel.ReadAndWrite] as const;

/**
 * Plain-language label for the access one person or group gets from this space.
 * `null` is No access; `undefined` (or a level this client does not know) is unavailable.
 */
export function spaceMemberAccessLabel(level: AccessLevel | null | undefined, t: TFunction): string {
  switch (level) {
    case null:
      return t('space.memberOverride.levels.noAccess');
    case AccessLevel.ReadOnly:
      return t('space.memberOverride.levels.canView');
    case AccessLevel.ReadAndComment:
      return t('space.memberOverride.levels.canComment');
    case AccessLevel.ReadAndWrite:
      return t('space.memberOverride.levels.canEdit');
    case AccessLevel.FullAccess:
      return t('space.memberOverride.levels.fullAccess');
    default:
      return t('space.memberOverride.unknown');
  }
}

/**
 * What one person or group gets: "Can edit · default" while they keep the space
 * default, or the level chosen for them. An unknown choice shows the access
 * the server reported, if any.
 */
export function spaceMemberAssignmentLabel(
  value: SpaceMemberAccessOverride | undefined,
  effectiveAccess: AccessLevel | null | undefined,
  defaultAccess: AccessLevel | null,
  t: TFunction
): string {
  if (value === null) {
    return t('space.memberOverride.defaultSuffix', {
      level: spaceMemberAccessLabel(effectiveAccess === undefined ? defaultAccess : effectiveAccess, t),
    });
  }

  return spaceMemberAccessLabel(value === undefined ? effectiveAccess : value, t);
}

/** Column header with the one explanation of how per-person access works. */
export function SpaceMemberAccessHeader() {
  const { t } = useTranslation();

  return (
    <div className='flex min-w-0 justify-end'>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className='inline-flex cursor-default items-center gap-1 text-sm font-medium text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-border-theme-thick'
            data-testid='space-member-access-header'
          >
            {t('space.memberOverride.label')}
            <InfoIcon aria-hidden className='h-4 w-4 text-icon-secondary' />
          </button>
        </TooltipTrigger>
        <TooltipContent className='max-w-[320px] break-words' data-testid='space-member-access-header-hint'>
          {t('space.memberOverride.explanation')}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * Read-only access cell: owners' "Full access", or a row whose access cannot be
 * changed here. `reason` explains why in a tooltip.
 */
export function SpaceMemberAccessStatic({
  label,
  reason,
  testId,
  value,
}: {
  label: string;
  reason?: string;
  testId: string;
  /** Machine-readable assignment state for rows that normally carry a chosen level. */
  value?: string;
}) {
  const content = (
    <>
      <span className='truncate'>{label}</span>
      {reason ? (
        <InfoIcon aria-hidden className='h-4 w-4 shrink-0 text-icon-tertiary' />
      ) : (
        <ChevronDown aria-hidden className='h-4 w-4 shrink-0 opacity-0' />
      )}
    </>
  );
  const className = 'flex min-w-0 items-center justify-end gap-2 px-2 text-sm text-text-secondary';

  return (
    <div className='flex min-w-0 justify-end' data-testid={testId} data-value={value}>
      {reason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              className={`${className} cursor-default rounded-300 outline-none focus-visible:ring-2 focus-visible:ring-border-theme-thick`}
            >
              {content}
            </button>
          </TooltipTrigger>
          <TooltipContent className='max-w-[280px] break-words'>{reason}</TooltipContent>
        </Tooltip>
      ) : (
        <span className={className}>{content}</span>
      )}
    </div>
  );
}

/**
 * Compact access menu for one ordinary Custom-space person or group: the space
 * default, or a level chosen for them. The trigger shows the access they get
 * now, including a pending choice while it saves.
 */
export function SpaceMemberAccessControl({
  value,
  effectiveAccess,
  defaultAccess,
  disabled,
  pending,
  principalName,
  testId,
  onChange,
}: {
  /** `null` keeps the space default; a level is chosen for this person or group. */
  value: SpaceMemberAccessOverride;
  /** What this person or group gets from the space now; `undefined` falls back to the default. */
  effectiveAccess: AccessLevel | null | undefined;
  defaultAccess: AccessLevel | null;
  disabled: boolean;
  pending: boolean;
  principalName: string;
  testId: string;
  onChange: (value: SpaceMemberAccessOverride) => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const label = spaceMemberAssignmentLabel(value, effectiveAccess, defaultAccess, t);
  const choose = (next: SpaceMemberAccessOverride) => {
    if (next !== value) onChange(next);
  };

  return (
    <div
      className='flex min-w-0 justify-end'
      data-testid='space-member-access-control'
      data-value={value === null ? 'inherit' : String(value)}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={disabled}
            loading={pending}
            aria-label={t('space.memberOverride.accessFor', {
              name: principalName,
              interpolation: { escapeValue: false },
            })}
            aria-describedby={labelId}
            className='min-w-0 max-w-full justify-end px-2 text-text-primary'
            data-testid={testId}
          >
            <span id={labelId} className='truncate'>
              {label}
            </span>
            {pending ? (
              <LoaderCircle aria-hidden className='h-4 w-4 animate-spin text-icon-tertiary motion-reduce:animate-none' />
            ) : (
              <ChevronDown aria-hidden className='h-4 w-4 text-icon-tertiary' />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem
            onSelect={() => choose(null)}
            className='justify-between'
            data-testid={`${testId}-option-default`}
          >
            {t('space.memberOverride.spaceDefault', { level: spaceMemberAccessLabel(defaultAccess, t) })}
            {value === null && <DropdownMenuItemTick />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {CHOSEN_ACCESS_LEVELS.map((level) => (
            <DropdownMenuItem
              key={level}
              onSelect={() => choose(level)}
              className='justify-between'
              data-testid={`${testId}-option-${level}`}
            >
              {spaceMemberAccessLabel(level, t)}
              {value === level && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
