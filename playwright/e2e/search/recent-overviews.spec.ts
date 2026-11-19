import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import { expect, test, type Browser, type Page, type Request, type TestInfo } from '@playwright/test';

import { SearchStreamDecoder } from '../../../src/application/services/js-services/http/search-stream-protocol';
import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { AccountSelectors, AuthSelectors, WorkspaceSelectors } from '../../support/selectors';
import { installRuntimeTestConfig } from '../../support/test-config';

interface Member {
  key: 'ada' | 'ben';
  email: string;
  document_id: string;
  document_title: string;
  document_task: string;
  database_task: string;
  row_id: string;
  completed_task: string;
}

interface HarborFixture {
  version: 1;
  workspace_id: string;
  workspace_name: string;
  query: string;
  members: Member[];
  private_document_id: string;
  private_task: string;
  unassigned_to_viewers_row_id: string;
  unassigned_to_viewers_task: string;
}

function loadHarborFixture() {
  const manifestPath = process.env.APPFLOWY_SEARCH_OVERVIEW_FIXTURE;
  const password = process.env.APPFLOWY_SEARCH_OVERVIEW_PASSWORD;

  test.skip(!process.env.CI && !manifestPath, 'requires the restored Harbor Release fixture');
  if (!manifestPath || !password) throw new Error('Configure the Harbor fixture manifest and fixture password');
  const fixture: HarborFixture = JSON.parse(readFileSync(manifestPath, 'utf8'));
  expect(fixture.version).toBe(1);
  expect(fixture.query).toBe('show my todo tasks');
  return { fixture, password };
}

async function signOut(page: Page) {
  await WorkspaceSelectors.dropdownTrigger(page).click();
  await AccountSelectors.settingsButton(page).click();
  await AccountSelectors.logoutButton(page).click();
  await AuthSelectors.logoutConfirmButton(page).click();
  await expect(page).toHaveURL(/\/login/);
}

async function recordedSession(browser: Browser, signedInPage: Page, baseURL: string | undefined, testInfo: TestInfo) {
  const context = await browser.newContext({
    baseURL,
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: testInfo.outputPath('recording'), size: { width: 1280, height: 800 } },
    storageState: await signedInPage.context().storageState(),
  });
  await installRuntimeTestConfig(context);
  return context.newPage();
}

// The login session is never recorded. Only the synthetic, authenticated search UI enters video.
test.use({ video: 'off', trace: 'off', screenshot: 'off' });

