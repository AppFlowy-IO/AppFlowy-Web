import { MutableRefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';

export interface NumberChartTitleInputProps {
  value: string;
  /** The auto caption, shown as the placeholder. */
  placeholder?: string;
  onCommit: (value: string) => void;
  /** Set when Escape (or losing edit rights) removes the input: the draft is discarded. */
  cancelledRef: MutableRefObject<boolean>;
}

/**
 * Title input for the Number chart. Keeps a local draft and commits on blur,
 * Enter or unmount so every keystroke doesn't create a Yjs transaction / undo
 * step. Closing the menu removes the focused input without a blur event, so
 * the unmount save keeps the draft; Escape (flagged in `cancelledRef`)
 * discards it.
 */
export function NumberChartTitleInput({ value, placeholder, onCommit, cancelledRef }: NumberChartTitleInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);

  // Follow a new stored title (a save, undo, a collaborator) during render,
  // keeping the same input (and its focus). An unsaved draft is kept.
  if (value !== previousValue) {
    setPreviousValue(value);
    if (draft === previousValue) setDraft(value);
  }

  // The unmount save reads the last render. `writtenRef` holds the title
  // written until it comes back as `value`, so a blur and an unmount before
  // that write only once.
  const latestRef = useRef({ draft, value, onCommit });
  const writtenRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (latestRef.current.value !== value) writtenRef.current = null;
    latestRef.current = { draft, value, onCommit };
  });

  const commit = useCallback(() => {
    const latest = latestRef.current;

    if (latest.draft === latest.value || latest.draft === writtenRef.current) return;
    writtenRef.current = latest.draft;
    latest.onCommit(latest.draft);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      if (!cancelledRef.current) commit();
    };
  }, [cancelledRef, commit]);

  return (
    <div className='px-2 pb-1'>
      <Input
        data-testid='chart-number-title-input'
        aria-label={t('chart.settings.chartTitle', { defaultValue: 'Chart title' })}
        value={draft}
        placeholder={placeholder || t('chart.number.titlePlaceholder', { defaultValue: 'Default title' })}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className='h-7 w-full'
      />
    </div>
  );
}

export default NumberChartTitleInput;
