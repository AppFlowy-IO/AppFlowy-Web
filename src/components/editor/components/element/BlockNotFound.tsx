import { Alert } from '@mui/material';
import { forwardRef } from 'react';

import { UnSupportedBlock } from '@/components/editor/components/element/UnSupportedBlock';
import { EditorElementProps } from '@/components/editor/editor.type';

export const BlockNotFound = forwardRef<HTMLDivElement, EditorElementProps>(({ node, children, ...attributes }, ref) => {
  const type = node.type;

  // Special case for blocks that reference deleted/moved blocks (dev only)
  if (import.meta.env.DEV && type === 'block_not_found') {
    return (
      <div
        className={'my-1 w-full select-none'}
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

  // Show unsupported block component for all unknown block types
  return (
    <UnSupportedBlock
      ref={ref}
      node={node}
      {...attributes}
    >
      {children}
    </UnSupportedBlock>
  );
});
