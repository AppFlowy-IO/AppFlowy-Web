export function EditorSkeleton({ maxWidth = 952 }: { maxWidth?: number | null } = {}) {
  return (
    <div className='mt-2 w-full px-24 max-sm:px-6' style={{ maxWidth: maxWidth ?? undefined }}>
      <div className='mb-4 h-10 w-full animate-pulse bg-fill-content-hover'></div>
      <div className='mb-4 h-6 w-1/2 animate-pulse bg-fill-content-hover'></div>
      <div className='mb-4 h-8 w-3/5 animate-pulse bg-fill-content-hover'></div>
      <div className='mb-4 h-7 w-4/5 animate-pulse bg-fill-content-hover'></div>
      <div className='mb-2 h-5 w-full animate-pulse bg-fill-content-hover'></div>
      <div className='h-5 w-full animate-pulse bg-fill-content-hover'></div>
    </div>
  );
}

export default EditorSkeleton;
