import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';

import { cn } from '@/lib/utils';

const avatarVariants = cva(
  'relative flex aspect-square shrink-0 overflow-hidden',
  {
    variants: {
      shape: {
        circle: 'rounded-full',
        square: 'rounded-200',
      },
      variant: {
        default: 'bg-transparent',
        outline: 'border-[1.5px] bg-transparent border-border-primary',
      },
      size: {
        sm: 'h-6 text-xs leading-[16px] text-icon-primary font-normal',
        md: 'h-8 text-sm font-normal',
        xl: 'h-20 text-2xl font-normal',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      shape: 'circle',
    },
  },
);

function Avatar ({
  className,
  size,
  variant,
  shape = 'circle',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & VariantProps<typeof avatarVariants>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        avatarVariants({
          size,
          variant,
          shape,
        }),
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage ({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  );
}

function AvatarFallback ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  const isString = typeof children === 'string';
  const char = isString ? children.charAt(0) : '';

  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex text-icon-primary w-full h-full items-center justify-center',
        isString ? 'bg-fill-secondary' : '',
        className,
      )}
      {...props}
    >{!isString ? children : char}</AvatarPrimitive.Fallback>
  );
}

export { Avatar, AvatarImage, AvatarFallback };
