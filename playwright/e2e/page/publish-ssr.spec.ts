/**
 * Published page SSR, end to end.
 *
 * Runs against the real Bun server (deploy/server.ts) and a real AppFlowy
 * Cloud, covering what the unit tests cannot, since they mock the upstream API
 * (deploy/publish-ssr.test.ts) or the browser (ServerRenderedFallback.test.tsx):
 *
 * - the live snapshot endpoint produces a server-rendered article with the
 *   page's title, text and description;
 * - SSR stays off for a namespace that is not allowlisted;
 * - a real browser shows that article before any JavaScript runs, keeps it on
 *   screen until the app takes over (no loading spinner in between), and the
 *   app reuses the inlined snapshot instead of fetching it again.
 *
 * SSR is opt-in per namespace, so the server must be started with
 * APPFLOWY_INDEXABLE_NAMESPACES. CI's Playwright job sets it (see
 * .github/workflows/playwright-test.yml) and this spec reads the same variable
 * to know which namespaces it may claim for its workspace. Skipped when unset,
 * e.g. against the Vite dev server, which has no SSR. See doc/PUBLISH_SSR.md.
 */
import { load } from 'cheerio';
import { expect, test, type APIRequestContext } from '@playwright/test';

import { createConfirmedPasswordUser } from '../../support/auth-utils';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

const SSR_NAMESPACES = (process.env.APPFLOWY_INDEXABLE_NAMESPACES ?? '')
  .split(',')
  .map((namespace) => namespace.trim())
  .filter((namespace) => namespace.length > 0);

type ApiResponse<T> = { code: number; data?: T; message?: string };

type FolderView = { view_id: string; name: string; children?: FolderView[] };

/** Recorded in the browser from document start; see `installHandoffProbe`. */
type HandoffProbe = {
  articleSeen: boolean;
  appMounted: boolean;
  spinnerBeforeApp: boolean;
  articleGapBeforeApp: boolean;
};

const apiUrl = (path: string) => new URL(path, TestConfig.apiUrl).toString();

