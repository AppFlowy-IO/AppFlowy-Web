import { Button } from '@/components/ui/button';

/** Every presentation paywall uses the workspace's existing plan comparison flow. */
export default function PresentationPaywall({ message, onUpgrade }: { message: string; onUpgrade: () => void }) {
  return (
    <div
      role='status'
      className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-primary bg-surface-primary p-3 text-sm text-text-secondary'
    >
      <span className='min-w-0 flex-1'>{message}</span>
      <Button variant='outline' onClick={onUpgrade}>
        Upgrade to Pro
      </Button>
    </div>
  );
}
