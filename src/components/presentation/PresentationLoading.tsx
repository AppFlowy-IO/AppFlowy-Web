import { Button } from '@/components/ui/button';

/** Fills a presentation surface while its content loads, so opening it shows nothing else first. */
export default function PresentationLoading({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-4'>
      <p role='status' className='flex items-center gap-2 text-sm text-text-primary'>
        <span
          aria-hidden='true'
          className='h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-primary border-t-fill-theme-thick motion-reduce:animate-none'
        />
        {message}
      </p>
      <Button onClick={onClose}>Back to page</Button>
    </div>
  );
}
