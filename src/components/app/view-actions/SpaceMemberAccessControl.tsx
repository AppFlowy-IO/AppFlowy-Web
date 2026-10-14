import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { ExtraSpaceAccess } from '@/application/services/js-services/space-member-assignment';
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

const EXTRA_ACCESS_KEYS = {
  [AccessLevel.ReadOnly]: 'space.memberOverride.extraAccess.view',
  [AccessLevel.ReadAndComment]: 'space.memberOverride.extraAccess.comment',
  [AccessLevel.ReadAndWrite]: 'space.memberOverride.extraAccess.edit',
  [AccessLevel.FullAccess]: 'space.memberOverride.extraAccess.full',
} as const satisfies Record<AccessLevel, string>;

/** "You can also edit this space through the Marketing group." */
export function spaceMemberExtraAccessNote(extra: ExtraSpaceAccess, t: TFunction): string {
  const noEscape = { interpolation: { escapeValue: false } };
  const { source } = extra;
  let sourceText: string;

  if (source.kind === 'pageShare') {
    sourceText = t('space.memberOverride.extraAccessSource.pageShare');
  } else if (source.kind === 'group') {
    sourceText = source.groupName
      ? t('space.memberOverride.extraAccessSource.group', { name: source.groupName, ...noEscape })
      : t('space.memberOverride.extraAccessSource.anyGroup');
  } else {
    sourceText = source.groupName
      ? t('space.memberOverride.extraAccessSource.allSpaces', { name: source.groupName, ...noEscape })
      : t('space.memberOverride.extraAccessSource.anyAllSpaces');
  }

  return t(EXTRA_ACCESS_KEYS[extra.level], { source: sourceText, ...noEscape });
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
  note,
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
  /**
   * One plain line at the end of the menu, e.g. why more access remains whatever is chosen here.
   * Have it ready before the menu opens: it then describes the menu. One that arrives or changes
   * while the menu is open is read out politely instead.
   */
  note?: string | null;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const noteId = useId();
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
        <DropdownMenuContent align='end' aria-describedby={note ? noteId : undefined}>
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
          {note && <DropdownMenuSeparator />}
          {/* Always present, so a line added while the menu is open is announced. */}
          <div aria-live='polite' data-testid={`${testId}-note-region`}>
            {note && (
              <p
                id={noteId}
                className='max-w-[260px] px-2 py-1.5 text-xs leading-5 text-text-secondary'
                data-testid={`${testId}-note`}
              >
                {note}
              </p>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
