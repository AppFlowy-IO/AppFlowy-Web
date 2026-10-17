import { ComponentProps, forwardRef } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Shared Figma toolbar geometry for page icon, cover, and verification actions. */
const HeaderToolbarButton = forwardRef<HTMLButtonElement, ComponentProps<typeof Button>>(
  ({ className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant='ghost'
      size='sm'
      className={cn('h-7 min-w-[76px] gap-1.5 px-2 py-1 text-sm font-medium leading-5', className)}
    />
  )
);

HeaderToolbarButton.displayName = 'HeaderToolbarButton';

export default HeaderToolbarButton;
