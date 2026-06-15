import { useEffect, useState } from 'react';

import TabbarSkeleton from '@/components/_shared/skeleton/TabbarSkeleton';
import TitleSkeleton from '@/components/_shared/skeleton/TitleSkeleton';

function GridSkeleton({ includeTitle = true, includeTabs = true }: { includeTitle?: boolean; includeTabs?: boolean }) {
  const [rows, setRows] = useState(3);
  const columns = 10;

  useEffect(() => {
    const updateRows = () => {
      setRows(Math.max(Math.ceil(window.innerHeight / 100), 3));
    };

    updateRows();
    window.addEventListener('resize', updateRows);
    return () => window.removeEventListener('resize', updateRows);
  }, []);

  return (
    <div className={`w-full min-w-0  max-w-full overflow-x-auto px-24 max-sm:px-6 ${includeTitle ? 'py-2' : ''}`}>
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
        <div className='overflow-x-auto'>
          <table className='min-w-full'>
            <thead>
              <tr>
                {[...Array(columns)].map((_, index) => (
                  <th key={index} className='border-b border-border-primary bg-bg-base px-6 py-3'>
                    <div className='h-6 animate-pulse rounded bg-fill-content-hover'></div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(rows)].map((_, rowIndex) => (
                <tr key={rowIndex}>
                  {[...Array(columns)].map((_, colIndex) => (
                    <td key={colIndex} className='border-b border-border-primary px-6 py-4'>
                      <div className='h-5 animate-pulse rounded bg-fill-content-hover'></div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default GridSkeleton;
