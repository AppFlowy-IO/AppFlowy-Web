import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { MCP_SETTINGS_PATH } from '@/application/mcp/setup';
import { toMcpServerUrl } from '@/application/services/domains/mcp';
import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import { McpSetupGuide } from '@/components/mcp/McpSetupGuide';
import { useMcpConfiguration } from '@/components/mcp/useMcpConfiguration';
import { Progress } from '@/components/ui/progress';

/**
 * Public instructions for connecting AI apps (`/oauth/mcp/setup`). No sign-in
 * needed: the MCP server links here as its `resource_documentation`. The
 * server URL comes from `APPFLOWY_MCP_BASE_URL` or, without it, from Cloud
 * server-info, so the page waits for server-info first.
 */
export function McpSetupPage() {
  const { t } = useTranslation();
  const configuration = useMcpConfiguration({ loadServerInfo: true });
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
      <header className='flex h-[60px] w-full shrink-0 items-center p-4'>
        <Link to='/app' className='h-full w-[141px]' aria-label='AppFlowy'>
          <AppFlowyLogo className='h-full w-full' />
        </Link>
      </header>
      <main className='flex w-full flex-1 justify-center px-4 pb-16 pt-6'>
        <div className='flex w-full min-w-0 max-w-[680px] flex-col gap-6'>
          <div className='flex flex-col gap-2'>
            <h1 className='text-2xl font-semibold text-text-primary'>{title}</h1>
            <p className='text-sm text-text-secondary'>{t('mcp.setup.pageDescription')}</p>
          </div>
          {configuration.status === 'loading' ? (
            <div
              role='status'
              aria-label={t('loading')}
              className='flex justify-center py-12'
              data-testid='mcp-setup-loading'
            >
              <Progress variant='primary' />
            </div>
          ) : configuration.status === 'configured' ? (
            <>
              <McpSetupGuide serverUrl={toMcpServerUrl(configuration.baseUrl)} />
              <p className='text-sm text-text-secondary'>{t('mcp.setup.signInNote')}</p>
              <Link
                to={MCP_SETTINGS_PATH}
                className='w-fit text-sm font-medium text-text-action hover:text-text-action-hover hover:underline'
                data-testid='mcp-setup-manage-link'
              >
                {t('mcp.setup.manageLink')}
              </Link>
            </>
          ) : (
            <div
              role='status'
              className='rounded-400 border border-border-primary p-4 text-sm text-text-secondary'
              data-testid='mcp-setup-not-configured'
            >
              {t('mcp.setup.notConfigured')}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default McpSetupPage;