for (const memberKey of ['ada', 'ben'] as const) {
  test(`${memberKey} sees personal recent overviews and submits the same todo query`, async ({
    browser,
    page,
    baseURL,
  }, testInfo) => {
    const { fixture, password } = loadHarborFixture();
    const member = fixture.members.find((item) => item.key === memberKey)!;
    const peer = fixture.members.find((item) => item.key !== memberKey)!;
    // Opening a document updates its Recent timestamp. Both actors start in the workspace's
    // Trash screen so replaying this test can't change the ordering that it checks.
    const activityWrites: Request[] = [];
    const observeActivity = (req: Request) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/add-recent-pages')) activityWrites.push(req);
    };
    page.on('request', observeActivity);
    await signInWithPasswordViaUi(page, member.email, password, 0, '/app/trash');
    await expect(page).toHaveURL(/\/app\/trash$/);

    const viewer = await recordedSession(browser, page, baseURL, testInfo);
    const context = viewer.context();
    const searchPath = `/api/search/${fixture.workspace_id}`;
    const matches = (req: Request, method: string, suffix: string) =>
      req.method() === method && new URL(req.url()).pathname === searchPath + suffix;
    const overviewReads: Request[] = [];
    const summaries: Request[] = [];
    viewer.on('request', (req) => {
      observeActivity(req);
      if (matches(req, 'GET', '/recent-overviews')) overviewReads.push(req);
      if (matches(req, 'POST', '/summary')) summaries.push(req);
    });

    try {
      await viewer.goto('/app/trash');
      await expect(viewer.getByTestId('current-workspace-name')).toHaveText(fixture.workspace_name);
      const sidebarSearch = viewer.getByText('Search', { exact: true }).first();
      await expect(sidebarSearch).toBeVisible({ timeout: 60_000 });
      expect(overviewReads).toHaveLength(0);
      expect(summaries).toHaveLength(0);
      const preparedResponse = viewer.waitForResponse((res) => matches(res.request(), 'GET', '/recent-overviews'));
      const openedAt = performance.now();
      await sidebarSearch.click();
      const dialog = viewer.getByRole('dialog');
      const input = dialog.getByRole('textbox');
      await expect(input).toBeFocused();
      const recent = dialog.getByRole('region', { name: 'Recent AI overviews' });
      const first = recent.getByRole('button', { expanded: true });
      await expect(first).toContainText(member.document_title);
      await expect(recent).toContainText(member.document_task, { ignoreCase: true });
      await expect(recent).not.toContainText(peer.document_task, { ignoreCase: true });
      await expect(recent).not.toContainText(fixture.private_task, { ignoreCase: true });
      const preparedVisibleMs = Math.round(performance.now() - openedAt);
      const prepared = await preparedResponse;
      expect(prepared.status()).toBe(200);
      const preparedTopic = (await prepared.json()).data.topics[0];
      expect(preparedTopic.title).toBe(member.document_title);
      expect(preparedTopic.summary.sources).toEqual([member.document_id]);
      expect(overviewReads).toHaveLength(1);
      expect(summaries).toHaveLength(0);
      // Leave each verified state legible in the review recording.
      await viewer.waitForTimeout(1000);

      const keywordRequest = viewer.waitForResponse((res) => {
        const url = new URL(res.url());
        return (
          matches(res.request(), 'GET', '/stream') &&
          url.searchParams.get('query') === fixture.query &&
          url.searchParams.get('mode') === 'keyword'
        );
      });
      await input.pressSequentially(fixture.query, { delay: 70 });
      const typedAt = performance.now();
      const keywords = await keywordRequest;
      expect(keywords.status()).toBe(200);
      expect(await keywords.finished()).toBeNull();
      const decoder = new SearchStreamDecoder();
      let rankedIds: string[] = [];
      decoder.push(await keywords.body(), (snapshot) => {
        if (snapshot.phase !== 'final') return;
        rankedIds = [
          ...new Set(
            snapshot.items.map((item) => `${item.database_view_id || item.object_id}:${item.database_row_id || ''}`)
          ),
        ];
      });
      expect(decoder.finish()).toMatchObject({ type: 'done', outcome: 'complete' });
      const rows = dialog.locator('[data-item-id]');
      await expect
        .poll(() => rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-item-id'))))
        .toEqual(rankedIds);
      expect(rankedIds).not.toContain(`${fixture.private_document_id}:`);
      if (rankedIds.length === 0) await expect(dialog.getByText('No search results', { exact: true })).toBeVisible();
      const rankOfRow = (rowId: string) => {
        const index = rankedIds.findIndex((id) => id.endsWith(`:${rowId}`));
        return index === -1 ? null : index + 1;
      };
      const rankingPath = testInfo.outputPath('keyword-ranking.json');
      const rendered = await rows.allInnerTexts();
      await writeFile(
        rankingPath,
        JSON.stringify(
          {
            member: memberKey,
            query: fixture.query,
            memberRowRank: rankOfRow(member.row_id),
            peerRowRank: rankOfRow(peer.row_id),
            thirdMemberRowRank: rankOfRow(fixture.unassigned_to_viewers_row_id),
            rankedIds,
            rendered,
          },
          null,
          2
        )
      );
      await testInfo.attach('keyword-ranking', { path: rankingPath, contentType: 'application/json' });
      expect(rankedIds).toHaveLength(2);
      expect(rankedIds).toContain(`${member.document_id}:`);
      expect(rankOfRow(member.row_id)).not.toBeNull();
      expect(rankOfRow(peer.row_id)).toBeNull();
      expect(rankOfRow(fixture.unassigned_to_viewers_row_id)).toBeNull();
      await expect(rows.filter({ hasText: member.document_task })).toBeVisible();
      await expect(rows.filter({ hasText: member.database_task })).toBeVisible();
      const keywordVisibleMs = Math.round(performance.now() - typedAt);
      const excludedTasks = [
        peer.document_task,
        peer.database_task,
        member.completed_task,
        fixture.private_task,
        fixture.unassigned_to_viewers_task,
      ];
      for (const excluded of excludedTasks) expect(rendered.join('\n')).not.toContain(excluded);
      await expect(recent).toHaveCount(0);
      expect(summaries).toHaveLength(0);
      await viewer.waitForTimeout(1000);

      const summariesBeforeSubmit = summaries.length;
      expect(summariesBeforeSubmit).toBe(0);
      const summaryResponse = viewer.waitForResponse((res) => matches(res.request(), 'POST', '/summary'));
      const submittedAt = performance.now();
      if (memberKey === 'ada') await input.press('Enter');
      else await dialog.getByRole('button', { name: 'Search', exact: true }).click();
      const response = await summaryResponse;
      expect(response.status()).toBe(200);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].postDataJSON()).toMatchObject({ query: fixture.query });
      const answer = dialog.getByRole('region', { name: 'AI overview', exact: true });
      await expect(answer).toContainText(member.document_task, { timeout: 90_000, ignoreCase: true });
      await expect(answer).toContainText(member.database_task, { ignoreCase: true });
      const submittedVisibleMs = Math.round(performance.now() - submittedAt);
      for (const excluded of excludedTasks) {
        await expect(answer).not.toContainText(excluded, { ignoreCase: true });
      }
      const payload = await response.json();
      expect([...payload.data.summaries[0].sources].sort()).toEqual([member.document_id, member.row_id].sort());
      await answer.getByRole('button', { name: 'Reference sources' }).click();
      await expect(viewer.getByRole('button', { name: member.document_title, exact: true })).toBeVisible();
      await expect(viewer.getByRole('button', { name: member.database_task, exact: true })).toBeVisible();
      expect(summaries).toHaveLength(1);
      expect(activityWrites).toHaveLength(0);
      const measurements = testInfo.outputPath('search-measurements.json');
      await writeFile(
        measurements,
        JSON.stringify(
          {
            member: memberKey,
            preparedVisibleMs,
            preparedResponseMs: prepared.request().timing().responseEnd,
            keywordVisibleMs,
            submittedVisibleMs,
            submittedResponseMs: response.request().timing().responseEnd,
            overviewReads: overviewReads.length,
            keywordResponseMs: keywords.request().timing().responseEnd,
            summariesBeforeSubmit,
            submittedSummaries: summaries.length,
            sources: payload.data.summaries[0].sources,
          },
          null,
          2
        )
      );
      await testInfo.attach('search-measurements', { path: measurements, contentType: 'application/json' });
      await viewer.waitForTimeout(1000);
    } finally {
      await context.close();
    }
    // End the product session outside the recording, using the same neutral tab as sign-in.
    await signOut(page);
    expect(activityWrites).toHaveLength(0);
    const recording = testInfo.outputPath(`Harbor-${memberKey}.webm`);
    await viewer.video()!.saveAs(recording);
    await testInfo.attach(`Harbor-search-${memberKey}`, {
      path: recording,
      contentType: 'video/webm',
    });
  });
}

