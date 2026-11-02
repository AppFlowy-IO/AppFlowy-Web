import { expect, test, type Page } from '@playwright/test';

import { waitForDashboardWidgetsLoaded } from '../../support/dashboard-shared-helpers';
import { openWidgetMenu } from '../../support/dashboard-test-helpers';

async function deferredWidgets(page: Page, holdFirst = false) {
  await page.setContent(`
    <style>
      #scroller { height: 500px; overflow: auto; }
      #widgets { display: grid; grid-template-columns: repeat(2, 300px); gap: 16px; }
      section { height: 300px; }
    </style>
    <div id="scroller"><div id="widgets">
      ${Array.from({ length: 8 }, (_, index) => `
        <section data-testid="dashboard-widget" data-index="${index}">
          <div data-testid="dashboard-widget-placeholder" data-reason="loading" aria-busy="true">Loading</div>
        </section>`).join('')}
    </div></div>
    <script>
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || (${holdFirst} && entry.target.dataset.index === '0')) continue;
          observer.unobserve(entry.target);
          const button = document.createElement('button');
          button.dataset.testid = 'dashboard-widget-title-button';
          button.textContent = 'Widget ' + (Number(entry.target.dataset.index) + 1);
          button.addEventListener('click', () => {
            const menu = document.createElement('div');
            menu.dataset.testid = 'dashboard-widget-menu';
            menu.textContent = button.textContent;
            document.body.append(menu);
          });
          entry.target.replaceChildren(button);
        }
      }, { root: document.querySelector('#scroller') });
      document.querySelectorAll('section').forEach((widget) => observer.observe(widget));
    </script>
  `);
}

test('opens an off-screen widget menu after its deferred content enters the viewport', async ({ page }) => {
  await deferredWidgets(page);
  const widgets = page.getByTestId('dashboard-widget');
  const last = widgets.last();

  await expect(page.getByTestId('dashboard-widget-placeholder')).toHaveCount(4);
  await expect(last).not.toBeInViewport();
  await openWidgetMenu(page, last);

  await expect(page.getByTestId('dashboard-widget-menu')).toHaveText('Widget 8');
  await expect(last.getByTestId('dashboard-widget-placeholder')).toHaveCount(0);
});

test('loads every widget in a nested scroll container before requiring global readiness', async ({ page }) => {
  await deferredWidgets(page);
  const widgets = page.getByTestId('dashboard-widget');

  await expect(page.getByTestId('dashboard-widget-placeholder')).toHaveCount(4);
  await waitForDashboardWidgetsLoaded(widgets);

  await expect(page.getByTestId('dashboard-widget-placeholder')).toHaveCount(0);
  await expect(widgets.last()).toBeInViewport();
  await expect(page.getByTestId('dashboard-widget-menu')).toHaveCount(0);
});

test('keeps rejecting a widget whose content never loads in the viewport', async ({ page }) => {
  await deferredWidgets(page, true);
  const first = page.getByTestId('dashboard-widget').first();

  await expect(first).toBeInViewport();
  await expect(waitForDashboardWidgetsLoaded(first, 250)).rejects.toThrow(/toHaveCount/);
  await expect(first.getByTestId('dashboard-widget-placeholder')).toHaveCount(1);
  await expect(page.getByTestId('dashboard-widget-menu')).toHaveCount(0);
});
