import { Skeleton } from '@mui/material';
import React from 'react';

function PublishPagesSkeleton () {
  return (
    <>
      {
        Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className={'w-full px-1 flex text-sm font-medium items-center gap-4'}
          >
            {
              Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className={'flex-1'}
                >
                  <Skeleton
                    height={24}
                    variant={'text'}
                    width={100}
                  />
                </div>
              ))
            }
          </div>))
      }
    </>
  );
}

export default PublishPagesSkeleton;