import type { Page } from '@playwright/test';

export interface MockServerInfo {
  enable_page_history: boolean;
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