for (const memberKey of ['ada', 'ben', 'casey'] as const) {
  const scenario =
    memberKey === 'casey'
      ? 'finds shared and private pages without a cached overview or AI submission'
      : 'discards the previous answer when editing, clearing, or reopening search';

  test(`${memberKey} ${scenario}`, async ({ page: authPage, browser, baseURL }, testInfo) => {
    const { fixture, password } = loadHarborFixture();
    const member = fixture.members.find((item) => item.key === memberKey);
    const searchPath = `/api/search/${fixture.workspace_id}`;
    let overviewReads = 0;
    let activityWrites = 0;
    const summaries: string[] = [];
    const expectedQueries: string[] = [];
    const observe = (req: Request) => {
      const path = new URL(req.url()).pathname;
      if (req.method() === 'GET' && path === searchPath + '/recent-overviews') overviewReads++;
      if (req.method() === 'POST' && path === searchPath + '/summary') summaries.push(req.postDataJSON().query);
      if (req.method() === 'POST' && path.endsWith('/add-recent-pages')) activityWrites++;
    };

    authPage.on('request', observe);
    await signInWithPasswordViaUi(authPage, member?.email ?? 'harbor.casey@example.test', password, 0, '/app/trash');
    const page = await recordedSession(browser, authPage, baseURL, testInfo);
    page.on('request', observe);
    try {
      await page.goto('/app/trash');
      await expect(page.getByTestId('current-workspace-name')).toHaveText(fixture.workspace_name);
      const dialog = page.getByRole('dialog');
      const input = dialog.getByRole('textbox');
      const recent = dialog.getByRole('region', { name: 'Recent AI overviews' });
      const answer = dialog.getByRole('region', { name: 'AI overview', exact: true });
      const rows = dialog.locator('[data-item-id]');
      const searchButton = dialog.getByRole('button', { name: 'Search', exact: true });

      async function expectPreparedAfter(action: () => Promise<void>) {
        const prepared = page.waitForResponse(
          (res) => res.request().method() === 'GET' && new URL(res.url()).pathname === searchPath + '/recent-overviews'
        );
        await action();
        const response = await prepared;
        expect(response.status()).toBe(200);
        const { data } = await response.json();
        if (member) {
          expect(data.topics[0].title).toBe(member.document_title);
          await expect(recent).toContainText(member.document_task, { ignoreCase: true });
        } else {
          expect(data.topics).toEqual([]);
          await expect(dialog.getByText('No search results', { exact: true })).toBeVisible();
          await expect(recent).toHaveCount(0);
        }
        await expect(input).toHaveValue('');
        await expect(searchButton).toBeDisabled();
        await expect(answer).toHaveCount(0);
      }

      async function searchKeyword(query: string, expectedDocument?: string) {
        const keyword = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.pathname === searchPath + '/stream' &&
            url.searchParams.get('query') === query &&
            url.searchParams.get('mode') === 'keyword'
          );
        });
        await input.press('ControlOrMeta+a');
        await input.pressSequentially(query);
        const response = await keyword;
        expect(response.status()).toBe(200);
        const decoder = new SearchStreamDecoder();
        let ids: string[] | undefined;
        decoder.push(await response.body(), (snapshot) => {
          if (snapshot.phase === 'final') ids = snapshot.items.map((item) => item.object_id);
        });
        expect(decoder.finish()).toMatchObject({ type: 'done', outcome: 'complete' });
        expect(ids).toEqual(expectedDocument ? [expectedDocument] : []);
        if (expectedDocument) {
          await expect(rows).toHaveCount(1);
          await expect(rows).toHaveAttribute('data-item-id', `${expectedDocument}:`);
        } else {
          await expect(dialog.getByText('No search results', { exact: true })).toBeVisible();
          await expect(rows).toHaveCount(0);
        }
        await expect(answer).toHaveCount(0);
        expectedQueries.push(query);
      }

      const open = () => page.getByText('Search', { exact: true }).first().click();
      await expectPreparedAfter(open);
      await expect(input).toBeFocused();
      await input.press('Enter');

      if (member) {
        // Two quick submissions, followed by another after success, represent one explicit intent.
        await input.pressSequentially(fixture.query);
        await input.press('Enter');
        await input.press('Enter');
        await expect(answer).toContainText(member.document_task, { timeout: 90_000, ignoreCase: true });
        await input.press('Enter');
        await page.waitForTimeout(600);
        await searchKeyword('drydock');
        await searchKeyword('zzqharborunmatched');
      } else {
        const shared = fixture.members.find((item) => item.key === 'ada')!;
        await searchKeyword('lighthouse', shared.document_id);
        await expect(rows).toContainText(shared.document_title);
        await input.press('ArrowDown');
        await expect(rows).toHaveAttribute('style', /--fill-list-active/);
        await page.waitForTimeout(700);
        await searchKeyword('drydock', fixture.private_document_id);
        await expect(rows).toContainText(fixture.private_task, { ignoreCase: true });
        await page.waitForTimeout(700);
      }
      await input.press('ControlOrMeta+a');
      await expectPreparedAfter(() => input.press('Backspace'));
      await input.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expectPreparedAfter(open);
      await expect(input).toBeFocused();
      await input.press('Enter');
      await input.press('Escape');
      await expect(dialog).toHaveCount(0);
    } finally {
      await page.context().close();
    }
    await signOut(authPage);
    const recording = testInfo.outputPath(`Harbor-${memberKey}-interactions.webm`);
    await page.video()!.saveAs(recording);
    await testInfo.attach(`Harbor-${memberKey}-interactions`, { path: recording, contentType: 'video/webm' });

    expect(overviewReads).toBe(3);
    expect(summaries).toEqual(member ? [fixture.query] : []);
    expect(activityWrites).toBe(0);
    const evidence = testInfo.outputPath('search-interactions.json');
    await writeFile(
      evidence,
      JSON.stringify(
        {
          viewer: memberKey,
          overviewReads,
          summaries: summaries.length,
          activityWrites,
          verifiedKeywordQueries: expectedQueries,
        },
        null,
        2
      )
    );
    await testInfo.attach('search-interactions', { path: evidence, contentType: 'application/json' });
  });
}
