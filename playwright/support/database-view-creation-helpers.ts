import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type * as Y from 'yjs';

import { DatabaseViewLayout, SubscriptionInterval, ViewLayout, type PricingCatalog } from '../../src/application/types';
import { signInAndWaitForApp } from './auth-flow-helpers';
import { createDatabaseView, waitForGridReady } from './database-ui-helpers';
import { createDocumentPageAndNavigate } from './page-utils';
import { ChartSelectors, DatabaseViewSelectors, FormSelectors } from './selectors';
import { generateRandomEmail, TestConfig } from './test-config';

type FolderView = {
  view_id: string;
  layout: number;
  extra?: { is_database_container?: boolean } | string;
  children?: FolderView[];
};
type Quota = { can_create_form: boolean; can_create_chart: boolean };
type DatabaseSnapshot = { activeId: string; views: Array<{ id: string; layout: number }> };
type TestWindow = Window & {
  __TEST_DATABASE_CONTEXT__?: { databaseDoc: Y.Doc; activeViewId: string };
  __TEST_EDITORS__?: Record<string, { children: unknown[] }>;
};

const pricingCatalog: PricingCatalog = {
  version: 1,
  currency: 'USD',
  annual_discount_percent: 20,
  plans: [
    { id: 'free', kind: 'workspace_plan', name: 'Free', description: '', prices: [], features: [] },
    {
      id: 'pro',
      kind: 'workspace_plan',
      name: 'Pro',
      description: 'For professional work and teams',
      prices: [
        { interval: SubscriptionInterval.Month, price_cents: 2000 },
        { interval: SubscriptionInterval.Year, price_cents: 19200 },
      ],
      features: [],
    },
  ],
  comparison: [],
};

/** Real auth, folder inventory, quota reads and creation; only billing is simulated. */
export class DatabaseViewCreationFixture {
  private workspaceId = '';
  private databaseUrl = '';
  private documentId = '';
  private createdIds = new Map<string, string>();
  private checkouts: Array<{ url: URL; authorized: boolean; destination: string }> = [];
  private beforeUpgrade?: {
    tabs: DatabaseSnapshot | null;
    inventory: string[];
    document: string | null;
    sourceUrl: string;
    checkouts: number;
    pages: number;
  };
  private creationRequests = 0;
  private requestsBeforeUpgrade = 0;

  constructor(private page: Page, private request: APIRequestContext) {}

