import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cva } from 'class-variance-authority';
import * as React from 'react';
import { forwardRef } from 'react';

import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { cn } from '@/lib/utils';

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot='dropdown-menu' {...props} />;
}

function DropdownMenuPortal({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot='dropdown-menu-portal' {...props} />;
}

const DropdownMenuTrigger = forwardRef<HTMLButtonElement, React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>>(
  ({ ...props }, ref) => {
    return <DropdownMenuPrimitive.Trigger data-slot='dropdown-menu-trigger' {...props} ref={ref} />;
  }
);

type DropdownMenuContentProps = React.ComponentProps<typeof DropdownMenuPrimitive.Content> &
  React.ComponentProps<typeof DropdownMenuPrimitive.Portal>;

function DropdownMenuContent({ className, sideOffset = 4, container, forceMount, ...props }: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal container={container} forceMount={forceMount}>
      <DropdownMenuPrimitive.Content
        data-slot='dropdown-menu-content'
        sideOffset={sideOffset}
        avoidCollisions
        className={cn(
          // Base colors and appearance
          'border border-border-primary bg-background-primary text-text-primary',
          'z-50 min-w-[240px] rounded-400 p-2 shadow-menu',

          // Size constraints and overflow behavior
          'max-h-(--radix-dropdown-menu-content-available-height)',
          'origin-(--radix-dropdown-menu-content-transform-origin)',
          'overflow-y-auto overflow-x-hidden',

          // Animation states for opening/closing
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',

          // Position-based animations
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',

          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

const DropdownMenuGroup = ({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) => {
  return <DropdownMenuPrimitive.Group data-slot='dropdown-menu-group' {...props} />;
};

const dropdownMenuItemVariants = cva(
  cn(
    'focus:bg-fill-content-hover hover:bg-fill-content-hover focus-visible:outline-none',
    'relative flex cursor-pointer items-center gap-2 rounded-300 px-2 py-1.5 min-h-[32px]',
    'text-sm text-text-primary outline-hidden select-none',

    // Disabled state
    'data-[disabled]:pointer-events-none data-[disabled]:text-text-tertiary',

    // Inset variant (with left padding for icons)
    'data-[inset]:pl-8',

    // SVG/Icon styling
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:h-5 [&_svg]:w-5'
  ),
  {
    variants: {
      variant: {
        default: 'text-text-primary',
        destructive: 'hover:text-text-error hover:*:[svg]:!text-text-error',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);
const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
    className?: string;
    inset?: boolean;
    variant?: 'default' | 'destructive';
  }
>(({ className, inset, variant = 'default', disabled, ...props }, ref) => {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-slot='dropdown-menu-item'
      data-inset={inset}
      data-variant={variant}
      className={cn(dropdownMenuItemVariants({ variant }), disabled ? '[&_svg]:text-text-tertiary' : '', className)}
      disabled={disabled}
      {...props}
    />
  );
});

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'relative flex items-center rounded-[8px] px-2 py-1.5',
      'cursor-default select-none text-sm',
      'outline-none transition-colors focus:bg-fill-content-hover',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      'data-[state=checked]:bg-fill-theme-select',
      className
    )}
    {...props}
  >
    {children}
  </DropdownMenuPrimitive.RadioItem>
));

DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot='dropdown-menu-label'
      data-inset={inset}
      className={cn(
        'flex min-h-[32px] items-center px-2 py-1 text-xs  font-medium text-text-tertiary data-[inset]:pl-8',
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot='dropdown-menu-separator'
      className={cn('-mx-2 my-2 border-t border-border-primary', className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot='dropdown-menu-shortcut'
      className={cn('ml-auto text-xs tracking-widest text-text-tertiary', className)}
      {...props}
    />
  );
}

function DropdownMenuItemTick({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot='dropdown-menu-tick'
      className={cn('ml-auto tracking-widest text-icon-info-thick', className)}
      {...props}
    >
      <CheckIcon />
    </span>
  );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot='dropdown-menu-sub' {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot='dropdown-menu-sub-trigger'
      data-inset={inset}
      className={cn(
        // Focus and open states
        'focus:bg-fill-content-hover focus:text-text-primary focus-visible:outline-none',
        'data-[state=open]:bg-fill-content-hover data-[state=open]:text-text-primary',

        // Base layout and appearance
        'flex min-h-[32px] cursor-pointer items-center gap-[10px] rounded-300 px-2 py-1',
        'outline-hidden select-none text-sm',

        // Inset variant (with left padding for icons)
        'data-[inset]:pl-8',

        // SVG/Icon styling
        '[&_svg]:pointer-events-none [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0',

        // Disabled state
        'data-[disabled]:pointer-events-none data-[disabled]:text-text-tertiary',

        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className='ml-auto h-5 w-3 text-icon-tertiary' />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

const DropdownMenuSubContent = forwardRef<HTMLDivElement, React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>>(
  ({ className, ...props }, ref) => {
    return (
      <DropdownMenuPrimitive.SubContent
        ref={ref}
        data-slot='dropdown-menu-sub-content'
        className={cn(
          // Base colors and appearance
          'bg-background-primary text-text-primary',
          'z-50 min-w-[240px] rounded-400 p-2 shadow-menu',
          'origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden',

          // Animation states for opening/closing
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',

          // Position-based animations
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=right]:ml-2',
          'data-[side=top]:slide-in-from-bottom-2',

          className
        )}
        {...props}
      />
    );
  }
);

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuRadioItem,
  dropdownMenuItemVariants,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
};
