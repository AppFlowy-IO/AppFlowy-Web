import { forwardRef } from 'react';
import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function DropdownMenu ({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal ({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  );
}

function DropdownMenuTrigger ({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  );
}

type DropdownMenuContentProps =
  React.ComponentProps<typeof DropdownMenuPrimitive.Content>
  & React.ComponentProps<typeof DropdownMenuPrimitive.Portal>

function DropdownMenuContent ({
  className,
  sideOffset = 4,
  container,
  forceMount,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal
      container={container}
      forceMount={forceMount}
    >
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        avoidCollisions
        className={cn(
          // Base colors and appearance
          'bg-background-primary text-text-primary',
          'z-50 min-w-[240px] rounded-400 p-2 shadow-menu',

          // Size constraints and overflow behavior
          'max-h-(--radix-dropdown-menu-content-available-height)',
          'origin-(--radix-dropdown-menu-content-transform-origin)',
          'overflow-x-hidden overflow-y-auto',

          // Animation states for opening/closing
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',

          // Position-based animations
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',

          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup ({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  );
}

const DropdownMenuItem = forwardRef<HTMLDivElement, React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}>(({
  className,
  inset,
  variant = 'default',
  disabled,
  ...props
}, ref) => {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        // Focus states
        'focus:bg-fill-content-hover hover:bg-fill-content-hover focus-visible:outline-none focus:text-text-primary',

        // Destructive variant styling
        'data-[variant=destructive]:text-text-error',
        'data-[variant=destructive]:focus:bg-fill-error-light',
        'data-[variant=destructive]:focus:text-text-error',
        'data-[variant=destructive]:*:[svg]:!text-text-error',

        // Base layout and appearance
        'relative flex cursor-pointer items-center gap-[10px] rounded-300 px-2 py-1 min-h-[32px]',
        'text-sm text-text-primary outline-hidden select-none',

        // Disabled state
        'data-[disabled]:pointer-events-none data-[disabled]:text-text-tertiary',

        // Inset variant (with left padding for icons)
        'data-[inset]:pl-8',

        // SVG/Icon styling
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:h-5 [&_svg]:w-5',
        disabled ? '[&_svg]:text-text-tertiary' : '[&_svg]:text-icon-primary',
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
});

function DropdownMenuLabel ({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        'px-2 py-1 text-xs flex items-center font-semibold  min-h-[32px] data-[inset]:pl-8 text-text-tertiary',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator ({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-2 my-2 border-border-primary border-t', className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut ({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'text-text-tertiary ml-auto text-xs tracking-widest',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub ({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger ({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        // Focus and open states
        'focus:bg-fill-content-hover hover:bg-fill-content-hover focus-visible:outline-none focus:text-text-primary',
        'data-[state=open]:bg-fill-content-hover data-[state=open]:text-text-primary',

        // Base layout and appearance
        'flex cursor-pointer items-center rounded-300 px-2 py-1 gap-[10px] min-h-[32px]',
        'text-sm outline-hidden select-none',

        // Inset variant (with left padding for icons)
        'data-[inset]:pl-8',

        // SVG/Icon styling
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:h-5 [&_svg]:w-5',

        // Disabled state
        'data-[disabled]:pointer-events-none data-[disabled]:text-text-tertiary',

        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto text-icon-tertiary h-5 w-3" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

const DropdownMenuSubContent = forwardRef<HTMLDivElement, React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>>(({
  className,
  ...props
}, ref) => {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      data-slot="dropdown-menu-sub-content"
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

        className,
      )}
      {...props}
    />
  );
});

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