  async initialize(): Promise<void> {
    const info = await this.read<{ self_hosted: boolean }>('/api/server-info');

    expect(info.self_hosted, 'This scenario needs a real hosted server; self-hosted bypasses quotas').toBe(false);

    const context = this.page.context();

    for (const route of ['**/billing/api/v1/active-subscription/**', '**/billing/api/v1/subscriptions']) {
      await context.route(route, (route) => route.fulfill({ json: { code: 0, message: '', data: [] } }));
    }

    await context.route('**/billing/api/v1/pricing', (route) =>
      route.fulfill({ json: { code: 0, message: '', data: pricingCatalog } })
    );
    await context.route('**/billing/api/v1/subscription-link?**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const destination = `https://checkout.example.invalid/pro/${url.searchParams.get('recurring_interval')}/${this.checkouts.length + 1}`;

      this.checkouts.push({
        url,
        authorized: /^Bearer \S+$/.test(request.headers().authorization ?? ''),
        destination,
      });
      await route.fulfill({ json: { code: 0, message: '', data: destination } });
    });
    await context.route('https://checkout.example.invalid/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Test Pro checkout</title>' })
    );
    // Watch accepted UI paths, not test-owned API reads. An upgrade must never
    // accidentally submit a creation request even if the server rejects it.
    this.page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/api\/workspace\/.*\/(page-view|database-view)$/.test(new URL(request.url()).pathname)
      ) {
        this.creationRequests += 1;
      }
    });
    await signInAndWaitForApp(this.page, this.request, generateRandomEmail(), 0);
    const workspace = await this.read<{
      visiting_workspace: { workspace_id: string; role?: string; owner_uid: number | string };
      user_profile: { uid: number | string };
    }>('/api/user/workspace');

    this.workspaceId = workspace.visiting_workspace.workspace_id;
    expect(
      workspace.visiting_workspace.role === 'Owner' ||
        String(workspace.visiting_workspace.owner_uid) === String(workspace.user_profile.uid),
      'The disposable account must own its workspace'
    ).toBe(true);
    await this.expectCounts(0, 0);
    await createDatabaseView(this.page, 'Grid', 0);
    await waitForGridReady(this.page);
    this.databaseUrl = this.page.url();
  }

  async expectCrowns(surface: string, layouts: string[]): Promise<void> {
    await this.openMenu(surface);
    for (const layout of ['Form', 'Chart', 'Timeline']) {
      const item = this.item(layout, surface);

      await expect(item).toBeEnabled();
      await expect(item.getByLabel('Pro')).toHaveCount(layouts.includes(layout) ? 1 : 0);
    }
  }

  async createFirst(layout: string): Promise<void> {
    expect(['Form', 'Chart']).toContain(layout);
    await this.openMenu('tab');
    const before = await this.databaseSnapshot();
    const item = this.item(layout, 'tab');

    await expect(item).toBeEnabled();
    await expect(item.getByLabel('Pro')).toHaveCount(0);
    await item.click();
    if (layout === 'Form') {
      await expect(FormSelectors.previewButton(this.page)).toBeVisible();
      // The default Grid has enough supported fields to offer auto-creation.
      await expect(FormSelectors.autoCreateDialog(this.page)).toBeVisible();
      await FormSelectors.autoCreateStartFromScratch(this.page).click();
      await expect(FormSelectors.autoCreateDialog(this.page)).toBeHidden();
    } else {
      await expect(ChartSelectors.chart(this.page)).toBeVisible();
    }

    await expect.poll(async () => (await this.databaseSnapshot()).views.length).toBe(before.views.length + 1);
    const after = await this.databaseSnapshot();
    const created = after.views.filter((view) => !before.views.some((previous) => previous.id === view.id));

    expect(created).toEqual([
      { id: after.activeId, layout: layout === 'Form' ? DatabaseViewLayout.Form : DatabaseViewLayout.Chart },
    ]);
    this.createdIds.set(layout, after.activeId);

    expect(this.checkouts).toHaveLength(0);
  }

  async expectCounts(forms: number, charts: number): Promise<void> {
    await expect
      .poll(
        async () => {
          const views = await this.inventory();

          return [
            views.filter((view) => view.layout === ViewLayout.Form).length,
            views.filter((view) => view.layout === ViewLayout.Chart).length,
          ];
        },
        { timeout: 30_000, message: 'Persisted Cloud Form/Chart counts' }
      )
      .toEqual([forms, charts]);
    const inventory = await this.inventory();

    for (const id of this.createdIds.values()) expect(inventory.map((view) => view.view_id)).toContain(id);
    const quota = await this.read<Quota>(`/api/workspace/${this.workspaceId}/database-view-creation-status`);

    expect(quota, 'The real Cloud endpoint must enforce the independent Free allowances').toEqual({
      can_create_form: forms === 0,
      can_create_chart: charts === 0,
    });
  }

  async selectUpgrade(layout: string, surface: string): Promise<void> {
    await this.openMenu(surface);
    const item = this.item(layout, surface);

    await expect(item).toBeEnabled();
    await expect(item.getByLabel('Pro')).toHaveCount(1);
    await this.captureBeforeUpgrade();
    await item.click();
    await expect(this.page.getByRole('menu')).toBeHidden();
  }

  async expectPlanComparison(): Promise<void> {
    if (!this.beforeUpgrade) throw new Error('Select an upgrade before asserting plan comparison');
    await expect(this.page.getByTestId('pricing-upgrade-pro')).toBeVisible();
    expect(this.checkouts).toHaveLength(this.beforeUpgrade.checkouts);
    expect(this.page.context().pages()).toHaveLength(this.beforeUpgrade.pages);
    await this.expectUnchangedContent();
  }

  async chooseBillingPeriod(period: string): Promise<void> {
    const interval = this.intervalFor(period);

    await this.page.getByTestId('pricing-upgrade-pro').click();
    await expect(this.page.getByTestId('period-option-month')).toContainText('$20');
    await expect(this.page.getByTestId('period-option-year')).toContainText('$192');
    await this.page.getByTestId(`period-option-${interval}`).click();
    await expect(this.page.getByTestId('change-period-confirm')).toBeEnabled();
    await this.page.getByTestId('change-period-confirm').click();
  }

  async expectCheckout(period: string, count: number): Promise<void> {
    if (!this.beforeUpgrade) throw new Error('Select an upgrade before asserting checkout');
    const interval = this.intervalFor(period);

    await expect.poll(() => this.checkouts.length).toBe(count);
    const checkout = this.checkouts[count - 1];

    expect(checkout.authorized, 'Checkout uses authenticated billing').toBe(true);
    expect(checkout.url.searchParams.get('workspace_id')).toBe(this.workspaceId);
    expect(checkout.url.searchParams.get('workspace_subscription_plan')).toBe('pro');
    expect(checkout.url.searchParams.get('recurring_interval')).toBe(interval);
    // Checkout may replace the app tab or open another browsing context. Observe
    // the actual destination rather than waiting for a popup before confirmation.
    await expect.poll(() => this.page.context().pages().some((page) => page.url() === checkout.destination)).toBe(true);
    const checkoutPage = this.page.context().pages().find((page) => page.url() === checkout.destination);

    if (!checkoutPage) throw new Error('The confirmed checkout page is not available');
    await expect(checkoutPage).toHaveURL(checkout.destination);
    if (checkoutPage === this.page) {
      await this.page.goto(this.beforeUpgrade.sourceUrl);
      await this.page.waitForFunction(
        (documentId) => documentId
          ? !!(window as TestWindow).__TEST_EDITORS__?.[documentId]
          : !!(window as TestWindow).__TEST_DATABASE_CONTEXT__,
        this.documentId
      );
    } else {
      await checkoutPage.close();
      await this.page.bringToFront();
      await this.page.keyboard.press('Escape');
      await expect(this.page.getByTestId('pricing-upgrade-pro')).toBeHidden();
    }

    await this.expectUnchangedContent();
    await this.expectCounts(1, 1);
    expect(this.creationRequests).toBe(this.requestsBeforeUpgrade);
    expect(this.checkouts).toHaveLength(count);
    this.beforeUpgrade = undefined;
  }

  async reload(): Promise<void> {
    await this.page.goto(this.databaseUrl);
    await waitForGridReady(this.page);

    await expect(DatabaseViewSelectors.viewTab(this.page)).toHaveCount(3);
  }

  async openDocument(): Promise<void> {
    this.documentId = await createDocumentPageAndNavigate(this.page);
  }

  async selectSlashUpgrade(key: string, method: string): Promise<void> {
    expect(['chart', 'linkedChart', 'timeline', 'linkedTimeline']).toContain(key);
    expect(['click', 'Enter']).toContain(method);
    const editor = this.page.locator(`#editor-${this.documentId}`);

    await editor.click();
    await this.page.keyboard.press('ControlOrMeta+A');
    const query = key.startsWith('linked') ? `linked ${key.slice(6).toLowerCase()}` : key;

    await editor.pressSequentially(`/${query}`, { delay: 25 });
    const item = this.page.getByTestId(`slash-menu-${key}`);

    await expect(item).toBeVisible();
    await expect(item.getByLabel('Pro')).toHaveCount(1);
    await expect(item).toHaveAttribute('aria-disabled', 'false');
    await this.captureBeforeUpgrade();
    if (method === 'Enter') await this.page.keyboard.press('Enter');
    else await item.click();
    await expect(this.page.getByTestId('slash-panel')).toBeHidden();
  }

  private item(layout: string, surface: string): Locator {
    if (surface === 'sidebar') {
      return this.page.getByTestId(
        layout === 'Form' ? 'add-form-button' : layout === 'Chart' ? 'add-chart-button' : 'add-timeline-page-button'
      );
    }

    if (layout === 'Form') return FormSelectors.addFormViewOption(this.page);
    if (layout === 'Timeline') return this.page.getByTestId('add-timeline-view-button');
    return this.page.getByRole('menuitem', { name: /^Chart/ });
  }

  private async openMenu(surface: string): Promise<void> {
    expect(['tab', 'sidebar']).toContain(surface);
    if (await this.item('Form', surface).isVisible()) return;
    await this.page.keyboard.press('Escape');
    if (surface === 'tab') await DatabaseViewSelectors.addViewButton(this.page).click();
    else await this.page.locator('[data-testid="inline-add-page"]:visible').first().click();
    await expect(this.item('Form', surface)).toBeVisible();
  }

  private async captureBeforeUpgrade(): Promise<void> {
    this.beforeUpgrade = {
      tabs: this.documentId ? null : await this.databaseSnapshot(),
      inventory: (await this.inventory()).map((view) => view.view_id).sort(),
      document: this.documentId ? await this.documentSnapshot() : null,
      sourceUrl: this.page.url(),
      checkouts: this.checkouts.length,
      pages: this.page.context().pages().length,
    };
    this.requestsBeforeUpgrade = this.creationRequests;
  }

  private intervalFor(period: string): SubscriptionInterval {
    expect(['monthly', 'annual']).toContain(period);

    return period === 'monthly' ? SubscriptionInterval.Month : SubscriptionInterval.Year;
  }

  private async expectUnchangedContent(): Promise<void> {
    if (!this.beforeUpgrade) throw new Error('Capture the source content before checking an upgrade');
    const before = this.beforeUpgrade;

    if (before.tabs) await expect.poll(() => this.databaseSnapshot()).toEqual(before.tabs);
    if (before.document !== null) await expect.poll(() => this.documentSnapshot()).toBe(before.document);
    expect((await this.inventory()).map((view) => view.view_id).sort()).toEqual(before.inventory);
    expect(this.creationRequests).toBe(this.requestsBeforeUpgrade);
  }

  private async databaseSnapshot(): Promise<DatabaseSnapshot> {
    return this.page.evaluate(() => {
      const context = (window as TestWindow).__TEST_DATABASE_CONTEXT__;
      const database = context?.databaseDoc?.getMap('data').get('database') as Y.Map<unknown> | undefined;
      const views = database?.get('views') as Y.Map<Y.Map<unknown>> | undefined;

      if (!context || !views) throw new Error('The database test context is not ready');
      return {
        activeId: context.activeViewId,
        views: Array.from(views.entries())
          .map(([id, view]) => ({ id, layout: Number(view.get('layout')) }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    });
  }

  private async documentSnapshot(): Promise<string> {
    return this.page.evaluate((id) => {
      const editor = (window as TestWindow).__TEST_EDITORS__?.[id];

      if (!editor) throw new Error('The document test context is not ready');
      return JSON.stringify(editor.children);
    }, this.documentId);
  }

  private async inventory(): Promise<FolderView[]> {
    const folder = await this.read<FolderView>(`/api/workspace/${this.workspaceId}/folder?depth=10`);
    const views: FolderView[] = [];
    const visit = (view: FolderView) => {
      const extra = typeof view.extra === 'string' ? JSON.parse(view.extra) : view.extra;

      if (!extra?.is_database_container) views.push(view);
      view.children?.forEach(visit);
    };

    visit(folder);
    return views;
  }

  private async read<T>(path: string): Promise<T> {
    const token =
      this.workspaceId || path === '/api/user/workspace'
        ? await this.page.evaluate(
            () => JSON.parse(localStorage.getItem('token') ?? '{}').access_token as string | undefined
          )
        : undefined;
    const response = await this.request.get(`${TestConfig.apiUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    expect(response.ok(), `Real Cloud ${path} must be available (HTTP ${response.status()})`).toBe(true);
    const body = await response.json();

    expect(body.code, `Cloud rejected ${path}`).toBe(0);
    return body.data as T;
  }
}
