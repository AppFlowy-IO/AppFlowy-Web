import type { Page } from '@playwright/test';

/** Mounts a test-only component fixture without registering a product route. */
export async function openDocumentSourceFixture(page: Page, theme?: string) {
  await page.route('**/presentation-document-source-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-document-source.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto(`/presentation-document-source-fixture${theme ? `?theme=${theme}` : ''}`);
}
