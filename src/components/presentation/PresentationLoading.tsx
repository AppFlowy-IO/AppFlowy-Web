import { X } from 'lucide-react';
import { Children } from 'react';

import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { Action } from './ui';

import type { ReactNode } from 'react';

const spinner =
  'h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-primary border-t-fill-theme-thick motion-reduce:animate-none';

/** Fills a presentation surface while its content loads, so opening it shows nothing else first. */
export default function PresentationLoading({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-4'>
      <p role='status' className='flex items-center gap-2 text-sm text-text-primary'>
        <span aria-hidden='true' className={spinner} />
        {message}
      </p>
      {onClose && <Button onClick={onClose}>Back to page</Button>}
    </div>
  );
}

/** A mind map presentation before its map arrives: the map's surface and close button, with a spinner. */
export function MindMapLoading({ onClose }: { onClose: () => void }) {
  return (
    <div className='ps-root ps-map-loading'>
      <Action className='ps-map-close' aria-label='Back to page' title='Close (Esc)' onClick={onClose}>
        <X size={20} />
      </Action>
      <p role='status'>
        <span aria-hidden='true' className={spinner} />
        Loading mind map…
      </p>
    </div>
  );
}

/**
 * A presentation surface with nothing to show says why, centered where the content would be, with
 * the actions that can change that. An error is announced as an alert; anything else as a status.
 */
export function PresentationState({
  variant = 'empty',
  icon,
  title,
  message,
  actions,
  className,
  children,
}: {
  variant?: 'error' | 'empty';
  /** Defaults to the error icon for an error. */
  icon?: ReactNode;
  title?: string;
  message: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Wider content under the actions, such as a notice or a paywall. */
  children?: ReactNode;
}) {
  const error = variant === 'error';
  // Conditional children arrive as `false`; only real content gets the wider row.
  const extra = Children.toArray(children);

  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-4 px-6 py-10 text-center',
        className
      )}
    >
      {(icon || error) && (
        <span
          aria-hidden='true'
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full [&_svg]:h-5 [&_svg]:w-5',
            error ? 'bg-fill-error-light text-icon-error-thick' : 'bg-fill-content-hover text-icon-secondary'
          )}
        >
          {icon ?? <ErrorIcon />}
        </span>
      )}
      <div className='flex max-w-[400px] flex-col gap-1'>
        {title && <p className='text-base font-medium text-text-primary'>{title}</p>}
        <p className='whitespace-pre-line text-sm text-text-secondary'>{message}</p>
      </div>
      {actions && <div className='flex flex-wrap items-center justify-center gap-2'>{actions}</div>}
      {extra.length > 0 && <div className='flex w-full max-w-[480px] flex-col gap-3 text-left'>{extra}</div>}
    </div>
  );
}
