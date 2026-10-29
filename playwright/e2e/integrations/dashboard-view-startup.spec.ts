import { expect, type Page, type Request, type Route } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

async function computationSnapshot(page: Page) {
  return page.evaluate(() => {
    const state = window.__DASHBOARD_STARTUP_WORK__;

    return { maximum: state.maximum, active: state.active.size, events: state.events };
  });
}

async function expectViewWorkLimit(page: Page) {
  const state = await computationSnapshot(page);

  expect(state.maximum, JSON.stringify(state.events)).toBeLessThanOrEqual(2);
}

async function workRecorder(page: Page) {
  const protocol = await page.context().newCDPSession(page);
  const protocolIds = new Set<string>();
  const timeline: { event: string; id: string; timestamp: number }[] = [];

  await protocol.send('Network.enable');
  protocol.on('Network.requestWillBeSent', (event) => {
    if (!event.request.url.includes('/qa-view-startup/')) return;
    protocolIds.add(event.requestId);
    timeline.push({ event: 'start', id: event.requestId, timestamp: event.timestamp });
  });
  protocol.on('Network.loadingFailed', (event) => {
    if (protocolIds.has(event.requestId)) timeline.push({ event: 'failed', id: event.requestId, timestamp: event.timestamp });
  });
  protocol.on('Network.loadingFinished', (event) => {
    if (protocolIds.has(event.requestId)) timeline.push({ event: 'finished', id: event.requestId, timestamp: event.timestamp });
  });
  const active = new Set<Request>();
  const started: string[] = [];
  const aborted: string[] = [];
  const releases = new Map<string, Set<() => void>>();
  let maximum = 0;
  let immediate = false;

  page.on('request', (request) => {
    if (!request.url().includes('/qa-view-startup/')) return;
    active.add(request);
    started.push(request.url().split('/').pop()!);
    maximum = Math.max(maximum, active.size);
  });
  page.on('requestfinished', (request) => active.delete(request));
  page.on('requestfailed', (request) => {
    if (active.delete(request)) aborted.push(request.url().split('/').pop()!);
  });
  await page.route('**/qa-view-startup/*', async (route: Route) => {
    const id = route.request().url().split('/').pop()!;

    if (!immediate) {
      await new Promise<void>((resolve) => {
        const pending = releases.get(id) ?? new Set<() => void>();

        pending.add(resolve);
        releases.set(id, pending);
      });
    }

    await route.fulfill({ json: { name: `Actual row ${id}` } }).catch(() => undefined);
  });
  return {
    started,
    aborted,
    maximum: () => maximum,
    timeline,
    active: () => active.size,
    finish: (id: string) => {
      expect(releases.has(id), `${id} has dispatched its work`).toBe(true);
      releases.get(id)!.forEach((release) => release());
      releases.delete(id);
    },
    finishAll: () => {
      immediate = true;
      releases.forEach((pending) => pending.forEach((release) => release()));
      releases.clear();
    },
  };
}

async function openFixture(page: Page, base: string, stalled = false) {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/view-startup-fixture*', (route) => route.fulfill({
    contentType: 'text/html', body: fixtureHTML('dashboard-view-startup'),
  }));
  await page.goto(new URL(`/view-startup-fixture${stalled ? '?stalled-source' : ''}`, base).href);
  await expect(page.getByTestId('frame-w100')).toBeAttached({ timeout: 60_000 });
  return errors;
}

test('100 host-source views start two at a time only after entering the viewport and preserve completed editors', async ({ page, integrationsURL }) => {
  await page.clock.install();
  const work = await workRecorder(page);
  const errors = await openFixture(page, integrationsURL);

  try {
    await expect.poll(() => work.started.length).toBe(2);
    expect(work.maximum()).toBe(2);
    await expect(page.getByTestId('queued-w3')).toBeVisible();
    work.finishAll();
    await expect(page.getByTestId('row-w6')).toHaveText('Actual row w6');
    await page.clock.fastForward(30_000);
    expect(work.started).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
    await expect(page.getByTestId('queued-w100')).toBeAttached();

    const editor = page.getByLabel('Search w1', { exact: true });

    await editor.fill('keep this search');
    await page.getByRole('button', { name: 'Toggle titles', exact: true }).click();
    await expect(editor).toHaveValue('keep this search');
    await page.getByTestId('startup-viewport').hover();
    await page.mouse.wheel(0, 20_000);
    await expect(page.getByTestId('row-w100')).toHaveText('Actual row w100');
    await page.mouse.wheel(0, -20_000);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue('keep this search');
    await expect(page.getByTestId('body-w1')).toHaveAttribute('data-mount', '1');
    expect(work.started.filter((id) => id === 'w1')).toHaveLength(1);
    expect(work.started.length).toBeLessThan(20);
    await expectViewWorkLimit(page);
    expect(errors).toEqual([]);
  } finally {
    await test.info().attach('view-request-lifecycle', { body: JSON.stringify({ transportMaximum: work.maximum(), timeline: work.timeline, computation: await computationSnapshot(page) }), contentType: 'application/json' });
    work.finishAll();
  }
});

