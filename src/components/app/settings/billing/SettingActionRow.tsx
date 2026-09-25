import { Button } from '@/components/ui/button';

interface SettingActionRowProps {
  label: string;
  description?: string;
  buttonLabel: string;
  onClick: () => void;
  variant?: 'default' | 'outline';
  disabled?: boolean;
  testId?: string;
}

/** A labelled setting with one right-aligned action, the row layout of the desktop billing page. */
export function SettingActionRow({
  label,
  description,
  buttonLabel,
  onClick,
  variant = 'default',
  disabled,
  testId,
}: SettingActionRowProps) {
  return (
    <div className='flex items-center justify-between gap-4'>
      <div className='flex min-w-0 flex-col gap-1'>
        <div className='text-sm font-medium text-text-primary'>{label}</div>
        {description && <div className='text-xs text-text-secondary'>{description}</div>}
      </div>
      <Button
        variant={variant}
        size='default'
        className='min-w-[120px] shrink-0'
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
