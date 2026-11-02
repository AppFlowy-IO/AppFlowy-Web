import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { buildMcpSetupPrompt } from '@/application/mcp/setupPrompt';
import { AuthService } from '@/application/services/domains';
import { resetMcpConfigurationForTests } from '@/application/services/js-services/http/mcp-api';
import { copyTextToClipboard } from '@/utils/copy';

import { McpSetupPage } from '../McpSetupPage';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/copy', () => ({ copyTextToClipboard: jest.fn() }));
jest.mock('@/components/_shared/notify', () => ({ notify: { success: jest.fn(), error: jest.fn() } }));
// Modules read the runtime config while they load, so it lives inside the mock.
jest.mock('@/utils/runtime-config', () => {
  const config: Record<string, string> = {};

  return {
    mockRuntimeConfig: config,
    getConfigValue: (key: string, fallback: string) => config[key] ?? fallback,
    isDevelopmentOrTestEnvironment: () => true,
    isLocalDevelopment: () => false,
  };
});
jest.mock('@/application/services/domains', () => ({ AuthService: { getServerInfo: jest.fn() } }));

const mockConfig = jest.requireMock<{ mockRuntimeConfig: Record<string, string> }>(
  '@/utils/runtime-config'
).mockRuntimeConfig;
const getServerInfo = jest.mocked(AuthService.getServerInfo);

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/oauth/mcp/setup']}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <McpSetupPage />
    </MemoryRouter>
  );
}

describe('McpSetupPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMcpConfigurationForTests();
    Object.keys(mockConfig).forEach((key) => delete mockConfig[key]);
    getServerInfo.mockResolvedValue({ enable_page_history: true });
  });

  it('shows the setup guide for the configured URL and links to the AI apps settings', () => {
    mockConfig.APPFLOWY_MCP_BASE_URL = 'https://mcp.example.com';
    renderPage();

    expect(screen.getByRole('heading', { name: 'mcp.setup.pageTitle' })).toBeTruthy();
    expect(screen.getByTestId<HTMLInputElement>('mcp-endpoint-value').value).toBe('https://mcp.example.com/mcp');
    expect(screen.getByText('mcp.setup.signInNote')).toBeTruthy();
    expect(screen.getByTestId('mcp-setup-manage-link').getAttribute('href')).toBe('/app?setting=AI_APPS');
    expect(document.title).toBe('mcp.setup.pageTitle | AppFlowy');
    expect(getServerInfo).not.toHaveBeenCalled();
  });

  it('offers the app gallery, a setup prompt for AI agents and troubleshooting, without connection state', async () => {
    mockConfig.APPFLOWY_MCP_BASE_URL = 'https://mcp.example.com';
    jest.mocked(copyTextToClipboard).mockResolvedValue(undefined);
    renderPage();

    expect(screen.getByTestId('mcp-setup-gallery')).toBeTruthy();
    expect(screen.getByTestId('mcp-setup-troubleshooting')).toBeTruthy();
    // Signed out or not, the public page knows no workspace, so it shows no connections.
    expect(screen.queryByTestId('mcp-setup-connected-apps')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-copy-setup-prompt'));
    });
    expect(copyTextToClipboard).toHaveBeenCalledWith(
      buildMcpSetupPrompt('https://mcp.example.com/mcp', {
        setupPageUrl: `${window.location.origin}/oauth/mcp/setup`,
      })
    );
  });

  it('waits for Cloud server-info, then shows the MCP URL it advertises', async () => {
    let resolveInfo!: (info: Awaited<ReturnType<typeof AuthService.getServerInfo>>) => void;

    getServerInfo.mockReturnValue(
      new Promise((resolve) => {
        resolveInfo = resolve;
      })
    );
    renderPage();

    expect(screen.getByTestId('mcp-setup-loading')).toBeTruthy();
    expect(screen.queryByTestId('mcp-setup-guide')).toBeNull();
    expect(screen.queryByTestId('mcp-setup-not-configured')).toBeNull();

    await act(async () => {
      resolveInfo({ enable_page_history: true, mcp_url: 'https://mcp.discovered.example.com' });
    });

    expect(screen.getByTestId<HTMLInputElement>('mcp-endpoint-value').value).toBe(
      'https://mcp.discovered.example.com/mcp'
    );
    expect(screen.queryByTestId('mcp-setup-loading')).toBeNull();
  });

  it('says it is retrying while Cloud server-info fails, then shows the URL once it answers', async () => {
    jest.useFakeTimers();
    // The server-info loop logs each failed request.
    const logError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      getServerInfo
        .mockRejectedValueOnce(Object.assign(new Error('Bad gateway'), { code: 502 }))
        .mockResolvedValueOnce({ enable_page_history: true, mcp_url: 'https://mcp.discovered.example.com' });
      renderPage();

      expect((await screen.findByTestId('mcp-setup-retrying')).textContent).toBe('mcp.serverInfoRetrying');
      expect(screen.getByTestId('mcp-setup-loading')).toBeTruthy();

      // The server-info loop retries after a second.
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });

      expect((await screen.findByTestId<HTMLInputElement>('mcp-endpoint-value')).value).toBe(
        'https://mcp.discovered.example.com/mcp'
      );
      expect(screen.queryByTestId('mcp-setup-retrying')).toBeNull();
      expect(getServerInfo).toHaveBeenCalledTimes(2);
    } finally {
      logError.mockRestore();
      jest.useRealTimers();
    }
  });

  it('explains when neither the Web config nor Cloud server-info names an MCP service', async () => {
    renderPage();

    expect((await screen.findByTestId('mcp-setup-not-configured')).textContent).toBe('mcp.setup.notConfigured');
    expect(screen.queryByTestId('mcp-setup-guide')).toBeNull();
    expect(screen.queryByTestId('mcp-setup-manage-link')).toBeNull();
    expect(getServerInfo).toHaveBeenCalledTimes(1);
  });

  it('ignores an APPFLOWY_MCP_BASE_URL that names the MCP server URL instead of its origin', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockConfig.APPFLOWY_MCP_BASE_URL = 'https://mcp.example.com/mcp';
    renderPage();

    // Not https://mcp.example.com/mcp/mcp: the page falls back to server-info, which names none.
    expect(await screen.findByTestId('mcp-setup-not-configured')).toBeTruthy();
    expect(screen.queryByTestId('mcp-endpoint-value')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