test('real scroll cancels unfinished host-source views before reprioritization and page leave starts nothing late', async ({ page, integrationsURL }) => {
  const work = await workRecorder(page);
  const errors = await openFixture(page, integrationsURL);

  try {
    await expect.poll(() => work.started.length).toBe(2);
    await page.getByTestId('startup-viewport').hover();
    await page.mouse.wheel(0, 2_000);
    await expect.poll(() => work.aborted.length).toBe(2);
    await expect.poll(() => work.started.length).toBe(4);
    expect(work.started.slice(2).every((id) => Number(id.slice(1)) > 20)).toBe(true);
    await expectViewWorkLimit(page);
    await page.getByRole('button', { name: 'Leave Dashboard', exact: true }).click();
    await expect.poll(() => work.active()).toBe(0);
    expect((await computationSnapshot(page)).active).toBe(0);
    await expect(page.getByTestId('frame-w1')).toHaveCount(0);
    work.finishAll();
    await expect(page.getByText('Other page', { exact: true })).toBeVisible();
    expect(work.started).toHaveLength(4);
    expect(work.aborted).toHaveLength(4);
    await page.getByRole('button', { name: 'Reopen Dashboard', exact: true }).click();
    await expect(page.getByTestId('row-w1')).toHaveText('Actual row w1');
    await expect(page.getByTestId('row-w6')).toHaveText('Actual row w6');
    await expectViewWorkLimit(page);
    expect(errors).toEqual([]);
  } finally {
    await test.info().attach('view-request-lifecycle', { body: JSON.stringify({ transportMaximum: work.maximum(), timeline: work.timeline, computation: await computationSnapshot(page) }), contentType: 'application/json' });
    work.finishAll();
  }
});

test('source deadline aborts pending browser work before the next visible startup gets its slot', async ({ page, integrationsURL }) => {
  await page.clock.install();
  const work = await workRecorder(page);
  const errors = await openFixture(page, integrationsURL, true);

  try {
    await expect.poll(() => work.started.length).toBe(2);
    // The unit case checks the exact 29,999/30,000 ms boundary. Here preserve
    // the real browser's elapsed startup time and verify cancellation itself.
    await page.clock.fastForward(30_000);
    await expect.poll(() => work.aborted.length).toBe(2);
    await expect.poll(() => work.started.length).toBe(4);
    await expectViewWorkLimit(page);
    await expect(page.getByTestId('queued-w1')).toBeVisible();
    await expect(page.getByTestId('row-w1')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await test.info().attach('view-request-lifecycle', { body: JSON.stringify({ transportMaximum: work.maximum(), timeline: work.timeline, computation: await computationSnapshot(page) }), contentType: 'application/json' });
    work.finishAll();
  }
});

test('unseen queued progress pauses and resumes the same animation when scrolled into view', async ({ page, integrationsURL }) => {
  const work = await workRecorder(page);
  const errors = await openFixture(page, integrationsURL);

  try {
    await expect.poll(() => work.started.length).toBe(2);
    const offscreen = page.getByTestId('queued-w100').locator('.animate-progress-container');
    const visible = page.getByTestId('queued-w3').locator('.animate-progress-container');

    await expect(offscreen).toHaveCSS('animation-play-state', 'paused');
    await expect(visible).toHaveCSS('animation-play-state', 'running');
    const element = await offscreen.elementHandle();
    const animation = await offscreen.evaluateHandle((node) => node.getAnimations()[0]);
    const frozen = await offscreen.evaluate((node) => Number(node.getAnimations()[0].currentTime));
    const advancing = await visible.evaluate((node) => Number(node.getAnimations()[0].currentTime));

    await page.waitForTimeout(1_100);
    expect(await offscreen.evaluate((node) => Number(node.getAnimations()[0].currentTime))).toBe(frozen);
    expect(await visible.evaluate((node) => Number(node.getAnimations()[0].currentTime))).toBeGreaterThan(advancing + 500);
    await page.getByTestId('startup-viewport').hover();
    await page.mouse.wheel(0, 20_000);
    await expect(offscreen).toBeVisible();
    await expect(offscreen).toHaveCSS('animation-play-state', 'running');
    expect(await offscreen.evaluate((node, previous) => node === previous, element)).toBe(true);
    expect(await offscreen.evaluate((node, previous) => node.getAnimations()[0] === previous, animation)).toBe(true);
    await expect(visible).toHaveCSS('animation-play-state', 'paused');
    await page.mouse.wheel(0, -20_000);
    await expect(offscreen).toHaveCSS('animation-play-state', 'paused');
    expect(await offscreen.evaluate((node, previous) => node.getAnimations()[0] === previous, animation)).toBe(true);
    await expectViewWorkLimit(page);
    expect(errors).toEqual([]);
  } finally {
    work.finishAll();
  }
});
