import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Bare checkbox toggle. Matches the desktop preview's stand-alone
 * checkbox (no inline label — the question title above carries the
 * meaning, just like Notion).
 */
export function FormCheckboxInput({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type='button'
      aria-pressed={value}
      onClick={() => onChange(!value)}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded border-2 transition-colors',
        value
          ? 'border-fill-default bg-fill-default text-text-on-fill'
          : 'border-line-divider hover:border-fill-default',
      )}
    >
      {value && <Check size={14} strokeWidth={3} />}
    </button>
  );
}
