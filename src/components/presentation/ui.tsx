import { AlertCircle } from 'lucide-react';
import { ButtonHTMLAttributes, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { SlideSourceReference } from './slide-sources';

export function Action({
  children,
  primary,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button type='button' className={`ps-button ${primary ? 'ps-primary' : ''} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className='ps-notice' role='status'>
      <AlertCircle size={16} />
      <span>{children}</span>
    </div>
  );
}

export function SourceLinks({
  ids,
  references,
  onSource,
}: {
  ids: string[];
  references: ReadonlyMap<string, SlideSourceReference>;
  onSource: (id: string) => void;
}) {
  return (
    <div className='ps-source-links' role='group' aria-label='Sources'>
      {[...new Set(ids)].map((id) => {
        const reference = references.get(id);

        if (!reference) return null;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size='icon'
                className='h-7 min-w-7 rounded-full px-1 text-xs tabular-nums'
                style={reference.number >= 100 ? { width: 'auto', fontSize: 10 } : undefined}
                aria-label={`Open source ${reference.number}`}
                data-source-id={id}
                onClick={() => onSource(id)}
              >
                {reference.number}
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side='top'
              sideOffset={6}
              className='z-[1500] max-w-[360px] gap-1 whitespace-normal break-words bg-fill-toolbar text-icon-on-toolbar'
            >
              <span className='text-xs opacity-75'>Source {reference.number}</span>
              <span className='font-medium'>{reference.documentTitle}</span>
              {reference.section && <span className='text-xs opacity-75'>{reference.section}</span>}
              <span className='whitespace-pre-wrap'>{reference.excerpt}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
