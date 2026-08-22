import TabbarSkeleton from '@/components/_shared/skeleton/TabbarSkeleton';
import TitleSkeleton from '@/components/_shared/skeleton/TitleSkeleton';

function KanbanSkeleton({ includeTitle = true, includeTabs = true }: { includeTitle?: boolean; includeTabs?: boolean }) {
  const columns = Math.max(Math.ceil(window.innerWidth / 420), 3);
  const cardsPerColumn = Math.max(Math.ceil(window.innerHeight / 300), 3);

  return (
    <div
      data-testid='kanban-skeleton'
      className={`appflowy-custom-scroller w-full overflow-x-auto py-${
        includeTitle ? '2' : '0'
      }  min-w-0 max-w-full px-24 max-sm:px-6`}
    >
      {includeTitle && (
        <>
          <div className='my-6 mb-2 flex h-20 w-full items-center'>
            <TitleSkeleton />
          </div>
        </>
      )}
      {includeTabs && (
        <div className='mb-2 flex h-10 w-full items-center'>
          <TabbarSkeleton />
        </div>
      )}

      <div className='mt-2 w-full'>
        <div className='flex space-x-4'>
          {[...Array(columns)].map((_, columnIndex) => (
            <div
              key={columnIndex}
              className='flex min-w-[280px] flex-col rounded-lg bg-background-primary p-4 shadow-md'
            >
              {/* Column title */}
              <div className='mb-4 h-8 w-3/5 animate-pulse rounded bg-fill-content-hover'></div>

              {/* Cards */}
              {[...Array(cardsPerColumn)].map((_, cardIndex) => (
                <div key={cardIndex} className='mb-4 rounded-lg bg-bg-base p-4 shadow'>
                  <div className='mb-2 h-5 w-full animate-pulse rounded bg-fill-content-hover'></div>
                  <div className='h-4 w-4/5 animate-pulse rounded bg-fill-content-hover'></div>
                  <div className='mt-4 flex items-center justify-between'>
                    <div className='h-8 w-8 animate-pulse rounded-full bg-fill-content-hover'></div>
                    <div className='h-4 w-16 animate-pulse rounded bg-fill-content-hover'></div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default KanbanSkeleton;
