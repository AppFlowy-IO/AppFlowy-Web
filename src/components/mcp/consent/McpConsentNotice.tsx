import { HTMLAttributes } from 'react';

import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/info_colored.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { cn } from '@/lib/utils';

export type McpConsentNoticeTone = 'info' | 'warning' | 'error';

const TONES = {
  info: {
    Icon: InfoIcon,
    className: 'bg-fill-info-light',
    iconClassName: 'text-icon-info-thick',
  },
  warning: {
    Icon: WarningIcon,
    className: 'bg-fill-warning-light',
    iconClassName: 'text-icon-warning-thick',
  },
  error: {
    Icon: ErrorIcon,
    className: 'bg-fill-error-light',
    iconClassName: 'text-icon-error-thick',
  },
} as const;

export interface McpConsentNoticeProps extends HTMLAttributes<HTMLDivElement> {
  tone?: McpConsentNoticeTone;
}

/** A short note on the consent page: approval state, the localhost warning or an error. */
export function McpConsentNotice({ tone = 'info', children, className, ...props }: McpConsentNoticeProps) {
  const { Icon, className: toneClassName, iconClassName } = TONES[tone];

  return (
    <div
      {...props}
      className={cn(
        'flex items-start gap-3 rounded-400 py-4 pl-4 pr-3 text-sm text-text-primary',
        toneClassName,
        className
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0', iconClassName)} aria-hidden='true' />
      <div className='flex min-w-0 flex-1 flex-col gap-2 break-words'>{children}</div>
    </div>
  );
}

export default McpConsentNotice;
