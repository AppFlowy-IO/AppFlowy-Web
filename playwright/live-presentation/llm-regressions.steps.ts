import { readFile } from 'node:fs/promises';

import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { livePresentationEnvironment } from './environment';
import { pptxEntries } from './pptx-entries';

import type { DeckScene } from '../../src/components/presentation/server-scene';

const { Given, When, Then } = createBdd();

interface State { requests: string[]; dataLoads: string[]; scene?: DeckScene; download?: string; analysisCount?: number }
const states = new WeakMap<Page, State>();
const state = (page: Page) => states.get(page)!;

async function openMode(page: Page, label: string) {
  await page.getByTestId('present-button').click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

Given('the existing LLM Iteration Lab fixture is open', async ({ page }) => {
  const pageId = process.env.PRESENTATION_LIVE_LLM_PAGE_ID;

  if (!pageId || !/^[0-9a-f-]{36}$/i.test(pageId)) throw new Error('Set PRESENTATION_LIVE_LLM_PAGE_ID to the existing LLM Iteration Lab fixture.');
  await page.goto(`/app/${livePresentationEnvironment().workspaceId}/${pageId}`);
  await expect(page.getByTestId('page-title-input').filter({ visible: true }).first()).toHaveText('LLM Iteration Lab');
  states.set(page, { requests: [], dataLoads: [] });
  page.on('request', (request) => {
    const url = new URL(request.url());

    if (url.pathname.startsWith('/api/presentation/')) state(page).requests.push(`${request.method()} ${url.pathname}`);
    if (/\/collab\/full-sync|\/database\/[^/]+\/rows(?:\/|$)/.test(url.pathname)) state(page).dataLoads.push(url.pathname);
  });
});

When('the saved LLM mind map is opened twice', async ({ page }) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    await openMode(page, 'Present AI mind map');
    await expect(page.getByRole('button', { name: 'v4 Hard examples', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open mind map', exact: true })).toBeVisible();
    if (attempt === 0) await page.getByRole('button', { name: 'Close enlarged mind map' }).click();
  }
});

Then('its database citations show readable names and open the cited row', async ({ page }) => {
  await page.getByRole('button', { name: 'v4 Hard examples', exact: true }).click();
  const source = page.getByRole('button', { name: /Open source \d+: .*LLM Experiments · v4 Hard examples › Median latency seconds/ });

  await source.hover();
  const tooltip = page.getByRole('tooltip');

  await expect(tooltip).toContainText('LLM Experiments');
  await expect(tooltip).toContainText('v4 Hard examples');
  await expect(tooltip).toContainText('1.8');
  await expect(tooltip).not.toContainText(/cell:|[0-9a-f]{8}-[0-9a-f-]{27}/i);
  await expect(source).toHaveAttribute('aria-describedby', /.+/);
  await source.click();
  await expect(page).toHaveURL(/\?r=[0-9a-f-]{36}$/i);
  await expect(page.getByRole('textbox', { name: 'Row title', exact: true })).toHaveText('v4 Hard examples');
  await expect(page.getByRole('button', { name: 'Median latency seconds', exact: true })).toBeVisible();
  await expect(page.getByText('Release candidate', { exact: true })).toBeVisible();
});

Then('reopening the LLM result made no generation or preference writes', async ({ page }) => {
  // Covers the former 600ms mount-time session write as well as the analysis debounce.
  await page.waitForTimeout(900);
  expect(state(page).requests.filter((request) => /POST .*\/(generate|slides\/assess)$|PUT .*\/session$/.test(request))).toEqual([]);
});

When('the saved LLM presentation is opened', async ({ page }) => {
  const scene = page.waitForResponse((response) => /\/artifacts\/[^/]+\/scene\?/.test(response.url()) && response.request().method() === 'GET');

  await openMode(page, 'Generate AI ppt');
  state(page).scene = (await (await scene).json()).data;
  await expect(page.getByRole('button', { name: 'Preview slide 1: LLM Iteration Lab', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  expect(state(page).requests.filter((request) => /POST .*\/(sources|generate|slides\/assess)$/.test(request))).toEqual([]);
});

Then('the presentation has one dialog and no source-version footer', async ({ page }) => {
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByText(/Source version |Preview and editable PowerPoint use the same slide layouts/)).toHaveCount(0);
  await page.getByText('Sources & speaker notes', { exact: true }).click();
  await expect(page.getByRole('group', { name: 'Sources', exact: true })).toBeVisible();
});

When('the slide count is changed and restored in regeneration settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Create presentation settings' })).toBeVisible();
  await expect(page.getByText(/Analyzing your sources|Preparing your sources/)).toHaveCount(0);
  const dialog = page.getByRole('dialog');
  const original = await dialog.boundingBox();

  expect(original).not.toBeNull();
  state(page).analysisCount = state(page).requests.filter((request) => /\/slides\/assess$/.test(request)).length;
  // The saved fixture has six slides. Changing only the count must reuse the source assessment.
  for (const count of ['4', '8', '12', '6']) {
    await page.getByRole('button', { name: count, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Regenerate presentation', exact: true })).toBeEnabled();
    const box = await dialog.boundingBox();

    expect(box!.width).toBeCloseTo(original!.width, 0);
    expect(box!.height).toBeCloseTo(original!.height, 0);
    await expect(page.getByText('Analyzing your sources...', { exact: true })).toHaveCount(0);
  }
});

Then('the settings keep their size and do not repeat source analysis', async ({ page }) => {
  await page.waitForTimeout(900);
  expect(state(page).requests.filter((request) => /\/slides\/assess$/.test(request))).toHaveLength(state(page).analysisCount!);
  await page.getByRole('button', { name: 'Back to presentation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview slide 1: LLM Iteration Lab', exact: true })).toBeVisible();
});

When('the LLM document is presented from its loaded editor', async ({ page }) => {
  // Scroll the embedded view into the viewport so its normal editor resource is already warm.
  await page.getByRole('button', { name: 'View of LLM Experiments', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('v4 Hard examples', { exact: true }).last()).toBeVisible();
  state(page).dataLoads = [];
  await openMode(page, 'Present document');
});

Then('every document slide has content and the experiment database is visible', async ({ page }) => {
  const slide = page.locator('.ps-doc-slide:not(.ps-doc-measure)');
  const next = page.getByRole('button', { name: 'Next slide', exact: true });
  let databaseSeen = false;
  let complete = false;

  for (let index = 0; index < 60; index++) {
    await expect(slide).toBeVisible();
    await expect.poll(async () => {
      const content = await slide.textContent();
      const images = await slide.locator('img').count();

      return Boolean(content?.replace(/[\s\u200b\ufeff]/g, '') || images);
    }).toBe(true);
    if (await slide.locator('.ps-document-database').count()) {
      await expect(slide.getByText('v4 Hard examples', { exact: true })).toBeVisible();
      databaseSeen = true;
    }

    if (await next.isDisabled()) { complete = true; break; }

    await next.click();
  }

  expect(complete).toBe(true);
  expect(databaseSeen).toBe(true);
  expect(state(page).dataLoads, 'Presentation should reuse the editor database and row resources').toEqual([]);
  expect(state(page).requests.filter((request) => /POST .*\/(sources|generate|slides\/assess)$/.test(request))).toEqual([]);
});

When('the LLM presentation is exported through the download dialog', async ({ page, $testInfo }) => {
  await page.getByRole('button', { name: 'Export PPTX', exact: true }).click();
  const downloaded = page.waitForEvent('download', { timeout: 180_000 });

  await page.getByRole('button', { name: 'Download PowerPoint (.pptx)', exact: true }).click();
  const download = await downloaded;

  expect(await download.failure()).toBeNull();
  state(page).download = $testInfo.outputPath('LLM-Iteration-Lab.pptx');
  await download.saveAs(state(page).download!);
});

Then('each exported image fits its preview slot without stretching', async ({ page }) => {
  const files = pptxEntries(await readFile(state(page).download!));
  let images = 0;

  for (const [index, slide] of state(page).scene!.slides.entries()) {
    const xml = files.get(`ppt/slides/slide${index + 1}.xml`)!.toString('utf8');
    const rels = files.get(`ppt/slides/_rels/slide${index + 1}.xml.rels`)!.toString('utf8');
    const pictures = await page.evaluate(({ xml, rels }) => {
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      const relationships = new DOMParser().parseFromString(rels, 'application/xml');

      return [...document.getElementsByTagName('p:pic')].map((picture) => {
        const id = picture.getElementsByTagName('a:blip')[0].getAttribute('r:embed');
        const relation = [...relationships.getElementsByTagName('Relationship')].find((item) => item.getAttribute('Id') === id)!;
        const off = picture.getElementsByTagName('a:off')[0];
        const ext = picture.getElementsByTagName('a:ext')[0];

        return { name: picture.getElementsByTagName('p:cNvPr')[0].getAttribute('name'), target: relation.getAttribute('Target')!,
          x: Number(off.getAttribute('x')) / 9525, y: Number(off.getAttribute('y')) / 9525,
          width: Number(ext.getAttribute('cx')) / 9525, height: Number(ext.getAttribute('cy')) / 9525 };
      });
    }, { xml, rels });

    for (const picture of pictures) {
      const media = files.get(`ppt/${picture.target.replace(/^\.\.\//, '')}`)!;

      // This fixture's two source images are PNG; Rust regressions also cover JPEG and portrait media.
      expect(media.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const width = media.readUInt32BE(16);
      const height = media.readUInt32BE(20);
      const slot = slide.elements.find((element) => element.kind === 'image' && element.id === picture.name)!.bounds;
      const scale = Math.min(slot.width / width, slot.height / height);

      expect(picture.width / picture.height).toBeCloseTo(width / height, 4);
      expect(picture.width).toBeCloseTo(width * scale, 2);
      expect(picture.height).toBeCloseTo(height * scale, 2);
      expect(picture.x).toBeCloseTo(slot.x + (slot.width - width * scale) / 2, 2);
      expect(picture.y).toBeCloseTo(slot.y + (slot.height - height * scale) / 2, 2);
      images++;
    }
  }

  expect(images).toBeGreaterThan(0);
});
