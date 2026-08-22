import LoadingDots from '@/components/_shared/LoadingDots';

/**
 * Full-viewport loading state shared by route-chunk and workspace bootstrap
 * fallbacks so both phases of startup look identical.
 */
export function FullScreenLoading({ label }: { label: string }) {
  return (
    <div
      role='status'
      aria-label={label}
      className='fixed inset-0 flex items-center justify-center bg-background-primary'
    >
      <LoadingDots className='flex items-center justify-center' />
    </div>
  );
}

export default FullScreenLoading;