async function api<T>(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  data?: unknown
): Promise<T> {
  const response = await request.fetch(apiUrl(path), {
    method,
    data,
    failOnStatusCode: false,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const text = await response.text();

  expect(response.ok(), `${method} ${path}: ${text}`).toBeTruthy();

  const body = JSON.parse(text) as ApiResponse<T>;

  expect(body.code, `${method} ${path}: ${text}`).toBe(0);

  return body.data as T;
}

/** Signs up a fresh user through the API only; the browser stays anonymous. */
async function signUp(request: APIRequestContext): Promise<{ token: string; workspaceId: string }> {
  const email = generateRandomEmail();
  const password = `Ssr-e2e-${Date.now()}!`;

  await createConfirmedPasswordUser(request, email, password);

  const tokenResponse = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=password`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });

  expect(tokenResponse.ok(), await tokenResponse.text()).toBeTruthy();

  const { access_token: token } = (await tokenResponse.json()) as { access_token: string };

  // Creates the AppFlowy user and their first workspace. Retried like
  // auth-utils does, since the backend can briefly answer 502/503 under load.
  for (let attempt = 1; ; attempt += 1) {
    const verify = await request.get(apiUrl(`/api/user/verify/${token}`), { failOnStatusCode: false, timeout: 30000 });

    if (verify.ok() || attempt === 3 || ![502, 503].includes(verify.status())) {
      expect(verify.ok(), await verify.text()).toBeTruthy();
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const info = await api<{ visiting_workspace: { workspace_id: string } }>(
    request,
    token,
    'GET',
    '/api/user/workspace'
  );

  return { token, workspaceId: info.visiting_workspace.workspace_id };
}

/**
 * Moves the workspace to the first free SSR namespace. They are only freed when
 * a test releases them, so an interrupted earlier run (a retry in CI, a killed
 * local run) may still hold one; that is why there is a list.
 */
async function claimSsrNamespace(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  currentNamespace: string
): Promise<string> {
  const failures: string[] = [];

  for (const candidate of SSR_NAMESPACES) {
    const response = await request.fetch(apiUrl(`/api/workspace/${workspaceId}/publish-namespace`), {
      method: 'PUT',
      data: { old_namespace: currentNamespace, new_namespace: candidate },
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const text = await response.text();

    if (response.ok() && (JSON.parse(text) as ApiResponse<unknown>).code === 0) return candidate;

    failures.push(`${candidate}: ${text}`);
  }

  throw new Error(
    `Every SSR namespace is taken. Add more to APPFLOWY_INDEXABLE_NAMESPACES (and restart the server).\n${failures.join(
      '\n'
    )}`
  );
}

/** Polls the upstream snapshot until publishing has completed. */
async function waitForPublishedSnapshot(request: APIRequestContext, namespace: string, publishName: string) {
  const path = `/api/workspace/v2/published/${namespace}/${publishName}/snapshot`;
  let latest = '';

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request.get(apiUrl(path), { failOnStatusCode: false });

    latest = await response.text();

    if (response.ok() && (JSON.parse(latest) as ApiResponse<unknown>).code === 0) return;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`${path} never became available. Last response: ${latest}`);
}

/**
 * Records, from document start, whether the reader could ever have seen a gap
 * between the server-rendered article and the app: a loading spinner, or the
 * article detached from the page, before the published page itself mounted.
 * MutationObserver callbacks run after each DOM change and before the browser
 * renders, so this sees every state that could have been painted.
 */
function installHandoffProbe() {
  if (window.top !== window) return;

  const probe: HandoffProbe = {
    articleSeen: false,
    appMounted: false,
    spinnerBeforeApp: false,
    articleGapBeforeApp: false,
  };
  let article: Element | null = null;

  (window as unknown as { __ssrHandoffProbe: HandoffProbe }).__ssrHandoffProbe = probe;

  new MutationObserver(() => {
    if (probe.appMounted) return;

    if (!article) {
      article = document.querySelector('#root > [data-appflowy-ssr]');
      if (article) probe.articleSeen = true;
    }

    // PublishLayout's scroll container: the published page has taken over.
    if (document.querySelector('.appflowy-layout')) {
      probe.appMounted = true;
      return;
    }

    if (document.querySelector('[role="status"][aria-label="Loading page"]')) probe.spinnerBeforeApp = true;
    if (article && !article.isConnected) probe.articleGapBeforeApp = true;
  }).observe(document, { childList: true, subtree: true });
}

test.describe('Published page SSR', () => {
  test.skip(
    SSR_NAMESPACES.length === 0,
    'Needs the Bun SSR server (deploy/server.ts) started with APPFLOWY_INDEXABLE_NAMESPACES; see doc/PUBLISH_SSR.md'
  );
  test.setTimeout(180000);

  test('serves an allowlisted page server-rendered and hands it to the app without a gap', async ({
    page,
    request,
  }) => {
    setupPageErrorHandling(page);

    const stamp = Date.now();
    const pageName = `SSR e2e page ${stamp}`;
    const headingText = `SSR heading ${stamp}`;
    const paragraphText = `Server-rendered paragraph for crawlers ${stamp}.`;
    const publishName = `ssr-page-${stamp}`;

    // Given: a published page with a heading and a paragraph
    const { token, workspaceId } = await signUp(request);
    const folder = await api<FolderView>(request, token, 'GET', `/api/workspace/${workspaceId}/folder?depth=2`);
    const space = folder.children?.find((view) => view.name === 'General') ?? folder.children?.[0];

    expect(space?.view_id, JSON.stringify(folder)).toBeTruthy();

    const doc = await api<{ view_id: string }>(request, token, 'POST', `/api/workspace/${workspaceId}/page-view`, {
      parent_view_id: space!.view_id,
      layout: 0,
      name: pageName,
      page_data: {
        type: 'page',
        children: [
          // An in-document H1 renders as <h2>: the page title is the only <h1>.
          { type: 'heading', data: { level: 1, delta: [{ insert: headingText }] } },
          { type: 'paragraph', data: { delta: [{ insert: paragraphText }] } },
        ],
      },
    });

    // The endpoint the web app's Publish button uses.
    await api(request, token, 'POST', `/api/workspace/${workspaceId}/page-view/${doc.view_id}/publish`, {
      publish_name: publishName,
    });

    const originalNamespace = await api<string>(
      request,
      token,
      'GET',
      `/api/workspace/${workspaceId}/publish-namespace`
    );

    await waitForPublishedSnapshot(request, originalNamespace, publishName);

    // Then: under the workspace's own namespace (not allowlisted) the server
    // sends the plain shell, exactly as before SSR existed
    const shellResponse = await request.get(`/${originalNamespace}/${publishName}`);
    const shell = load(await shellResponse.text());

    expect(shellResponse.status()).toBe(200);
    expect(shell('#appflowy-publish-error').length).toBe(0);
    expect(shell('[data-appflowy-ssr]').length).toBe(0);
    expect(shell('#appflowy-publish-snapshot').length).toBe(0);
    expect((shell('#root').html() ?? '').trim()).toBe('');

    // When: the workspace moves to an allowlisted namespace
    const namespace = await claimSsrNamespace(request, token, workspaceId, originalNamespace);

    testLog.info(`Claimed SSR namespace "${namespace}"`);

    try {
      await waitForPublishedSnapshot(request, namespace, publishName);

      // Then: the server renders the page into the HTML
      const response = await request.get(`/${namespace}/${publishName}`);
      const html = await response.text();
      const $ = load(html);
      const article = $('#root > article[data-appflowy-ssr]');

      expect(response.status()).toBe(200);
      expect(response.headers()['x-robots-tag']).toBeUndefined();
      expect($('meta[name="robots"]').length).toBe(0);
      expect(article.length, 'no server-rendered article: is BASE_URL served by deploy/server.ts?').toBe(1);
      expect(article.find('h1').first().text()).toBe(pageName);
      expect(article.find('h2').text()).toBe(headingText);
      expect(article.text()).toContain(paragraphText);
      expect($('meta[name="description"]').attr('content')).toBe(paragraphText);

      // And: the snapshot is inlined for the client, as a data block after #root
      const inlined = $('#root + script#appflowy-publish-snapshot[type="application/json"]');

      expect(JSON.parse(inlined.html() ?? 'null')).toMatchObject({
        schemaVersion: 1,
        kind: 'document',
        namespace,
        publishName: publishName,
      });

      // When: a reader opens the page, with the app's scripts held back at first
      const snapshotRequests: string[] = [];
      const snapshotPath = `/v2/published/${namespace}/${publishName}/snapshot`;

      page.on('request', (req) => {
        if (new URL(req.url()).pathname.endsWith(snapshotPath)) snapshotRequests.push(req.url());
      });

      let releaseScripts: () => void = () => undefined;
      const scriptsReleased = new Promise<void>((resolve) => {
        releaseScripts = resolve;
      });

      await page.route(/\/static\/js\/.+\.js(\?.*)?$/, async (route) => {
        await scriptsReleased;
        // Keep every chunk slow, so the app's route-loading fallbacks are really
        // on screen for a while rather than skipped over.
        await new Promise((resolve) => setTimeout(resolve, 250));
        await route.continue();
      });
      await page.addInitScript(installHandoffProbe);
      await page.goto(`/${namespace}/${publishName}`, { waitUntil: 'commit' });

      // Then: the article is readable before any JavaScript has run
      const ssrArticle = page.locator('#root > article[data-appflowy-ssr]');

      await expect(ssrArticle.locator('h1')).toHaveText(pageName);
      await expect(ssrArticle.getByText(paragraphText)).toBeVisible();

      // When: the app loads
      releaseScripts();

      // Then: the app renders the page and drops the server markup
      const app = page.locator('.appflowy-layout');

      await expect(app).toBeVisible({ timeout: 60000 });
      await expect(app.getByText(paragraphText)).toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-appflowy-ssr]')).toHaveCount(0);
      await expect(page.locator('#appflowy-publish-snapshot')).toHaveCount(0);

      // And: the reader never saw a spinner or an empty page in between
      const probe = await page.evaluate(
        () => (window as unknown as { __ssrHandoffProbe?: HandoffProbe }).__ssrHandoffProbe
      );

      expect(probe).toEqual({
        articleSeen: true,
        appMounted: true,
        spinnerBeforeApp: false,
        articleGapBeforeApp: false,
      });

      // And: the app reused the inlined snapshot rather than fetching it
      expect(snapshotRequests).toEqual([]);
    } finally {
      // Free the namespace for the next run; the workspace is disposable.
      await request.fetch(apiUrl(`/api/workspace/${workspaceId}/publish-namespace`), {
        method: 'PUT',
        data: { old_namespace: namespace, new_namespace: `ssr-e2e-released-${stamp}` },
        failOnStatusCode: false,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    }
  });
});
