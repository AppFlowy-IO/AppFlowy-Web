import { PopperPlacementType } from '@mui/material';
import React, { ReactElement, useMemo } from 'react';

import AppFlowyPower from '@/components/_shared/appflowy-power/AppFlowyPower';
import { RichTooltip } from '@/components/_shared/popover';

export function OutlinePopover({
  children,
  open,
  onClose,
  placement,
  onMouseEnter,
  onMouseLeave,
  content,
  variant = 'app',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactElement;
  placement?: PopperPlacementType;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  drawerWidth?: number;
  content: React.ReactNode;
  variant?: 'app' | 'publish';
}) {
  const popoverContent = useMemo(() => {
    return (
      <div
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={'appflowy-scroller flex h-fit max-h-[590px] w-[268px] flex-col overflow-y-auto overflow-x-hidden'}
      >
        {content}
        {variant === 'publish' && <AppFlowyPower />}
      </div>
    );
  }, [variant, onMouseEnter, onMouseLeave, content]);

  return (
    <RichTooltip
      PaperProps={{
        className: 'rounded-[14px] border border-tint-purple bg-background-primary m-2 overflow-hidden',
      }}
      open={open}
      onClose={onClose}
      content={popoverContent}
      placement={placement}
    >
      {children}
    </RichTooltip>
  );
}

export default OutlinePopover;
