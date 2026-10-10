import { readFileSync } from 'fs';

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { ShareSelectors } from './selectors';
import { TestConfig } from './test-config';

type WidgetExpectation =
  | { kind: 'number'; value: string }
  | { kind: 'chart'; values: { label: string; value: string }[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'grid'; rowCount: number; rowText: string };

interface SavedWidget {
  view: string;
  viewId: string;
  databaseId: string;
  layout: string;
  expected: WidgetExpectation;
}

export interface SavedDashboard {
  key: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  spaceId: string;
  dashboardViewId: string;
  hostPageId: string;
  hostDatabaseId: string;
  sourcePageIds: string[];
  widgets: SavedWidget[];
}

const savedDashboards = JSON.parse(readFileSync(
  new URL('../fixtures/dashboard-publish-showcase.json', import.meta.url), 'utf8'
)) as SavedDashboard[];

interface Envelope<T> {
  code?: number;
  data?: T;
}

interface FolderView {
  view_id: string;
  name: string;
  children?: FolderView[];
}

export interface PublishedInfo {
  view_id: string;
  namespace: string;
  publish_name: string;
}

export function savedDashboard(key: string): SavedDashboard {
  const fixture = savedDashboards.find((item) => item.key === key);

  if (!fixture) throw new Error(`Unknown saved dashboard fixture: ${key}`);
  return fixture;
}

export function fixturePublicationIds(fixture: SavedDashboard): string[] {
  return [...new Set([fixture.dashboardViewId, fixture.hostPageId, ...fixture.sourcePageIds,
    ...fixture.widgets.map((widget) => widget.viewId)])];
}

async function apiData<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json() as Envelope<T>;

  expect(response.ok(), `GET ${path}: HTTP ${response.status()}`).toBe(true);
  expect(body.code, `GET ${path}: API result`).toBe(0);
  if (body.data === undefined) throw new Error(`GET ${path}: missing response data`);
  return body.data;
}

export async function assertSavedWorkspace(
  request: APIRequestContext,
  token: string,
  fixture: SavedDashboard
) {
  const workspaces = await apiData<{ workspace_id: string; workspace_name: string }[]>(
    request, token, '/api/workspace?include_member_count=true'
  );
  const workspace = workspaces.find((item) => item.workspace_id === fixture.workspaceId);

  expect(workspace?.workspace_name.toLowerCase(), 'Restore the saved Pro workspace fixture').toBe(
    fixture.workspaceName.toLowerCase()
  );
  const space = await apiData<FolderView>(
    request, token, `/api/workspace/${fixture.workspaceId}/view/${fixture.spaceId}?depth=3`
  );

  expect(space.name).toBe('dashboards');
  const flatten = (view: FolderView): FolderView[] => [view, ...(view.children ?? []).flatMap(flatten)];
  const views = flatten(space);

  expect(views.find((view) => view.view_id === fixture.dashboardViewId)?.name).toBe(fixture.title);
  for (const pageId of fixture.sourcePageIds) {
    expect(views.some((view) => view.view_id === pageId), `Source page ${pageId} belongs to dashboards`).toBe(true);
  }
}

/** This probe never sends the owner's token: it is also the public widget loader's lookup. */
export async function publishedInfo(request: APIRequestContext, viewId: string): Promise<PublishedInfo | undefined> {
  const response = await request.get(`${TestConfig.apiUrl}/api/workspace/v1/published-info/${viewId}`);
  const body = await response.json() as Envelope<PublishedInfo>;

  if (response.ok() && body.code === 0 && body.data) return body.data;
  // RecordNotFound is the expected unpublished state; transport/server failures must fail the precondition.
  expect(response.status(), `Public lookup ${viewId} must not fail on the server`).toBeLessThan(500);
  expect(body.code, `Public lookup ${viewId} must be an unpublished response`).toBe(-2);
  return undefined;
}

export async function requireUnpublishedFixture(request: APIRequestContext, fixture: SavedDashboard) {
  for (const viewId of fixturePublicationIds(fixture)) {
    expect(
      await publishedInfo(request, viewId),
      `Fixture view ${viewId} is already published. Unpublish these fixture pages before testing fresh publication.`
    ).toBeUndefined();
  }
}

