import { Fragment, ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildCursorInstallUrl,
  buildMcpSnippets,
  buildVsCodeInstallUrl,
  CHATGPT_SETTINGS_URL,
  CLAUDE_CONNECTORS_URL,
  MCP_SETUP_PAGE_PATH,
} from '@/application/mcp/setup';
import {
  connectedSetupApps,
  MCP_SETUP_APPS,
  summarizeConnectedApps,
  type McpSetupAppId,
  type McpSetupConnection,
} from '@/application/mcp/setupApps';
import { buildMcpSetupPrompt } from '@/application/mcp/setupPrompt';
import { ReactComponent as ArrowUpRightIcon } from '@/assets/icons/arrow_up_right.svg';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { notify } from '@/components/_shared/notify';
import { RAW_INTERPOLATION } from '@/components/mcp/rawInterpolation';
import { McpConnectedApps } from '@/components/mcp/setup/McpConnectedApps';
import { McpSetupAppCard } from '@/components/mcp/setup/McpSetupAppCard';
import { McpSetupAppSteps } from '@/components/mcp/setup/McpSetupAppSteps';
import type { McpSetupCopy } from '@/components/mcp/setup/McpSetupParts';
import { McpSetupTroubleshooting } from '@/components/mcp/setup/McpSetupTroubleshooting';
import { SETUP_APP_TEXT_KEYS } from '@/components/mcp/setup/setupAppText';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/utils/copy';

/**
 * Cards of at least 12rem and at most three per row: the Settings dialog and
 * the setup page show three columns, phones one. `dense` lets the cards after
 * an expanded one fill its row, so its steps (a full-width item that follows
 * it in the DOM) open right under that row.
 */
const GALLERY_GRID_CLASS =
  'grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(max(12rem,calc((100%_-_1.5rem)/3)),1fr))] gap-3';

export interface McpSetupGuideProps {
  /**
   * The server URL to show and build every snippet from: `McpMemberStatus.endpoint`
   * in Settings, the configured MCP URL on the setup page. Callers own the
   * loading and not-configured states, so this is always a resolved URL.
   */
  serverUrl: string;
  /**
   * The caller's connections in this workspace, for "Connected apps (N)" and
   * the cards' Connected badges (matched by the verified catalog `app_id`).
   * Omit where they are unknown, such as on the public setup page.
   */
  connections?: readonly McpSetupConnection[];
  className?: string;
}

/**
 * How to connect AI apps to the AppFlowy MCP server: the server URL with Copy,
 * a setup prompt for AI agents, the apps already connected, a gallery of apps
 * whose cards expand into copyable steps, and "Having trouble?".
 */
