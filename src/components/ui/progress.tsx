import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const progressVariants = cva(
  'relative block',
  {
    variants: {
      variant: {
        default: '',
        inherit: '',
        primary: '',
      },
      isIndeterminate: {
        true: 'animate-progress-container',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      isIndeterminate: false,
    },
  },
);

const circleVariants = cva(
  'fill-fill-content h-5 w-5',
  {
    variants: {
      variant: {
        default: 'stroke-fill-secondary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const progressCircleVariants = cva(
  'fill-fill-content transition-all h-5 w-5',
  {
    variants: {
      variant: {
        default: 'stroke-text-on-fill',
        inherit: 'stroke-icon-primary',
        primary: 'stroke-text-action',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface ProgressProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof progressVariants> {
  /** Progress value between 0 and 100. When undefined, shows indeterminate state */
  value?: number;
  /** Line ending style */
  strokeLinecap?: 'round' | 'square';
}

export function Progress ({
  value,
  variant = 'default',
  strokeLinecap = 'round',
  className,
  ...props
}: ProgressProps) {
  // Calculate dimensions based on size variant
  const dimensions: number = 20;

  const strokeWidth = 2.5;

  const radius = dimensions / 2 - strokeWidth;
  const circumference = Math.ceil(2 * Math.PI * radius);
  const isIndeterminate = value === undefined;

  // Calculate percentage offset for the progress circle
  const offset = isIndeterminate
    ? circumference * 0.25 // 25% offset for indeterminate state
    : Math.ceil(circumference * ((100 - Math.min(Math.max(0, value || 0), 100)) / 100));

  // Calculate viewBox to add padding around the circles
  const viewBox = `-${dimensions * 0.125} -${dimensions * 0.125} ${dimensions * 1.25} ${
    dimensions * 1.25
  }`;

  return (
    <div
      className={cn(progressVariants({ variant, isIndeterminate, className }))}
      {...props}
    >
      <svg
        width={dimensions}
        height={dimensions}
        viewBox={viewBox}
        xmlns="http://www.w3.org/2000/svg"
        style={{ transform: 'rotate(-90deg)' }}
      >
        {/* Base Circle */}
        <circle
          r={radius}
          cx={dimensions / 2}
          cy={dimensions / 2}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset="0"
          className={cn(circleVariants({ variant }), isIndeterminate && 'hidden')}
        />
        {/* Progress Circle */}
        <circle
          r={radius}
          cx={dimensions / 2}
          cy={dimensions / 2}
          strokeWidth={strokeWidth}
          strokeLinecap={strokeLinecap}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            progressCircleVariants({
              variant,
            }),
          )}
        />
      </svg>
    </div>
  );
}