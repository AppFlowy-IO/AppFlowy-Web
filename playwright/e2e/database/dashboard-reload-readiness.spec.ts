import { expect, test, type Page } from '@playwright/test';

import { expectTemplateChartValues } from '../../support/dashboard-template-1-helpers';
import { registerDashboardWorld, seedDashboardWidgets } from '../../support/dashboard-test-helpers';
import { expectWidgetTitles } from '../../support/dashboard-usecase-helpers';
import { dismissAutoCreateDialogIfPresent } from '../../support/form-test-helpers';

function registerFixture(page: Page) {
  registerDashboardWorld(page, {
    runId: 'readiness',
    owner: { accessToken: '', refreshToken: '', tokenData: {} },
    workspaceId: 'workspace',
    spaceId: 'space',
    spaceName: 'Readiness',
    dashboardViewId: 'dashboard',
    databases: {
      Projects: {
        name: 'Projects', spaceId: 'space', pageId: 'projects', databaseId: 'database',
        fieldIds: { Name: 'name' }, rowIds: {}, views: { Grid: 'grid', Form: 'form' },
      },
    },
    viewsByName: {
      'Average spend by category': { viewId: 'chart', database: 'Projects' },
      Queue: { viewId: 'grid', database: 'Projects' },
    },
    widgets: {
      'Average spend by category': { id: 'chart-widget', viewId: 'chart', databaseId: 'database' },
      Queue: { id: 'queue-widget', viewId: 'grid', databaseId: 'database' },
    },
  });
}

async function reloadedDeferredWidget(page: Page, id: string, content: string) {
  await page.route('http://dashboard.test/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `
      <style>#scroller { height: 500px; overflow: auto; } #spacer { height: 1000px; } section { height: 300px; }</style>
      <div id="scroller"><div id="spacer"></div>
        <section data-testid="dashboard-widget" data-widget-id="${id}">
          <div data-testid="dashboard-widget-placeholder" data-reason="loading" aria-busy="true">Loading</div>
        </section>
      </div>
      <script>
        const widget = document.querySelector('section');
        const observer = new IntersectionObserver(([entry]) => {
          if (!entry.isIntersecting) return;
          widget.innerHTML = ${JSON.stringify(content)};
          observer.disconnect();
        }, { root: document.querySelector('#scroller') });
        observer.observe(widget);
      </script>`,
  }));
  await page.goto('http://dashboard.test/');
  await page.reload();
  registerFixture(page);
  await expect(page.getByTestId('dashboard-widget')).not.toBeInViewport();
  await expect(page.getByTestId('dashboard-widget-placeholder')).toHaveCount(1);
}

test('chart value checks bring deferred content into view after a dashboard reload', async ({ page }) => {
  await reloadedDeferredWidget(page, 'chart-widget', `
    <div data-testid="chart-frame">Chart</div>
    <table data-testid="chart-data-table" hidden><tr data-label="Paid ads" data-value="8100"></tr></table>`);

  await expectTemplateChartValues(page, 'Average spend by category', [{ label: 'Paid ads', value: '8,100' }]);

  await expect(page.getByTestId('dashboard-widget')).toBeInViewport();
  await expect(page.getByTestId('dashboard-widget-placeholder')).toHaveCount(0);
});

test('row title checks load a deferred queue after a dashboard reload', async ({ page }) => {
  await reloadedDeferredWidget(page, 'queue-widget', `
    <div data-testid="database-grid">
      <div data-testid="grid-row-ticket"><div data-testid="grid-cell-ticket-name">SSO login loops</div></div>
    </div>`);

  await expectWidgetTitles(page, page, 'Queue', ['SSO login loops']);

  await expect(page.getByTestId('dashboard-widget')).toBeInViewport();
  await expect(page.getByTestId('dashboard-widget-placeholder')).toHaveCount(0);
});

test('seeded Form startup is dismissed through its UI before Edit mode is restored', async ({ page }) => {
  registerFixture(page);
  await page.setContent(`
    <button data-testid="dashboard-done-button">Done</button>
    <output id="dismissals">0</output><output id="edits">0</output>
    <script>
      const setting = new Map();
      const originalSet = setting.set.bind(setting);
      setting.set = (key, value) => {
        originalSet(key, value);
        if (key !== 'rows') return setting;
        document.querySelector('[data-testid="dashboard-done-button"]').outerHTML =
          '<button data-testid="dashboard-edit-button">Edit</button>';
        document.querySelector('[data-testid="dashboard-edit-button"]').addEventListener('click', (event) => {
          document.querySelector('#edits').textContent = '1';
          event.target.outerHTML = '<button data-testid="dashboard-done-button">Done</button>';
        });
        for (const widget of value.flatMap(row => row.widgets)) {
          const element = document.createElement('section');
          element.dataset.testid = 'dashboard-widget';
          element.dataset.widgetId = widget.id;
          element.innerHTML = '<div data-testid="form-builder-scroll-container">Questions</div>';
          document.body.append(element);
        }
        const modal = document.createElement('div');
        modal.dataset.testid = 'form-auto-create-dialog';
        modal.style = 'position:fixed;inset:0;background:white;z-index:100';
        modal.innerHTML = '<button data-testid="form-auto-create-start-from-scratch">Start from scratch</button>';
        modal.querySelector('button').addEventListener('click', () => {
          document.querySelector('#dismissals').textContent = '1';
          modal.remove();
        });
        document.body.append(modal);
        return setting;
      };
      const layouts = new Map([['9', setting]]);
      const view = new Map([['layout_settings', layouts]]);
      const database = new Map([['views', new Map([['dashboard', view]])]]);
      const doc = { getMap: () => new Map([['database', database]]), transact: run => run() };
      window.Y = { Map };
      window.__DASHBOARD_TEST__ = { byView: () => ({ databaseDoc: doc }) };
    </script>
  `);

  await seedDashboardWidgets(page, [{ row: 1, label: 'Projects Form' }], async () => {
    await expect(page.getByTestId('form-builder-scroll-container')).toBeVisible();
    await dismissAutoCreateDialogIfPresent(page);
  });

  await expect(page.getByTestId('form-auto-create-dialog')).toHaveCount(0);
  await expect(page.getByTestId('form-builder-scroll-container')).toHaveText('Questions');
  await expect(page.getByTestId('dashboard-done-button')).toBeVisible();
  await expect(page.locator('#dismissals')).toHaveText('1');
  await expect(page.locator('#edits')).toHaveText('1');
});
