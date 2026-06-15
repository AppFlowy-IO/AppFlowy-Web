import * as LabelPrimitive from '@radix-ui/react-label';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Label ({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        // Typography and base appearance
        'text-text-tertiary text-xs leading-[16px] font-medium',

        // Layout
        'flex items-center gap-2',

        // Interaction
        'select-none',

        // Disabled states (for parent group)
        'group-data-[disabled=true]:pointer-events-none',
        'group-data-[disabled=true]:opacity-50',

        // Disabled states (for peer elements)
        'peer-disabled:cursor-not-allowed',
        'peer-disabled:opacity-50',

        className,
      )}
      {...props}
    />
  );
}

export { Label };
