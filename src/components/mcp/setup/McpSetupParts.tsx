import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import type { McpSnippetId } from '@/application/mcp/setup';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/info_colored.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Copies `text` and confirms with a toast (`successMessage`, default "Copied to clipboard"). */
export type McpSetupCopy = (text: string, successMessage?: string) => Promise<void>;

// A backtick-quoted part of a translated string: `/mcp`, `--scope user`, `~/.cursor/mcp.json`.
const INLINE_CODE = /`([^`]+)`/;

/**
 * Translated text whose backtick-quoted parts render as inline code, so
 * commands and file names inside a sentence stay readable while translators
 * keep plain strings. An unmatched backtick stays as typed.
 */
export function RichText({ text }: { text: string }) {
  // `split` with a capture group puts the quoted parts at odd indices.
  const parts = text.split(INLINE_CODE);

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code
            key={index}
            className='whitespace-nowrap rounded-100 bg-fill-content-visible px-1 py-px font-mono text-[0.85em]'
          >
            {part}
          </code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}

export function SetupText({ text, muted, testId }: { text: string; muted?: boolean; testId?: string }) {
  return (
    <p className={cn('text-sm', muted ? 'text-text-secondary' : 'text-text-primary')} data-testid={testId}>
      <RichText text={text} />
    </p>
  );
}

export function SetupSteps({ items }: { items: string[] }) {
  return (
    <ol className='list-decimal space-y-2 pl-5 text-sm text-text-primary'>
      {items.map((item) => (
        <li key={item}>
          <RichText text={item} />
        </li>
      ))}
    </ol>
  );
}

/** An aside such as "Using Claude Team or Enterprise?". */
export function SetupNote({ title, text, testId }: { title: string; text: string; testId?: string }) {
  return (
    <div
      role='note'
      className='flex items-start gap-3 rounded-400 bg-fill-info-light py-4 pl-4 pr-3 text-sm text-text-primary'
      data-testid={testId}
    >
      <InfoIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-info-thick' />
      <div className='flex min-w-0 flex-col gap-1'>
        <span className='font-medium'>{title}</span>
        <span>
          <RichText text={text} />
        </span>
      </div>
    </div>
  );
}

/** A command or configuration with Copy; `id` names both test ids (`mcp-snippet-<id>`, `mcp-copy-snippet-<id>`). */
export function SetupSnippet({ id, text, onCopy }: { id: McpSnippetId; text: string; onCopy: McpSetupCopy }) {
  const { t } = useTranslation();

  return (
    <div className='flex min-w-0 items-start gap-2 rounded-300 border border-border-primary bg-surface-container-layer-01 p-3'>
      <pre
        className='appflowy-scroller min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-text-primary'
        data-testid={`mcp-snippet-${id}`}
      >
        <code>{text}</code>
      </pre>
      <Button variant='outline' size='sm' onClick={() => void onCopy(text)} data-testid={`mcp-copy-snippet-${id}`}>
        <CopyIcon className='h-5 w-5' />
        {t('mcp.setup.copy')}
      </Button>
    </div>
  );
}
