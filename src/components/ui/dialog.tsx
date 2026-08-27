import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';
import * as React from 'react';
import { forwardRef } from 'react';

import { ReactComponent as XIcon } from '@/assets/icons/close.svg';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot='dialog' {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot='dialog-trigger' {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot='dialog-portal' {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot='dialog-close' {...props} />;
}

const DialogOverlay = forwardRef<HTMLDivElement>(
  ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>, ref) => {
    return (
      <DialogPrimitive.Overlay
        ref={ref}
        data-slot='dialog-overlay'
        className={cn(
          // Positioning and stacking
          'fixed inset-0 z-50',

          // Background styling
          'bg-surface-overlay', // Semi-transparent black background

          // Enter animation only — no exit animation to avoid blocking
          // react-remove-scroll unmount (which releases pointer-events on body)
          'data-[state=open]:animate-in',
          'data-[state=open]:fade-in-0',

          className
        )}
        {...props}
      />
    );
  }
);

const dialogVariants = cva(
  cn(
    // Base appearance
    'bg-background-primary rounded-500 shadow-dialog',

    // Positioning and sizing
    'fixed top-[50%] left-[50%] z-50',
    'translate-x-[-50%] translate-y-[-50%]', // Center perfectly
    'max-w-[calc(100%-2rem)] sm:max-w-lg', // Responsive width
    'max-h-[85vh]',
    'focus:outline-hidden focus-visible:outline-none',

    // Internal layout
    'grid px-5 py-4',

    // Animation settings
    'duration-200',

    // Enter animation only — no exit animation to avoid blocking
    // react-remove-scroll unmount (which releases pointer-events on body)
    'data-[state=open]:animate-in',
    'data-[state=open]:fade-in-0',
    'data-[state=open]:zoom-in-95',
    // Keep the -50% centering translate during the enter keyframes,
    // otherwise the animation starts with the top-left corner at screen center
    'data-[state=open]:slide-in-from-left-1/2',
    'data-[state=open]:slide-in-from-top-1/2'
  ),
  {
    variants: {
      size: {
        xs: 'w-[300px]',
        sm: 'w-[400px]',
        md: 'w-[560px]',
        lg: 'w-[720px] sm:max-w-[720px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

function DialogContent({
  className,
  children,
  size,
  showCloseButton = true,
  closeLabel = 'Close',
  closeButtonClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showCloseButton?: boolean;
  closeLabel?: string;
  closeButtonClassName?: string;
}) {
  return (
    <DialogPortal data-slot='dialog-portal'>
      <DialogOverlay />
      <DialogPrimitive.Content data-slot='dialog-content' className={cn(dialogVariants({ size, className }))} {...props}>
        {children}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className={cn(
            buttonVariants({ size: 'icon-lg', variant: 'ghost' }),
            // Positioning
            'absolute right-5 top-3.5',
            showCloseButton ? 'visible' : 'invisible',

            // Base styling
            'rounded-300 text-icon-primary',

            // Interactive states
            'focus:outline-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick',
            'disabled:pointer-events-none disabled:text-text-tertiary',

            // Open state styling
            'data-[state=open]:bg-fill-secondary data-[state=open]:text-icon-primary',

            // Transition
            'transition-opacity',

            // SVG specific styling
            '[&_svg]:pointer-events-none [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0',
            closeButtonClassName
          )}
        >
          <XIcon aria-hidden='true' />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='dialog-header' className={cn('mb-3 flex flex-col gap-3 text-left', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-footer'
      className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot='dialog-title' className={cn('text-base font-bold', className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
      className={cn('text-sm font-normal text-text-primary', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
