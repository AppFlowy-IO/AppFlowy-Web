import { expect, test as base } from '@playwright/test';

// CI serves the production bundle, which cannot serve the source fixture or
// React refresh modules. Give these component checks their own Vite server.
const test = base.extend<object, { calendarFixtureURL: string }>({
  calendarFixtureURL: [
    async ({ browserName }, use, workerInfo) => {
      const { createServer } = await import('vite');
      const server = await createServer({
        cacheDir: `node_modules/.vite/calendar-popup-${browserName}-${workerInfo.workerIndex}`,
        logLevel: 'error',
        optimizeDeps: { entries: ['playwright/support/calendar-popup.fixture.tsx'] },
        server: { host: '127.0.0.1', port: 5173, strictPort: false },
      });

      try {
        await server.listen();
        const url = server.resolvedUrls?.local[0];

        if (!url) throw new Error('Calendar fixture server did not start');
        await use(url);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
});

for (const width of [1440, 768, 320]) {
  test(`wide calendar selection keeps its popup inside a ${width}px viewport`, async ({ page, calendarFixtureURL }) => {
    await page.setViewportSize({ width, height: 420 });
    await page.route('**/calendar-popup-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import('/playwright/support/calendar-popup.fixture.tsx');
      </script></body></html>`,
      })
    );
    await page.goto(new URL('/calendar-popup-fixture', calendarFixtureURL).href);
    await page.getByRole('button', { name: 'Selected week' }).click();
    const popup = page.locator('[data-slot="popover-content"]');

    await expect(popup).toBeVisible();
    await expect
      .poll(async () => {
        const rect = await popup.boundingBox();

        return (
          !!rect && rect.x >= 19 && rect.y >= 19 && rect.x + rect.width <= width - 19 && rect.y + rect.height <= 401
        );
      })
      .toBe(true);
    await page.getByRole('button', { name: 'Last property' }).click();
    await expect(page.getByRole('button', { name: 'Last property' })).toBeInViewport();
  });
}
