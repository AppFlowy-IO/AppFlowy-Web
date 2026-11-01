import { ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down_small.svg';
import { ReactComponent as HelpIcon } from '@/assets/icons/help.svg';
import { cn } from '@/lib/utils';

import { RichText } from './McpSetupParts';

/**
 * "Having trouble?": collapsed answers to the questions setup raises most,
 * such as how to reconnect each app, a pending approval, or using a second
 * workspace (one connection covers one workspace).
 */
export function McpSetupTroubleshooting() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const toggleId = useId();
  const regionId = useId();

  const reconnect = [
    t('mcp.setup.trouble.reconnectClaude'),
    t('mcp.setup.trouble.reconnectChatgpt'),
    t('mcp.setup.trouble.reconnectClaudeCode'),
    t('mcp.setup.trouble.reconnectCodex'),
    t('mcp.setup.trouble.reconnectCursor'),
    t('mcp.setup.trouble.reconnectVscode'),
    t('mcp.setup.trouble.reconnectGemini'),
  ];

  return (
    <section className='min-w-0 rounded-400 border border-border-primary' data-testid='mcp-setup-troubleshooting'>
      <button
        type='button'
        id={toggleId}
        aria-expanded={open}
        aria-controls={open ? regionId : undefined}
        onClick={() => setOpen((value) => !value)}
        className='flex w-full items-center justify-between gap-2 rounded-400 px-4 py-3 text-left text-sm font-medium text-text-primary outline-none hover:bg-fill-content-hover focus-visible:ring-2 focus-visible:ring-border-theme-thick'
        data-testid='mcp-setup-troubleshooting-toggle'
      >
        <span className='flex min-w-0 items-center gap-2'>
          <HelpIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-secondary' />
          {t('mcp.setup.trouble.title')}
        </span>
        <ChevronDownIcon
          aria-hidden='true'
          className={cn('h-5 w-5 shrink-0 text-icon-secondary transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={regionId} role='region' aria-labelledby={toggleId} data-testid='mcp-setup-troubleshooting-content'>
          <dl className='flex min-w-0 flex-col gap-4 px-4 pb-4 pt-1 text-sm'>
            <Item title={t('mcp.setup.trouble.reconnectTitle')} testId='mcp-setup-trouble-reconnect'>
              <ul className='list-disc space-y-1 pl-5'>
                {reconnect.map((line) => (
                  <li key={line}>
                    <RichText text={line} />
                  </li>
                ))}
              </ul>
            </Item>
            <Item title={t('mcp.setup.trouble.approvalTitle')} testId='mcp-setup-trouble-approval'>
              <RichText text={t('mcp.setup.trouble.approval')} />
            </Item>
            <Item title={t('mcp.setup.trouble.workspaceTitle')} testId='mcp-setup-trouble-workspace'>
              <RichText text={t('mcp.setup.trouble.workspace')} />
            </Item>
            <Item title={t('mcp.setup.trouble.readOnlyTitle')} testId='mcp-setup-trouble-read-only'>
              <RichText text={t('mcp.setup.trouble.readOnly')} />
            </Item>
            <Item title={t('mcp.setup.trouble.pathTitle')} testId='mcp-setup-trouble-path'>
              <RichText text={t('mcp.setup.trouble.path')} />
            </Item>
            <Item title={t('mcp.setup.trouble.blockedTitle')} testId='mcp-setup-trouble-blocked'>
              <RichText text={t('mcp.setup.trouble.blocked')} />
            </Item>
          </dl>
        </div>
      )}
    </section>
  );
}

function Item({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <div className='flex min-w-0 flex-col gap-1' data-testid={testId}>
      <dt className='font-medium text-text-primary'>{title}</dt>
      <dd className='text-text-secondary'>{children}</dd>
    </div>
  );
}
