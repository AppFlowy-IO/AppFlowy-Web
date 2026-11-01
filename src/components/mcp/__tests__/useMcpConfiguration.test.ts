import { act, renderHook } from '@testing-library/react';

import { AuthService } from '@/application/services/domains';
import { resetMcpConfigurationForTests } from '@/application/services/domains/mcp';
import { updateServerInfo } from '@/utils/server-info';

import { useMcpConfiguration } from '../useMcpConfiguration';

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

// The config has no APPFLOWY_BASE_URL, so server-info is kept for the default Cloud URL.
const CLOUD = 'https://test.appflowy.cloud';
const getServerInfo = jest.mocked(AuthService.getServerInfo);

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockConfig).forEach((key) => delete mockConfig[key]);
  resetMcpConfigurationForTests();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('uses the APPFLOWY_MCP_BASE_URL override at once, without asking server-info', () => {
  mockConfig.APPFLOWY_MCP_BASE_URL = 'https://mcp.override.example.com/';

  const { result } = renderHook(() => useMcpConfiguration({ loadServerInfo: true }));

  expect(result.current).toEqual({
    status: 'configured',
    baseUrl: 'https://mcp.override.example.com',
    source: 'config',
  });
  expect(getServerInfo).not.toHaveBeenCalled();
});

it('loads server-info on pages outside the app and resolves to its mcp_url', async () => {
  let resolveInfo!: (info: Awaited<ReturnType<typeof AuthService.getServerInfo>>) => void;

  getServerInfo.mockReturnValue(
    new Promise((resolve) => {
      resolveInfo = resolve;
    })
  );

  const { result, unmount } = renderHook(() => useMcpConfiguration({ loadServerInfo: true }));

  expect(result.current).toEqual({ status: 'loading' });
  expect(getServerInfo).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveInfo({ enable_page_history: true, mcp_url: 'https://mcp.example.com' });
  });

  expect(result.current).toEqual({ status: 'configured', baseUrl: 'https://mcp.example.com', source: 'server_info' });
  unmount();
});

it('reports not configured when server-info has no mcp_url', async () => {
  getServerInfo.mockResolvedValue({ enable_page_history: true });

  const { result, unmount } = renderHook(() => useMcpConfiguration({ loadServerInfo: true }));

  await act(async () => undefined);

  expect(result.current).toEqual({ status: 'not_configured' });
  unmount();
});

it('only reads the snapshot inside the app, where the auth layer refreshes it', () => {
  const { result } = renderHook(() => useMcpConfiguration());

  expect(result.current).toEqual({ status: 'loading' });
  expect(getServerInfo).not.toHaveBeenCalled();

  act(() => {
    updateServerInfo(CLOUD, {
      status: 'available',
      info: { enable_page_history: true, mcp_url: 'https://mcp.example.com' },
    });
  });
  expect(result.current).toEqual({ status: 'configured', baseUrl: 'https://mcp.example.com', source: 'server_info' });

  // A failed refresh does not take AI apps away from an open page.
  act(() => {
    updateServerInfo(CLOUD, { status: 'unavailable' });
  });
  expect(result.current).toEqual({ status: 'configured', baseUrl: 'https://mcp.example.com', source: 'server_info' });
});
