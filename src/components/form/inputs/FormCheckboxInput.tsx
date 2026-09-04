import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { cn } from '@/lib/utils';

/**
 * Bare checkbox toggle. Uses the same filled/unfilled assets as the
 * AppFlowy grid checkbox cell; the question title above carries the
 * meaning, so there is no inline label.
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
      role='checkbox'
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        'group flex h-5 w-5 items-center justify-center text-text-action',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fill-default/40',
      )}
    >
      {value ? (
        <CheckboxCheckSvg className='h-5 w-5' />
      ) : (
        <CheckboxUncheckSvg className='h-5 w-5 text-border-primary group-hover:text-border-primary-hover' />
      )}
    </button>
  );
}
