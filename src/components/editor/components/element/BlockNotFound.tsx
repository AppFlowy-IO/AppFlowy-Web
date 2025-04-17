import { UnSupportedBlock } from '@/components/editor/components/element/UnSupportedBlock';
import { EditorElementProps } from '@/components/editor/editor.type';
import React, { forwardRef } from 'react';
import { Alert } from '@mui/material';

export const BlockNotFound = forwardRef<HTMLDivElement, EditorElementProps>(({ node, children }, ref) => {
  const type = node.type;

  if (import.meta.env.DEV) {
    if (type === 'block_not_found') {
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

    return <UnSupportedBlock
      ref={ref}
      node={node}
    >{children}</UnSupportedBlock>;
  }

  return <div
    className={'w-full h-0 select-none'}
    ref={ref}
    contentEditable={false}
  />;
});
