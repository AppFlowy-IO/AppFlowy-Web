import type { Page, Route } from '@playwright/test';

function omitView(value: unknown, viewId: string): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => !(item && typeof item === 'object' && item.view_id === viewId))
      .map((item) => omitView(item, viewId));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, omitView(child, viewId)]));
  }
  return value;
}

/** A client-scoped read failure. No server content, permissions or settings change. */
export async function installPageReferenceNetworkFault(
  page: Page,
  workspaceId: string,
  viewId: string,
  shouldFail?: () => Promise<boolean>
) {
  let unavailable = true;
  let blockedReads = 0;
  const targetPath = `/api/workspace/${workspaceId}/view/${viewId}`;
  const outlinePaths = new Set([
    `/api/workspace/${workspaceId}/view/${workspaceId}`,
    `/api/sharing/workspace/${workspaceId}/view/${workspaceId}`,
    `/api/workspace/${workspaceId}/views`,
    `/api/workspace/${workspaceId}/views/query`,
  ]);
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Reference failure injection is restricted to localhost');
    }
    if (request.method() === 'GET' && url.pathname === targetPath && (shouldFail ? await shouldFail() : unavailable)) {
      blockedReads++;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 503, message: 'Temporary test request failure' }) });
      return;
    }
    if (outlinePaths.has(url.pathname)) {
      // A new browser context has no disk cache. Omitting only this view from
      // outline reads exercises the real metadata fallback rather than a cache hit.
      const headers = Object.fromEntries(Object.entries(request.headers()).filter(([key]) =>
        !['if-none-match', 'if-modified-since'].includes(key.toLowerCase())));
      const response = await route.fetch({ headers });

      if (response.ok()) {
        await route.fulfill({ response, json: omitView(await response.json(), viewId) });
      } else {
        await route.fulfill({ response });
      }
      return;
    }
    await route.continue();
  };

  await page.route('**/api/**', handler);
  return {
    get blockedReads() { return blockedReads; },
    recover() { unavailable = false; },
    dispose: () => page.unroute('**/api/**', handler),
  };
}
