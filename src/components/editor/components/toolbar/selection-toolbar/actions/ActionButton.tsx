import { Tooltip } from '@mui/material';
import IconButton, { IconButtonProps } from '@mui/material/IconButton';
import React, { forwardRef } from 'react';

const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    tooltip?: string | React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    children: React.ReactNode;
    active?: boolean;
  } & IconButtonProps
>(({ tooltip, onClick, disabled, children, active, className, ...props }, ref) => {
  return (
    <Tooltip disableInteractive={true} placement={'top'} title={tooltip}>
      <IconButton
        ref={ref}
        onClick={onClick}
        size={'small'}
        style={{
          color: active ? 'var(--text-action)' : disabled ? 'var(--line-on-toolbar)' : undefined,
        }}
        disabled={disabled}
        aria-label={typeof tooltip === 'string' ? tooltip : undefined}
        aria-pressed={active}
        {...props}
        className={`${
          className ?? ''
        } bg-transparent px-1 py-1 text-icon-on-toolbar hover:bg-transparent hover:text-text-action focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-action`}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
});

export default ActionButton;
