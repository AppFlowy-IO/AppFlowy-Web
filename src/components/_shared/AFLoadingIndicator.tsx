import LoadingDots from '@/components/_shared/LoadingDots';
import { cn } from '@/lib/utils';

/** AppFlowy's three-dot progress indicator with an announced status label. */
export default function AFLoadingIndicator({ label, className }: {
  label: string;
  className?: string;
}) {
  return (
    <div role='status' aria-live='polite' aria-atomic='true' className={cn('flex flex-col items-center gap-3', className)}>
      <div aria-hidden='true'><LoadingDots /></div>
      <span className='text-sm text-text-primary'>{label}</span>
    </div>
  );
}
