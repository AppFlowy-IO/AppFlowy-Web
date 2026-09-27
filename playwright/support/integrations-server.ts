import { test as base } from '@playwright/test';

/** A separate Vite instance per worker keeps these browser tests independent of a running app or Cloud. */
export const test = base.extend<object, { integrationsURL: string }>({
  integrationsURL: [
    async ({ browserName }, use, workerInfo) => {
      const { createServer } = await import('vite');
      const server = await createServer({
        cacheDir: `node_modules/.vite/integrations-${browserName}-${workerInfo.workerIndex}`,
        logLevel: 'error',
        optimizeDeps: {
          entries: ['playwright/support/connections.fixture.tsx', 'playwright/support/integrations.fixture.tsx'],
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

export function fixtureHTML(entry: 'connections' | 'integrations') {
  return `<!doctype html><html lang="en"><head><title>AppFlowy integration tests</title></head>
  <body id="body"><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/playwright/support/${entry}.fixture.tsx');
  </script></body></html>`;
}
