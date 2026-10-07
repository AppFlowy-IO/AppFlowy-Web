import type { Page } from '@playwright/test';

export interface MockServerInfo {
  self_hosted?: boolean;
  version?: string;
  min_web_client_version?: string;
  enable_page_history: boolean;
  enable_database_history?: boolean;
  ai_enabled: boolean;
}

export interface ServerInfoMockController {
  getServerInfo: () => MockServerInfo;
  setServerInfo: (updates: Partial<MockServerInfo>) => void;
}

export async function mockServerInfo(
  page: Page,
  overrides: Partial<MockServerInfo> = {}
): Promise<ServerInfoMockController> {
  let serverInfo: MockServerInfo = {
    enable_page_history: true,
    ai_enabled: true,
    ...overrides,
  };

  await page.route('**/api/server-info**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname !== '/api/server-info') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: serverInfo,
        message: 'success',
      }),
    });
  });

  return {
    getServerInfo: () => serverInfo,
    setServerInfo: (updates) => {
      serverInfo = {
        ...serverInfo,
        ...updates,
      };
    },
  };
}

/** Override billing mode without replacing the real server's feature capabilities. */
export async function mockServerInfoPreservingCapabilities(
  page: Page,
  overrides: Partial<MockServerInfo>
): Promise<void> {
  await page.route('**/api/server-info**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/api/server-info') {
      await route.fallback();
      return;
    }

    // route.fetch retains the browser's version/platform headers and bypasses
    // earlier stubs, so history availability is still the real server's answer.
    const response = await route.fetch();
    const body = await response.json();

    if (!response.ok() || body.code !== 0 || !body.data || typeof body.data !== 'object') {
      throw new Error(`Cannot read real server capabilities (HTTP ${response.status()})`);
    }

    await route.fulfill({ response, json: { ...body, data: { ...body.data, ...overrides } } });
  });
}