export function McpSetupGuide({ serverUrl, connections, className }: McpSetupGuideProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const idPrefix = useId();
  const url = serverUrl.trim();
  const snippets = useMemo(() => buildMcpSnippets(url), [url]);
  const connectedApps = useMemo(() => summarizeConnectedApps(connections ?? []), [connections]);
  const connectedCards = useMemo(() => connectedSetupApps(connectedApps), [connectedApps]);
  const [selected, setSelected] = useState<McpSetupAppId | null>(null);
  const selectedByUser = useRef(false);
  const stepsRef = useRef<HTMLDivElement>(null);

  const copy = useCallback<McpSetupCopy>(
    async (text, successMessage) => {
      try {
        await copyTextToClipboard(text);
        notify.success(successMessage ?? t('mcp.setup.copied'));
      } catch {
        // The Clipboard API is missing outside secure contexts and can be denied.
        notify.error(t('message.copy.fail'));
      }
    },
    [t]
  );

  useEffect(() => {
    // Bring steps the user opened into view; on a phone they can follow a long column of cards.
    // jsdom has no scrollIntoView.
    if (selected && selectedByUser.current) stepsRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const select = (app: McpSetupAppId) => {
    selectedByUser.current = true;
    setSelected(app);
  };

  const toggle = (app: McpSetupAppId) => {
    selectedByUser.current = true;
    setSelected((current) => (current === app ? null : app));
  };

  const copyPrompt = () => {
    const setupPageUrl = new URL(MCP_SETUP_PAGE_PATH, window.location.origin).toString();

    void copy(buildMcpSetupPrompt(url, { setupPageUrl }), t('mcp.setup.promptCopied'));
  };

  /**
   * The card's one primary action: the vendor's page, a one-click install, or a copy. Each also
   * opens the steps. `JSX.Element`, not `ReactNode`, so a new gallery app without a case fails to
   * compile instead of rendering a card without its action.
   */
  const primaryAction = (app: McpSetupAppId): JSX.Element => {
    const copyAction = (text: string, label: string) => (
      <Button
        variant='outline'
        size='sm'
        onClick={() => {
          select(app);
          void copy(text);
        }}
        data-testid={`mcp-setup-app-action-${app}`}
      >
        <CopyIcon className='h-4 w-4' />
        {label}
      </Button>
    );

    switch (app) {
      case 'claude':
        return (
          <ExternalAction href={CLAUDE_CONNECTORS_URL} onOpen={() => select(app)} testId='mcp-open-claude-connectors'>
            {t('mcp.setup.claude.action')}
          </ExternalAction>
        );
      case 'chatgpt':
        return (
          <ExternalAction href={CHATGPT_SETTINGS_URL} onOpen={() => select(app)} testId='mcp-open-chatgpt'>
            {t('mcp.setup.chatgpt.action')}
          </ExternalAction>
        );
      case 'cursor':
        return (
          <Button asChild variant='outline' size='sm'>
            <a href={buildCursorInstallUrl(url)} onClick={() => select(app)} data-testid='mcp-install-cursor'>
              {t('mcp.setup.cursor.install')}
            </a>
          </Button>
        );
      case 'vscode':
        return (
          <Button asChild variant='outline' size='sm'>
            <a href={buildVsCodeInstallUrl(url)} onClick={() => select(app)} data-testid='mcp-install-vscode'>
              {t('mcp.setup.vscode.install')}
            </a>
          </Button>
        );
      case 'claude-code':
        return copyAction(snippets['claude-code'], t('mcp.setup.copyCommand'));
      case 'codex':
        return copyAction(snippets.codex, t('mcp.setup.copyCommand'));
      case 'gemini':
        return copyAction(snippets.gemini, t('mcp.setup.copyCommand'));
      case 'windsurf':
        return copyAction(snippets['server-url-json'], t('mcp.setup.copyConfig'));
      case 'other':
        return copyAction(url, t('mcp.setup.copyUrl'));
    }
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-5', className)} data-testid='mcp-setup-guide'>
      <div className='flex flex-col gap-1.5'>
        <label htmlFor={inputId} className='text-sm font-medium text-text-primary'>
          {t('mcp.setup.serverUrl')}
        </label>
        <div className='flex min-w-0 items-center gap-2'>
          <Input
            id={inputId}
            readOnly
            value={url}
            className='min-w-0 flex-1 font-mono'
            data-testid='mcp-endpoint-value'
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button variant='outline' onClick={() => void copy(url)} data-testid='mcp-copy-endpoint'>
            <CopyIcon className='h-4 w-4' />
            {t('mcp.setup.copy')}
          </Button>
        </div>
      </div>

      <div className='flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-400 border border-border-primary bg-fill-content px-4 py-3'>
        <p className='min-w-0 flex-1 basis-60 text-sm text-text-secondary'>{t('mcp.setup.promptHint')}</p>
        <Button variant='outline' size='sm' onClick={copyPrompt} data-testid='mcp-copy-setup-prompt'>
          <CopyIcon className='h-4 w-4' />
          {t('mcp.setup.copyPrompt')}
        </Button>
      </div>

      <McpConnectedApps apps={connectedApps} />

      <div className={GALLERY_GRID_CLASS} data-testid='mcp-setup-gallery'>
        {MCP_SETUP_APPS.map((app) => {
          const textKey = SETUP_APP_TEXT_KEYS[app];
          const name = t(`mcp.setup.${textKey}.name`);
          const panelId = `${idPrefix}-${app}-steps`;
          const titleId = `${idPrefix}-${app}-title`;

          return (
            <Fragment key={app}>
              <McpSetupAppCard
                app={app}
                name={name}
                description={t(`mcp.setup.${textKey}.description`)}
                selected={selected === app}
                connected={connectedCards.has(app)}
                panelId={panelId}
                onToggle={() => toggle(app)}
                action={primaryAction(app)}
              />
              {selected === app && (
                <div
                  ref={stepsRef}
                  id={panelId}
                  role='region'
                  aria-labelledby={titleId}
                  className='col-span-full flex min-w-0 flex-col gap-3 rounded-400 border border-border-primary p-4'
                  data-testid={`mcp-client-panel-${app}`}
                >
                  <p id={titleId} className='text-sm font-semibold text-text-primary'>
                    {t('mcp.setup.stepsTitle', { name, ...RAW_INTERPOLATION })}
                  </p>
                  <McpSetupAppSteps app={app} snippets={snippets} onCopy={copy} />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      <McpSetupTroubleshooting />
    </div>
  );
}

/** A vendor page in a new tab, marked as leaving AppFlowy. */
function ExternalAction({
  href,
  onOpen,
  testId,
  children,
}: {
  href: string;
  onOpen: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Button asChild variant='outline' size='sm'>
      <a href={href} target='_blank' rel='noopener noreferrer' onClick={onOpen} data-testid={testId}>
        {children}
        <ArrowUpRightIcon aria-hidden='true' className='h-4 w-4' />
      </a>
    </Button>
  );
}

export default McpSetupGuide;
