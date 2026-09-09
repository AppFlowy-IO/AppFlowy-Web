import { type KeyboardEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  NumberGroupMode,
  type NumberGroupConfiguration,
  type NumberGroupValidationError,
  validateNumberGroupConfiguration,
} from '@/application/database-yjs/number-grouping';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuItemTick, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

type RangeDraft = Pick<NumberGroupConfiguration, 'range_start' | 'range_end' | 'range_interval'>;

const RANGE_FIELDS = [
  { key: 'range_start', name: 'start', label: 'Start' },
  { key: 'range_end', name: 'end', label: 'End' },
  { key: 'range_interval', name: 'interval', label: 'Interval' },
] as const;

const ERROR_MESSAGES: Record<NumberGroupValidationError, string> = {
  invalidNumber: 'Enter valid decimal numbers.',
  invalidBounds: 'End must be greater than Start.',
  invalidInterval: 'Interval must be greater than zero.',
  tooManyRanges: 'Use a larger interval to create at most 1,000 ranges.',
  precisionExceeded: 'These values exceed the supported decimal precision.',
};

function rangeDraft(configuration: NumberGroupConfiguration): RangeDraft {
  return {
    range_start: configuration.range_start,
    range_end: configuration.range_end,
    range_interval: configuration.range_interval,
  };
}

function sameRange(left: RangeDraft, right: RangeDraft) {
  return RANGE_FIELDS.every(({ key }) => left[key] === right[key]);
}

export function NumberGroupSettings({
  configuration,
  onChange,
  testIdPrefix = 'grid',
}: {
  configuration: NumberGroupConfiguration;
  onChange: (configuration: NumberGroupConfiguration) => void;
  testIdPrefix?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [appliedRange, setAppliedRange] = useState(() => rangeDraft(configuration));
  const [draft, setDraft] = useState(() => rangeDraft(configuration));
  const [error, setError] = useState<NumberGroupValidationError | null>(null);
  const hasEdits = !sameRange(draft, appliedRange);

  // Yjs group metadata refreshes often while rows move. Only adopt a changed
  // saved range, and retain an unfinished draft and its input selection.
  if (!sameRange(configuration, appliedRange)) {
    const incoming = rangeDraft(configuration);

    setAppliedRange(incoming);
    if (!hasEdits) setDraft(incoming);
  }

  const selectMode = (mode: NumberGroupMode) => {
    if (configuration.mode === mode) return;

    setDraft(rangeDraft(configuration));
    setError(null);
    onChange({ ...configuration, mode });
  };

  const applyRange = () => {
    const result = validateNumberGroupConfiguration({ ...configuration, ...draft });

    if (!result.valid) {
      setError(result.error);
      return;
    }

    setDraft(rangeDraft(result.configuration));
    setError(null);
    onChange(result.configuration);
  };

  const updateDraft = (key: keyof RangeDraft, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setError(null);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>, key: keyof RangeDraft) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      applyRange();
      return;
    }

    if (['Escape', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;

    // Keep editing and caret keys out of Radix's menu typeahead/submenu logic.
    event.stopPropagation();
    if (event.key !== ' ') return;

    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;

    updateDraft(key, `${input.value.slice(0, start)} ${input.value.slice(end)}`);
    window.setTimeout(() => input.setSelectionRange(start + 1, start + 1));
  };

  return (
    <>
      <DropdownMenuLabel>{t('board.numberGrouping.title', 'Group numbers by')}</DropdownMenuLabel>
      {configuration.mode === NumberGroupMode.Legacy ? (
        <p className='px-3 py-1 text-xs text-text-secondary' data-testid={`${testIdPrefix}-number-group-legacy`}>
          {t('board.numberGrouping.legacy', 'Automatic ranges of 100')}
        </p>
      ) : null}
      {[
        { mode: NumberGroupMode.Exact, name: 'exact', label: 'Exact value' },
        { mode: NumberGroupMode.Range, name: 'range', label: 'Range' },
      ].map(({ mode, name, label }) => (
        <DropdownMenuItem
          aria-checked={configuration.mode === mode}
          data-testid={`${testIdPrefix}-number-group-mode-${name}`}
          key={name}
          onSelect={(event) => {
            event.preventDefault();
            selectMode(mode);
          }}
          role='menuitemradio'
        >
          {t(`board.numberGrouping.${name}`, label)}
          {configuration.mode === mode ? <DropdownMenuItemTick /> : null}
        </DropdownMenuItem>
      ))}
      {configuration.mode === NumberGroupMode.Range ? (
        <div className='space-y-2 px-3 py-2'>
          {RANGE_FIELDS.map(({ key, name, label }) => (
            <label className='flex items-center gap-3 text-sm text-text-primary' htmlFor={`${id}-${name}`} key={key}>
              <span className='min-w-[52px]'>{t(`board.numberGrouping.${name}`, label)}</span>
              <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
                <Input
                  aria-describedby={error ? `${id}-error` : undefined}
                  aria-invalid={error !== null}
                  className='w-full cursor-text'
                  data-testid={`${testIdPrefix}-number-group-${name}`}
                  id={`${id}-${name}`}
                  inputMode='decimal'
                  onChange={(event) => updateDraft(key, event.target.value)}
                  onKeyDown={(event) => handleInputKeyDown(event, key)}
                  role='textbox'
                  type='text'
                  value={draft[key]}
                />
              </DropdownMenuItem>
            </label>
          ))}
          {error ? (
            <p
              className='text-xs text-text-error'
              data-testid={`${testIdPrefix}-number-group-validation`}
              id={`${id}-error`}
              role='alert'
            >
              {t(`board.numberGrouping.${error}`, ERROR_MESSAGES[error])}
            </p>
          ) : null}
          <DropdownMenuItem
            asChild
            disabled={!hasEdits}
            onSelect={(event) => {
              event.preventDefault();
              applyRange();
            }}
          >
            <Button
              className='w-full'
              data-testid={`${testIdPrefix}-number-group-apply`}
              disabled={!hasEdits}
              role='button'
              size='sm'
              type='button'
            >
              {t('button.apply', 'Apply')}
            </Button>
          </DropdownMenuItem>
        </div>
      ) : null}
      <DropdownMenuLabel>{t('board.numberGrouping.sort', 'Sort groups')}</DropdownMenuLabel>
      {[false, true].map((descending) => (
        <DropdownMenuItem
          aria-checked={configuration.sort_descending === descending}
          data-testid={`${testIdPrefix}-number-group-sort-${descending ? 'descending' : 'ascending'}`}
          key={String(descending)}
          onSelect={(event) => {
            event.preventDefault();
            if (configuration.sort_descending !== descending) {
              onChange({ ...configuration, sort_descending: descending });
            }
          }}
          role='menuitemradio'
        >
          {descending ? t('grid.sort.descending', 'Descending') : t('grid.sort.ascending', 'Ascending')}
          {configuration.sort_descending === descending ? <DropdownMenuItemTick /> : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}
