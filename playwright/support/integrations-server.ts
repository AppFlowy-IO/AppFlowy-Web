import { createRequire } from 'node:module';

import { test as base } from '@playwright/test';

/** A separate Vite instance per worker keeps these browser tests independent of a running app or Cloud. */
export const test = base.extend<object, { integrationsURL: string }>({
  integrationsURL: [
    async ({ browserName }, use, workerInfo) => {
      const { createServer } = await import('vite');
      // Load CJS plugins natively; Playwright's ESM transform removes require.cache
      // when Vite discovers this config through its dynamic config loader.
      const postcss = createRequire(import.meta.url)('../../postcss.config.cjs');
      const server = await createServer({
        cacheDir: `node_modules/.vite/integrations-${browserName}-${workerInfo.workerIndex}`,
        logLevel: 'error',
        css: { postcss },
        optimizeDeps: {
          entries: [
            'playwright/support/connections.fixture.tsx',
            'playwright/support/integrations.fixture.tsx',
            'playwright/support/math-equation.fixture.tsx',
            'playwright/support/code-block.fixture.tsx',
            'playwright/support/pdf.fixture.tsx',
            'playwright/support/image.fixture.tsx',
            'playwright/support/google-drive.fixture.tsx',
            'playwright/support/dashboard-owned-clone.fixture.tsx',
            'playwright/support/dashboard-view-startup.fixture.tsx',
            'playwright/support/chart-settings.fixture.tsx',
            'playwright/support/calendar-event-drag.fixture.tsx',
          ],
        },
        server: { host: '127.0.0.1', port: 0, strictPort: false },
      });

      try {
        await server.listen();
        await use(server.resolvedUrls!.local[0]);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
});

export function fixtureHTML(
  entry:
    | 'connections'
    | 'integrations'
    | 'math-equation'
    | 'code-block'
    | 'pdf'
    | 'image'
    | 'google-drive'
    | 'dashboard-owned-clone'
    | 'dashboard-view-startup'
    | 'chart-settings'
    | 'calendar-event-drag'
) {
  return `<!doctype html><html lang="en"><head><title>AppFlowy integration tests</title></head>
  <body id="body"><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/playwright/support/${entry}.fixture.tsx');
  </script></body></html>`;
}
