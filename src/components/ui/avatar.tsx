import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { getImageUrl, revokeBlobUrl } from '@/utils/authenticated-image';
import { Log } from '@/utils/log';

const avatarVariants = cva('relative flex aspect-square shrink-0 overflow-hidden', {
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
      xs: 'h-5 text-xs leading-[16px] text-icon-primary font-normal',
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
});

function Avatar({
  className,
  size,
  variant,
  shape = 'circle',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & VariantProps<typeof avatarVariants>) {
  return (
    <AvatarPrimitive.Root
      data-slot='avatar'
      className={cn(
        avatarVariants({
          size,
          variant,
          shape,
        }),
        className
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, src, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  const [authenticatedSrc, setAuthenticatedSrc] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(false);
  const blobUrlRef = React.useRef<string>('');

  React.useEffect(() => {
    if (!src) {
      setAuthenticatedSrc('');
      return;
    }

    let isMounted = true;

    setIsLoading(true);

    Log.debug('[AvatarImage] src', src);
    getImageUrl(src)
      .then((url) => {
        if (isMounted) {
          setAuthenticatedSrc(url);
          blobUrlRef.current = url;
          setIsLoading(false);
        }
      })
      .catch((error) => {
        console.error('Failed to load avatar image:', error);
        if (isMounted) {
          setAuthenticatedSrc('');
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      // Clean up blob URL if it was created
      if (blobUrlRef.current) {
        revokeBlobUrl(blobUrlRef.current);
        blobUrlRef.current = '';
      }
    };
  }, [src]);

  return (
    <AvatarPrimitive.Image
      data-slot='avatar-image'
      data-testid='avatar-image'
      className={cn('aspect-square size-full', isLoading && 'opacity-0', className)}
      src={authenticatedSrc}
      {...props}
    />
  );
}

// return a number between 0 and 19
function hashUsername(username: string) {
  let hash = 0;

  for (let i = 0; i < username.length; i++) {
    const char = username.charCodeAt(i);

    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash) % 20;
}

function getFallbackColor(username: string) {
  const hash = hashUsername(username) + 1;

  return {
    backgroundColor: `var(--badge-color-${hash}-light-2)`,
    color: `var(--badge-color-${hash}-thick-3)`,
  };
}

interface AvatarFallbackProps extends React.ComponentProps<typeof AvatarPrimitive.Fallback> {
  name?: string;
}

function AvatarFallback({ className, name, children, ...props }: AvatarFallbackProps) {
  const isString = typeof children === 'string';
  const char = isString ? children.charAt(0).toUpperCase() : '';
  const { backgroundColor, color } = getFallbackColor(isString ? children : name || '');

  return (
    <AvatarPrimitive.Fallback
      data-slot='avatar-fallback'
      className={cn('flex h-full w-full items-center justify-center text-icon-primary', className)}
      {...props}
      style={{
        backgroundColor,
        color,
        ...props.style,
      }}
    >
      {!isString ? children : char}
    </AvatarPrimitive.Fallback>
  );
}

export { Avatar, AvatarFallback, AvatarImage };

