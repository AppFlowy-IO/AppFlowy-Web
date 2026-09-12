import { expect, test as base, type Locator } from '@playwright/test';

// CI serves the production bundle, which cannot serve the source fixture or
// React refresh modules. Give these component checks their own Vite server.
const test = base.extend<{}, { calendarFixtureURL: string }>({
  calendarFixtureURL: [
    async ({}, use, workerInfo) => {
      const { createServer } = await import('vite');
      const server = await createServer({
        cacheDir: `node_modules/.vite/calendar-event-colors-${workerInfo.workerIndex}`,
        logLevel: 'error',
        optimizeDeps: { entries: ['playwright/support/calendar-event-colors.fixture.tsx'] },
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

test.describe.configure({ mode: 'default' });

async function foreground(locator: Locator) {
  return locator.evaluate((element) => {
    let opacity = 1;

    for (let node: Element | null = element; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
      if (node.classList.contains('fc-event')) break;
    }

    return { color: getComputedStyle(element).color, opacity };
  });
}

for (const dark of [false, true]) {
  test(`calendar event colors follow Figma in ${dark ? 'dark' : 'light'} mode`, async ({
    page,
    calendarFixtureURL,
  }, testInfo) => {
    await page.route('**/calendar-color-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html data-dark-mode="${dark}"><body id="body" style="background:var(--background-primary)"><div id="root"></div>
        <script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          await import('/playwright/support/calendar-event-colors.fixture.tsx');
        </script></body></html>`,
      })
    );
    await page.goto(new URL('/calendar-color-fixture', calendarFixtureURL).href);
    // The first request compiles the component graph on a cold CI worker.
    await expect(page.getByTestId('week-long-normal')).toBeVisible({ timeout: 60_000 });
    const eventText = dark ? 'rgb(169, 226, 255)' : 'rgb(0, 101, 169)';
    const primaryText = dark ? 'rgb(228, 232, 245)' : 'rgb(33, 35, 42)';
    const normalFill = dark ? 'rgb(0, 60, 119)' : 'rgb(227, 246, 255)';
    const hoverFill = dark ? 'rgb(0, 80, 143)' : 'rgb(198, 236, 255)';
    const kinds = [
      'week-long',
      'week-short',
      'week-all-day',
      'month-timed',
      'month-range',
      'month-all-day',
      'popover-timed',
      'popover-all-day',
    ];

    for (const kind of kinds) {
      for (const phase of ['normal', 'past']) {
        const id = `${kind}-${phase}`;
        const card = page.getByTestId(id);
        const title = card.getByText(id).last();
        const neutral = kind.endsWith('timed');
        const color = neutral ? primaryText : eventText;
        const opacity = phase === 'past' ? 0.5 : 1;
        const weekTimed = kind === 'week-long' || kind === 'week-short';
        const fill = weekTimed ? card : card.locator('.event-content');

        await expect(card).toBeVisible();
        expect(await foreground(title)).toEqual({ color, opacity });
        if (await card.locator('.time-slot').count()) {
          expect(await foreground(card.locator('.time-slot').first())).toEqual({ color, opacity });
        }

        if (await card.locator('.event-icon').count()) {
          expect(await foreground(card.locator('.event-icon'))).toEqual({ color, opacity });
        }

        if (!neutral) await expect(fill).toHaveCSS('background-color', normalFill);
        const accent = await card.evaluate((element, weekTimed) => {
          const target = element.querySelector(weekTimed ? '.fc-event-main' : '.event-line')!;
          const style = getComputedStyle(target, weekTimed ? '::before' : null);

          return { color: style.backgroundColor, opacity: Number(style.opacity) };
        }, weekTimed);

        expect(accent).toEqual({ color: 'rgb(0, 181, 255)', opacity: phase === 'past' ? 0.4 : 1 });
        await card.hover();
        expect(await foreground(title)).toEqual({ color, opacity: 1 });
        if (!neutral) await expect(fill).toHaveCSS('background-color', hoverFill);

        // Open/drag beats hover, and closing restores the same past/default appearance.
        if (kind.startsWith('popover')) {
          await card.evaluate((element) => element.classList.add('event-hovered'));
        }

        for (const activeClass of ['fc-event-open', 'fc-event-dragging', 'fc-event-resizing']) {
          await card.evaluate((element, activeClass) => element.classList.add(activeClass), activeClass);
          await expect(fill).toHaveCSS('background-color', 'rgb(0, 181, 255)');
          expect(await foreground(title)).toEqual({ color: 'rgb(255, 255, 255)', opacity: 1 });
          if (await card.locator('.time-slot').count()) {
            expect(await foreground(card.locator('.time-slot').first())).toEqual({
              color: 'rgb(255, 255, 255)',
              opacity: 1,
            });
          }

          if (await card.locator('.event-icon').count()) {
            expect(await foreground(card.locator('.event-icon'))).toEqual({ color: 'rgb(255, 255, 255)', opacity: 1 });
          }

          const accentOpacity = await card.evaluate((element, weekTimed) => {
            const target = element.querySelector(weekTimed ? '.fc-event-main' : '.event-line')!;

            return getComputedStyle(target, weekTimed ? '::before' : null).opacity;
          }, weekTimed);

          expect(accentOpacity).toBe('0');
          await card.evaluate((element, activeClass) => element.classList.remove(activeClass), activeClass);
        }

        await card.evaluate((element) => element.classList.remove('event-hovered'));

        await page.mouse.move(1300, 850);
        expect(await foreground(title)).toEqual({ color, opacity });
      }
    }

    await page.screenshot({ path: testInfo.outputPath(`calendar-colors-${dark ? 'dark' : 'light'}.png`) });
  });
}
