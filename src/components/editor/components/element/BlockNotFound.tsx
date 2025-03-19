import { EditorElementProps } from '@/components/editor/editor.type';
import React, { forwardRef } from 'react';
import { Alert } from '@mui/material';

export const BlockNotFound = forwardRef<HTMLDivElement, EditorElementProps>(({ node }, ref) => {
  if(import.meta.env.DEV) {
    return (
      <div
        className={'w-full my-1 select-none'}
        ref={ref}
        contentEditable={false}
      >
        <Alert
          className={'h-fit w-full'}
          severity={'error'}
        >
          <div className={'text-base'}>{`Block not found, id is ${node.blockId}`}</div>
          <div>
            {'It might be deleted or moved to another place but the children map is still referencing it.'}
          </div>
        </Alert>
      </div>
    );
  }

  return <div
    className={'w-full h-0 select-none'}
    ref={ref}
    contentEditable={false}
  />;
});
