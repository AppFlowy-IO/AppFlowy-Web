import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartSettingsSubPage } from '../ChartSettingsSubPage';

export interface ChartBuckets {
  size: number | null;
  min: number | null;
  max: number | null;
}

export interface BucketsPageProps {
  title: string;
  value: ChartBuckets;
  /** The range groups the chart draws now, for the preview line. */
  ranges: ReadonlyArray<{ key: string; label: string }>;
  onChange: (value: ChartBuckets) => void;
  onBack: () => void;
}

function parse(text: string): number | null | undefined {
  const trimmed = text.trim();

  if (trimmed === '') return null;
  const number = Number(trimmed);

  return Number.isFinite(number) ? number : undefined;
}

function BucketInput({
  testId,
  label,
  value,
  onCommit,
}: {
  testId: string;
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
}) {
  const { t } = useTranslation();
  const stored = value === null ? '' : String(value);
  const [draft, setDraft] = useState(stored);
  const [previous, setPrevious] = useState(stored);

  if (stored !== previous) {
    setPrevious(stored);
    setDraft(stored);
  }

  const commit = () => {
    const next = parse(draft);

    // Invalid input reverts; an empty field is Auto.
    if (next === undefined) {
      setDraft(stored);
      return;
    }

    if (next !== value) onCommit(next);
  };

  return (
    <label className='flex h-7 items-center gap-2 px-2 text-sm leading-5 text-text-primary'>
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      <input
        data-testid={testId}
        inputMode='decimal'
        value={draft}
        placeholder={t('chart.settings.auto', { defaultValue: 'Auto' })}
        className='h-7 w-24 rounded-[6px] border border-border-primary bg-transparent px-2 text-right text-sm leading-5 tabular-nums outline-none placeholder:text-text-tertiary focus:border-border-theme-thick'
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

/** The Ranges page of a Number X axis (WP11 §1.5): range size, start and end; empty is Auto. */
export function BucketsPage({ title, value, ranges, onChange, onBack }: BucketsPageProps) {
  const { t } = useTranslation();
  const bounded = ranges.filter((range) => range.key.startsWith('n:'));
  const from = bounded[0]?.label.split('–')[0];
  const lastLabel = bounded[bounded.length - 1]?.label ?? '';
  const to = lastLabel.includes('–') ? lastLabel.split('–')[1] : lastLabel;

  return (
    <ChartSettingsSubPage title={title} onBack={onBack}>
      <BucketInput
        testId='chart-bucket-size'
        label={t('chart.settings.rangeSize', { defaultValue: 'Range size' })}
        value={value.size}
        onCommit={(size) => onChange({ ...value, size })}
      />
      <BucketInput
        testId='chart-bucket-min'
        label={t('chart.settings.startAt', { defaultValue: 'Start at' })}
        value={value.min}
        onCommit={(min) => onChange({ ...value, min })}
      />
      <BucketInput
        testId='chart-bucket-max'
        label={t('chart.settings.endAt', { defaultValue: 'End at' })}
        value={value.max}
        onCommit={(max) => onChange({ ...value, max })}
      />
      {bounded.length > 0 ? (
        <div className='px-2 pb-1 pt-1 text-xs leading-4 text-text-tertiary' data-testid='chart-bucket-preview'>
          {t('chart.settings.rangesPreview', {
            defaultValue: '{{count}} ranges from {{from}} to {{to}}',
            count: bounded.length,
            from,
            to,
          })}
        </div>
      ) : null}
    </ChartSettingsSubPage>
  );
}

export default BucketsPage;
