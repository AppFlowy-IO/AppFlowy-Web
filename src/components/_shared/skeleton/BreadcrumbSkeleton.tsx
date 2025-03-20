import React from 'react';
import { ReactComponent as RightIcon } from '@/assets/icons/alt_arrow_right.svg';

export const BreadcrumbsSkeleton = () => {
  return (
    <div className='flex items-center gap-1'>
      <div className='h-5 w-5 animate-pulse rounded-full bg-fill-list-hover'></div>
      <div className='w-15 h-5 animate-pulse rounded bg-fill-list-hover'></div>
      <RightIcon className='h-5 w-5 text-gray-400' />
      <div className='h-5 w-5 animate-pulse rounded-full bg-fill-list-hover'></div>
      <div className='h-5 w-20 animate-pulse rounded bg-fill-list-hover'></div>
      <RightIcon className='h-5 w-5 text-gray-400' />
      <div className='h-5 w-5 animate-pulse rounded-full bg-fill-list-hover'></div>
      <div className='h-5 w-24 animate-pulse rounded bg-fill-list-hover'></div>
    </div>
  );
};

export default BreadcrumbsSkeleton;
