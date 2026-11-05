import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { MCP_SETTINGS_PATH } from '@/application/mcp/setup';
import { toMcpServerUrl } from '@/application/services/domains/mcp';
import { defaultConfig } from '@/application/services/js-services/http/cloud-config';
import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/info_colored.svg';
import { useIsSelfHosted, useServerInfo } from '@/components/app/hooks/useServerInfo';
import { McpSetupGuide } from '@/components/mcp/McpSetupGuide';
import { useMcpConfiguration } from '@/components/mcp/useMcpConfiguration';
import { Progress } from '@/components/ui/progress';

/**
 * Public instructions for connecting AI apps (`/oauth/mcp/setup`). No sign-in
 * needed: the MCP server links here as its `resource_documentation`. The
 * server URL comes from `APPFLOWY_MCP_BASE_URL` or, without it, from Cloud
 * server-info, so without the override the page waits for server-info first.
 */
export function McpSetupPage() {
  const { t } = useTranslation();

  // The page runs the server-info loop itself, also when the override names the MCP service (the
  // URL then shows at once): server-info says whether this server is self-hosted, for the guide's
  // note that Claude's apps and ChatGPT must reach it from the internet.
  useServerInfo(true, defaultConfig.baseURL);

  const configuration = useMcpConfiguration();
  const selfHosted = useIsSelfHosted();
  const title = t('mcp.setup.pageTitle');

  useEffect(() => {
    const previousTitle = document.title;

    document.title = `${title} | AppFlowy`;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <div className='flex min-h-screen w-full flex-col bg-background-primary' data-testid='mcp-setup-page'>
      <header className='flex h-[60px] w-full shrink-0 items-center px-5 py-4'>
        <Link to='/app' className='h-full w-[141px]' aria-label='AppFlowy'>
          <AppFlowyLogo className='h-full w-full' />
        </Link>
      </header>
      <main className='flex w-full flex-1 justify-center px-4 pb-16 pt-5'>
        <div className='flex w-full min-w-0 max-w-[680px] flex-col gap-5'>
          <div className='flex flex-col gap-2'>
            <h1 className='text-2xl font-semibold leading-9 text-text-primary'>{title}</h1>
            <p className='text-sm text-text-secondary'>{t('mcp.setup.pageDescription')}</p>
          </div>
          {configuration.status === 'loading' ? (
            <div
              role='status'
              aria-label={configuration.retrying ? undefined : t('loading')}
              className='flex flex-col items-center gap-4 py-12'
              data-testid='mcp-setup-loading'
            >
              <Progress variant='primary' />
              {configuration.retrying && (
                <p className='text-center text-sm text-text-secondary' data-testid='mcp-setup-retrying'>
                  {t('mcp.serverInfoRetrying')}
                </p>
              )}
            </div>
          ) : configuration.status === 'configured' ? (
            <>
              <McpSetupGuide serverUrl={toMcpServerUrl(configuration.baseUrl)} selfHosted={selfHosted} />
              <p className='text-sm text-text-secondary'>{t('mcp.setup.signInNote')}</p>
              <Link
                to={MCP_SETTINGS_PATH}
                className='w-fit text-sm font-medium text-text-action hover:text-text-action-hover'
                data-testid='mcp-setup-manage-link'
              >
                {t('mcp.setup.manageLink')}
              </Link>
            </>
          ) : (
            <div
              role='status'
              className='flex items-start gap-3 rounded-400 bg-fill-info-light py-4 pl-4 pr-3 text-sm text-text-primary'
              data-testid='mcp-setup-not-configured'
            >
              <InfoIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-info-thick' />
              <span className='min-w-0'>{t('mcp.setup.notConfigured')}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default McpSetupPage;
