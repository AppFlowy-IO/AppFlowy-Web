import { Tooltip } from '@mui/material';
import IconButton, { IconButtonProps } from '@mui/material/IconButton';
import { forwardRef, ReactNode, MouseEvent } from 'react';

import { cn } from '@/lib/utils';

const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    tooltip?: string | ReactNode;
    onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
    children: ReactNode;
    active?: boolean;
  } & IconButtonProps
>(({ tooltip, onClick, disabled, children, active, className, ...props }, ref) => {
  return (
    <Tooltip
      disableInteractive={true}
      placement={'top'}
      title={tooltip}
    >
      <IconButton
        ref={ref}
        onClick={onClick}
        size={'large'}
        disabled={disabled}
        {...props}
        className={cn(
          className,
          'bg-transparent px-1.5 py-1.5 text-icon-primary hover:bg-fill-content-hover',
          active && 'bg-fill-theme-select'
        )}
      >
        <div className="min-w-5 h-5 flex items-center justify-center">
          {children}
        </div>
      </IconButton>
    </Tooltip>
  );
});

export default ActionButton;