async function savedPublicationIdentity(request: APIRequestContext, token: string, fixture: SavedDashboard) {
  // Unpublish removes public access, while the existing URL/config identity is
  // deliberately retained. Prefer a saved child config, then the legacy host.
  for (const viewId of [fixture.dashboardViewId, fixture.hostPageId]) {
    const path = `/api/workspace/${fixture.workspaceId}/publish/${viewId}/config`;
    const response = await request.get(`${TestConfig.apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json() as Envelope<unknown>;

    if (response.ok() && body.code === 0 && body.data) return viewId;
    expect(response.status(), `Read saved publication config ${viewId}`).toBeLessThan(500);
    expect(body.code, `Publication config ${viewId} is absent`).toBe(-2);
  }

  return fixture.dashboardViewId;
}

export async function publishSelectedDashboard(
  page: Page,
  request: APIRequestContext,
  token: string,
  fixture: SavedDashboard
): Promise<string> {
  const expectedPublicationId = await savedPublicationIdentity(request, token, fixture);

  await expect(page.getByTestId(`view-tab-${fixture.dashboardViewId}`)).toHaveAttribute('data-state', 'active');
  await ShareSelectors.shareButton(page).click();
  await expect(ShareSelectors.sharePopover(page)).toBeVisible();
  await ShareSelectors.sharePopover(page).getByRole('tab', { name: 'Publish', exact: true }).click();
  await expect(ShareSelectors.publishConfirmButton(page)).toBeEnabled({ timeout: 30_000 });

  const responsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/publish');
  }, { timeout: 60_000 });

  await ShareSelectors.publishConfirmButton(page).click();
  const response = await responsePromise;

  expect(new URL(response.url()).pathname).toBe(`/api/workspace/${fixture.workspaceId}/publish`);
  const requestBody = response.request().postDataBuffer();

  if (!requestBody || requestBody.length < 8) throw new Error('Missing database publish stream');
  const metadataLength = requestBody.readUInt32LE(0);
  const metadata = JSON.parse(requestBody.subarray(4, 4 + metadataLength).toString('utf8')) as { view_id: string };

  expect(metadata.view_id, 'Share must preserve the canonical publication identity').toBe(expectedPublicationId);
  const dataOffset = 4 + metadataLength;
  const dataLength = requestBody.readUInt32LE(dataOffset);
  const data = JSON.parse(requestBody.subarray(dataOffset + 4, dataOffset + 4 + dataLength).toString('utf8')) as {
    visible_database_view_ids: string[];
  };

  expect(data.visible_database_view_ids, 'The publication must include the dashboard and its host views').toEqual(
    expect.arrayContaining([
      fixture.dashboardViewId,
      ...fixture.widgets.filter((widget) => widget.databaseId === fixture.hostDatabaseId).map((widget) => widget.viewId),
    ])
  );
  expect(response.ok(), `Publish HTTP ${response.status()}`).toBe(true);
  expect((await response.json() as Envelope<unknown>).code, 'Publish API result').toBe(0);
  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 30_000 });
  const namespace = (await ShareSelectors.publishNamespace(page).innerText()).trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

  expect(namespace).not.toBe('');
  expect(publishName).not.toBe('');
  const info = await publishedInfo(request, expectedPublicationId);

  expect(info?.view_id).toBe(expectedPublicationId);
  expect(info?.namespace).toBe(namespace);
  expect(info?.publish_name).toBe(publishName);
  await page.keyboard.press('Escape');
  return `${new URL(page.url()).origin}/${namespace}/${publishName}`;
}

export async function selectPublishedDashboard(page: Page, fixture: SavedDashboard) {
  const tab = page.getByTestId(`view-tab-${fixture.dashboardViewId}`);

  await expect(tab).toBeVisible({ timeout: 60_000 });
  // A retained container publication may initially select its Grid tab. Reach
  // the dashboard through the actual public UI, without inventing a route.
  await tab.click();
  await expect(tab).toHaveAttribute('data-state', 'active');
}

/** Unpublish only this scenario's fixture IDs. Database contents are never removed or edited. */
export async function unpublishFixture(request: APIRequestContext, token: string, fixture: SavedDashboard) {
  const failures: string[] = [];

  for (const viewId of fixturePublicationIds(fixture)) {
    try {
      if (!await publishedInfo(request, viewId)) continue;
      const response = await request.post(
        `${TestConfig.apiUrl}/api/workspace/${fixture.workspaceId}/page-view/${viewId}/unpublish`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const body = await response.json() as Envelope<unknown>;

      expect(response.ok(), `Unpublish ${viewId}: HTTP ${response.status()}`).toBe(true);
      expect(body.code, `Unpublish ${viewId}: API result`).toBe(0);
      expect(await publishedInfo(request, viewId), `Fixture view ${viewId} must no longer be public`).toBeUndefined();
    } catch (error) {
      // One failed publication must not leave the other fixture sources public.
      failures.push(`${viewId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Saved dashboard publication cleanup failed:\n${failures.join('\n')}`);
  }
}

async function assertWidgetContent(widget: Locator, expected: WidgetExpectation) {
  switch (expected.kind) {
    case 'number':
      await expect(widget.getByTestId('number-chart')).toHaveAttribute('data-empty', 'false');
      await expect(widget.getByTestId('number-chart-value')).toHaveText(expected.value);
      return;
    case 'chart':
      await expect.poll(async () => widget.getByTestId('chart-data-table').locator('tr[data-label]').evaluateAll(
        (rows) => rows.map((row) => ({
          label: row.getAttribute('data-label'), value: row.getAttribute('data-value'),
        }))
      ), { timeout: 60_000 }).toEqual(expected.values);
      // The accessible data table also exists when a plot has zero size. Prove
      // visitors can see the chart itself, not just its diagnostic row values.
      await expect(widget.locator('svg.recharts-surface').first()).toBeVisible();
      await expect(widget.locator(
        'svg.recharts-surface .recharts-pie-sector path, ' +
        'svg.recharts-surface [data-testid="chart-bar-segment"], ' +
        'svg.recharts-surface .recharts-line-curve'
      ).first()).toBeVisible();
      return;
    case 'list':
      await expect(widget.getByTestId('database-list')).toBeVisible();
      await expect(widget.locator('[data-testid^="list-primary-cell-"]')).toHaveText(expected.items);
      return;
    case 'grid':
      await expect(widget.getByTestId('database-grid')).toHaveAttribute('data-row-count', `${expected.rowCount}`);
      await expect(widget.getByTestId('database-grid')).not.toHaveAttribute('data-hydrating', 'true');
      await expect(widget.getByTestId('database-grid')).toContainText(expected.rowText);
  }
}

export async function assertPublishedDashboard(page: Page, fixture: SavedDashboard) {
  await expect(page.getByTestId(`view-tab-${fixture.dashboardViewId}`)).toHaveAttribute('data-state', 'active');
  const widgets = page.getByTestId('dashboard-widget');

  await expect(widgets).toHaveCount(fixture.widgets.length, { timeout: 60_000 });
  expect(await widgets.evaluateAll((items) => items.map((item) => ({
    viewId: item.getAttribute('data-view-id'), databaseId: item.getAttribute('data-database-id'),
  })))).toEqual(fixture.widgets.map(({ viewId, databaseId }) => ({ viewId, databaseId })));

  for (const expected of fixture.widgets) {
    const widget = page.locator(`[data-testid="dashboard-widget"][data-view-id="${expected.viewId}"]`);

    // Native immediate scrolling avoids actionability retries on the dashboard's sticky/virtual layout.
    await widget.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
    await expect(widget).toBeInViewport({ ratio: 0.1 });
    await expect(widget.getByTestId('dashboard-widget-placeholder'), expected.view).toHaveCount(0, { timeout: 60_000 });
    await expect(widget.getByTestId('dashboard-widget-rows-failed'), expected.view).toHaveCount(0);
    await assertWidgetContent(widget, expected.expected);
  }

  // Public rendering must not accidentally fall back to an authenticated workspace session.
  expect(await page.evaluate(() => localStorage.getItem('token') || localStorage.getItem('af_auth_token'))).toBeNull();
}
