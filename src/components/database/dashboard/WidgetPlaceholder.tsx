import { useTranslation } from 'react-i18next';

import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as LockIcon } from '@/assets/icons/lock.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export type WidgetPlaceholderReason = 'loading' | 'not-found' | 'no-access' | 'unsupported';

interface WidgetPlaceholderProps {
  reason: WidgetPlaceholderReason;
  /** Shows the remove button (Edit mode, for broken widgets). */
  onRemove?: () => void;
  className?: string;
}

/**
 * Body of a widget that cannot render its view: still loading, deleted,
 * inaccessible, or a nested dashboard.
 */
export function WidgetPlaceholder({ reason, onRemove, className }: WidgetPlaceholderProps) {
  const { t } = useTranslation();

  const message = (() => {
    switch (reason) {
      case 'loading':
        return t('dashboard.widget.loading', { defaultValue: 'Loading…' });
      case 'no-access':
        return t('dashboard.widget.noAccess', { defaultValue: "You don't have access to this database" });
      case 'unsupported':
        return t('dashboard.widget.unsupported', { defaultValue: "A dashboard can't be shown inside a dashboard" });
      default:
        return t('dashboard.widget.notFound', { defaultValue: 'This view no longer exists' });
    }
  })();

  return (
    <div
      aria-busy={reason === 'loading' || undefined}
      className={cn(
        'flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-4 py-6 text-center text-sm text-text-secondary',
        className
      )}
      data-reason={reason}
      data-testid='dashboard-widget-placeholder'
      role={reason === 'loading' ? 'status' : undefined}
    >
      {reason === 'loading' ? (
        <Progress variant='inherit' />
      ) : reason === 'no-access' ? (
        <LockIcon aria-hidden='true' className='h-6 w-6 text-icon-tertiary' />
      ) : (
        <WarningIcon aria-hidden='true' className='h-6 w-6 text-icon-tertiary' />
      )}
      <span className='max-w-[320px]'>{message}</span>
      {onRemove && reason !== 'loading' ? (
        <Button
          className='mt-1'
          data-testid='dashboard-widget-remove-button'
          onClick={onRemove}
          size='sm'
          type='button'
          variant='outline'
        >
          <DeleteIcon aria-hidden='true' className='h-4 w-4' />
          {t('dashboard.widget.remove', { defaultValue: 'Remove widget' })}
        </Button>
      ) : null}
    </div>
  );
}

export default WidgetPlaceholder;
