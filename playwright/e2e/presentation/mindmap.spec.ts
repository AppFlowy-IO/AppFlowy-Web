import { expect, test, type Page } from '@playwright/test';

import { METRICS_SOURCE } from '../../../src/components/presentation/__tests__/fixtures/mindmap-tables';
import { SAMPLE_SNAPSHOT } from '../../../src/components/presentation/fixtures';
import type { MindMap } from '../../../src/components/presentation/types';

const generated: MindMap = {
  schemaVersion: 1,
  nodes: [
    { id: 'topic', parentId: null, label: SAMPLE_SNAPSHOT.title, summary: '', sourceIds: [SAMPLE_SNAPSHOT.pageId] },
    {
      id: 'theme',
      parentId: 'topic',
      label: 'Shared understanding',
      summary: 'Bring project knowledge, decisions, and everyday work into one place.',
      sourceIds: [SAMPLE_SNAPSHOT.blocks[0].id],
    },
    {
      id: 'detail',
      parentId: 'theme',
      label: 'Product milestones',
      summary: 'Three major product milestones delivered.',
      sourceIds: [SAMPLE_SNAPSHOT.blocks[1].id],
    },
  ],
  warnings: [],
};

async function openMap(
  page: Page,
  _mode: 'model' | 'fixture' = 'model',
  response = generated,
  options: { presentOnly?: boolean; savedMap?: boolean; table?: boolean; externalImport?: boolean } = {}
) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
  });
  await page.route('**/presentation-map-input.json', (route) =>
    route.fulfill({ json: { map: response, table: options.table } })
  );
  await page.route('**/presentation-mindmap-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-mindmap.fixture.tsx');
    </script></body></html>`,
    })
  );
  const query = new URLSearchParams();
  if (options.presentOnly) query.set('present', '');
  if (options.table) query.set('table', '');
  await page.goto(`/presentation-mindmap-fixture?${query}`);
  if (options.presentOnly) {
    await page.getByRole('button', { name: 'Present mind map', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Interactive mind map' })).toBeVisible();
  } else await expect(page.getByRole('region', { name: 'Interactive mind map' })).toBeVisible();
  return { requests, errors };
}

const zoom = (page: Page) => page.getByLabel('Zoom level').evaluate((el) => Number(el.textContent?.replace('%', '')));

test('presents structural table subjects and their complete values', async ({ page }) => {
  const legacy: MindMap = {
    schemaVersion: 1,
    nodes: [
      { id: 'root', parentId: null, label: METRICS_SOURCE.title, summary: '', sourceIds: [METRICS_SOURCE.pageId] },
      { id: 'row', parentId: 'root', label: 'simple table row', summary: '', sourceIds: ['row-1'] },
      { id: 'cell', parentId: 'row', label: 'simple table cell', summary: '', sourceIds: ['cell-1-0'] },
    ],
    warnings: [],
  };
  const { errors } = await openMap(page, 'fixture', legacy, { table: true, savedMap: true, presentOnly: true });
  const canvas = page.getByRole('region', { name: 'Interactive mind map' });
  await expect(canvas.locator('.ps-map-node')).toHaveCount(5);
  await expect(canvas).not.toContainText('simple table');
  await canvas.getByRole('button', { name: 'Inference cost reduction', exact: true }).click();
  await expect(canvas).toContainText('Reported figure: 286×');
  await expect(canvas).toContainText('November 2022–October 2024');
  await page.getByRole('button', { name: 'Close node details' }).click();
  await page.screenshot({ path: 'test-results/presentation/mindmap-table-subjects.png' });
  await canvas.press('Escape');
  await expect(canvas).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('enlarges like image preview with zoom buttons, wheel, pan, fit, and fullscreen keyboard controls', async ({
  page,
}) => {
  const { requests, errors } = await openMap(page);
  await page.getByRole('button', { name: 'Enlarge mind map', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Interactive mind map' });
  await expect(canvas).toHaveClass(/ps-map-expanded/);
  await expect.poll(() => canvas.evaluate((el) => el.clientHeight === innerHeight)).toBe(true);
  await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
  await expect.poll(() => zoom(page)).toBe(100);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => zoom(page)).toBe(122);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect.poll(() => zoom(page)).toBe(100);
  await page.mouse.move(600, 300);
  await page.mouse.wheel(0, -250);
  await expect.poll(() => zoom(page)).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Fit to screen', exact: true }).click();
  const expectedFit = await canvas.evaluate((el) => {
    const content = el.querySelector<HTMLElement>('.ps-map-content')!;
    return Math.round(Math.min(1, el.clientWidth / content.offsetWidth, el.clientHeight / content.offsetHeight) * 90);
  });
  await expect.poll(() => zoom(page)).toBe(expectedFit);
  const content = canvas.locator('.react-transform-component');
  const before = await content.getAttribute('style');
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(180, 150, { steps: 8 });
  await page.mouse.up();
  await expect(content).not.toHaveAttribute('style', before!);
  await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(canvas.locator('.ps-map-controls')).toBeHidden();
  const fit = await zoom(page);
  await page.keyboard.press('+');
  await expect.poll(() => zoom(page)).toBeGreaterThan(fit);
  await page.keyboard.press('f');
  await expect.poll(() => zoom(page)).toBe(fit);
  await page.mouse.move(600, 1080);
  await expect(canvas.locator('.ps-map-controls')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(canvas).toHaveClass(/ps-map-expanded/);
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
  await page.screenshot({ path: 'test-results/presentation/mindmap-enlarged-dark.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Enlarge mind map' })).toBeVisible();
  expect(requests).toHaveLength(0);
  expect(errors).toEqual([]);
});

const branchingMap: MindMap = {
  ...generated,
  nodes: [
    ...generated.nodes,
    { id: 'deep', parentId: 'detail', label: 'Release checklist', summary: '', sourceIds: [SAMPLE_SNAPSHOT.pageId] },
    { id: 'peer', parentId: 'theme', label: 'Project decisions', summary: '', sourceIds: [SAMPLE_SNAPSHOT.pageId] },
    { id: 'other', parentId: 'topic', label: 'Team planning', summary: '', sourceIds: [SAMPLE_SNAPSHOT.pageId] },
    { id: 'other-child', parentId: 'other', label: 'Team schedules', summary: '', sourceIds: [SAMPLE_SNAPSHOT.pageId] },
    { id: 'third', parentId: 'topic', label: 'Next steps', summary: '', sourceIds: [SAMPLE_SNAPSHOT.pageId] },
    { id: 'third-child', parentId: 'third', label: 'Delivery', summary: '', sourceIds: [SAMPLE_SNAPSHOT.pageId] },
  ],
};

const node = (page: Page, id: string) => page.locator(`.ps-map-node[data-node-id="${id}"]`);

test('presents only the enlarged saved map and exits directly with Escape or the top-right close button', async ({
  page,
}) => {
  const { requests, errors } = await openMap(page, 'model', branchingMap, { presentOnly: true, savedMap: true });
  const canvas = page.getByRole('region', { name: 'Interactive mind map' });
  await expect(canvas).toHaveClass(/ps-map-expanded/);
  await expect
    .poll(() => canvas.evaluate((el) => el.clientHeight === innerHeight && el.clientWidth === innerWidth))
    .toBe(true);
  await expect(node(page, 'theme')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Page presentation tools' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate with AI', exact: true })).toHaveCount(0);
  const close = page.getByRole('button', { name: 'Close enlarged mind map', exact: true });
  const box = await close.boundingBox();
  expect(box!.y).toBe(16);
  expect(box!.x + box!.width).toBe(page.viewportSize()!.width - 16);
  await node(page, 'theme').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Drill down', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Mind map location' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Present mind map', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Present mind map', exact: true }).click();
  await expect(canvas).toBeVisible();
  await close.click();
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: 'Present mind map', exact: true }).click();
  await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.mouse.move(1400, 25);
  await expect(close).toBeVisible();
  await close.click();
  await expect(canvas).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  expect(requests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('folds with descendant counts, keeps zoom and the clicked node anchored, and expands all nested children', async ({
  page,
}) => {
  const { errors } = await openMap(page, 'model', branchingMap);
  await page.getByRole('button', { name: 'Enlarge mind map', exact: true }).click();
  await expect(node(page, 'deep')).toBeVisible();
  const theme = node(page, 'theme');
  await expect(theme).toHaveAttribute('data-side', 'left');
  await theme.hover();
  await expect(theme.locator('.ps-map-collapse')).toHaveCSS('opacity', '1');
  const before = await theme.boundingBox();
  const beforeZoom = await zoom(page);
  await page.getByRole('button', { name: 'Collapse Shared understanding', exact: true }).click();
  await expect(node(page, 'deep')).toHaveCount(0);
  const badge = page.getByRole('button', { name: 'Expand Shared understanding', exact: true });
  await expect(badge).toHaveText('3');
  await expect(badge).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => zoom(page)).toBe(beforeZoom);
  const after = await theme.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  await expect(node(page, 'other')).toHaveAttribute('data-side', 'right');
  await badge.click();
  await expect(node(page, 'deep')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Product milestones', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Shared understanding', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Shared understanding', exact: true }).click();
  await expect(node(page, 'deep')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.locator('.ps-map-node')).toHaveCount(4);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('.ps-map-node')).toHaveCount(9);
  await theme.getByRole('button', { name: 'Shared understanding', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(badge).toHaveText('3');
  await page.keyboard.press('ArrowLeft');
  await expect(node(page, 'deep')).toBeVisible();
  const canvas = page.getByRole('region', { name: 'Interactive mind map' });
  await canvas.click({ button: 'right', position: { x: 20, y: 90 } });
  await expect(page.getByRole('menu', { name: 'Mind map actions' })).toBeVisible();
  await expect(canvas.locator('.MuiBackdrop-root')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('menuitem', { name: 'Collapse all', exact: true }).click();
  await expect(page.locator('.ps-map-node')).toHaveCount(4);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await page.screenshot({ path: 'test-results/presentation/mindmap-mermaid-light.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('drills down from node menus, returns through ancestors, and keeps other branches collapsed in fullscreen', async ({
  page,
}) => {
  const { errors } = await openMap(page, 'model', branchingMap);
  await page.getByRole('button', { name: 'Enlarge mind map', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Team planning', exact: true }).click();
  await node(page, 'theme')
    .getByRole('button', { name: 'Shared understanding', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Drill down', exact: true }).click();
  const breadcrumbs = page.getByRole('navigation', { name: 'Mind map location' });
  await expect(breadcrumbs.getByRole('button', { name: 'Shared understanding', exact: true })).toHaveAttribute(
    'aria-current',
    'location'
  );
  await expect(node(page, 'other')).toHaveCount(0);
  await expect(page.locator('.ps-map-node')).toHaveCount(4);
  await node(page, 'detail').hover();
  await node(page, 'detail').getByRole('button', { name: 'Product milestones', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Actions for Product milestones' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Collapse child nodes' }).click();
  await expect(page.getByRole('button', { name: 'Expand Product milestones', exact: true })).toHaveText('1');
  await node(page, 'detail').getByRole('button', { name: 'Product milestones', exact: true }).focus();
  await page.keyboard.press('Alt+Enter');
  await expect(page.locator('.ps-map-node')).toHaveCount(2);
  await expect(breadcrumbs.getByRole('button', { name: 'Product milestones', exact: true })).toHaveAttribute(
    'aria-current',
    'location'
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.ps-map-node')).toHaveCount(4);
  await breadcrumbs.getByRole('button', { name: SAMPLE_SNAPSHOT.title, exact: true }).click();
  await expect(breadcrumbs).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand Team planning', exact: true })).toHaveText('1');
  await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await node(page, 'theme')
    .getByRole('button', { name: 'Shared understanding', exact: true })
    .click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await page.getByRole('menu').evaluate((el) => document.fullscreenElement!.contains(el))).toBe(true);
  await page.getByRole('menuitem', { name: 'Drill down', exact: true }).click();
  await expect(node(page, 'other')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(breadcrumbs).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await page.screenshot({ path: 'test-results/presentation/mindmap-drill-down-dark.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('uses AppFlowy blue and neutral gray in light and dark mode', async ({ page }) => {
  const { errors } = await openMap(page, 'model', branchingMap);
  await page.getByRole('button', { name: 'Enlarge mind map', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Interactive mind map' });
  for (const dark of [false, true]) {
    if (dark) await page.keyboard.press('ControlOrMeta+Shift+L');
    const colors = await canvas.evaluate((el) => {
      const sample = document.createElement('span');
      el.appendChild(sample);
      const resolve = (token: string) => {
        sample.style.color = `var(${token})`;
        return getComputedStyle(sample).color;
      };
      const result = {
        blue: resolve('--fill-theme-thick'),
        gray: resolve('--fill-content-visible'),
        text: resolve('--text-primary'),
        onBlue: resolve('--text-on-fill'),
        background: resolve('--background-primary'),
      };
      sample.remove();
      return result;
    });
    await expect(node(page, 'topic')).toHaveCSS('background-color', colors.blue);
    await expect(node(page, 'topic').locator('button').first()).toHaveCSS('color', colors.onBlue);
    for (const id of ['theme', 'detail', 'other', 'third']) {
      await expect(node(page, id)).toHaveCSS('background-color', colors.gray);
      await expect(node(page, id).locator('button').first()).toHaveCSS('color', colors.text);
    }
    await expect(canvas).toHaveCSS('background-color', colors.background);
    for (const edge of await canvas.locator('.ps-map-lines path').all())
      await expect(edge).toHaveCSS('stroke', colors.blue);
    await page.screenshot({
      path: `test-results/presentation/mindmap-blue-gray-${dark ? 'dark' : 'light'}.png`,
      animations: 'disabled',
    });
  }
  expect(errors).toEqual([]);
});

for (const platform of [
  { name: 'Mac', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', key: 'Meta', label: '⌘' },
  { name: 'Windows', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', key: 'Control', label: 'Ctrl' },
]) {
  test.describe(`${platform.name} mind-map shortcuts`, () => {
    test.use({ userAgent: platform.userAgent });

    test('drills into selected, focused and context-menu nodes, returns to parents, and preserves browser history', async ({
      page,
    }) => {
      const { errors } = await openMap(page, 'model', branchingMap, { presentOnly: true, savedMap: true });
      await expect(node(page, 'theme')).toBeVisible();
      await page.evaluate(() => history.pushState(null, '', `${location.href}&history-sentinel`));
      const url = page.url();
      const canvas = page.getByRole('region', { name: 'Interactive mind map' });
      const breadcrumbs = page.getByRole('navigation', { name: 'Mind map location' });
      await canvas.focus();
      await page.keyboard.press(`${platform.key}+[`);
      await page.keyboard.press(`${platform.key}+]`);
      await expect(page).toHaveURL(url);
      await expect(breadcrumbs).toHaveCount(0);
      await node(page, 'theme').getByRole('button', { name: 'Shared understanding', exact: true }).click();
      const drill = page.getByRole('button', { name: 'Drill down', exact: true });
      await drill.hover();
      await expect(page.getByRole('tooltip', { name: /^Drill down/ })).toContainText(`${platform.label} + ]`);
      await expect(drill).toHaveAttribute('aria-keyshortcuts', `${platform.key}+]`);
      await canvas.focus();
      await page.keyboard.press(`${platform.key}+]`);
      await expect(breadcrumbs.getByRole('button', { name: 'Shared understanding', exact: true })).toHaveAttribute(
        'aria-current',
        'location'
      );
      const back = page.locator('.ps-map-controls').getByRole('button', { name: 'Back to parent node', exact: true });
      await back.hover();
      await expect(page.getByRole('tooltip', { name: /Back to parent node/ })).toContainText(`${platform.label} + [`);
      await expect(back).toHaveAttribute('aria-keyshortcuts', `${platform.key}+[`);
      await node(page, 'peer').getByRole('button', { name: 'Project decisions', exact: true }).click();
      await node(page, 'detail').getByRole('button', { name: 'Product milestones', exact: true }).focus();
      await page.keyboard.press(`${platform.key}+]`);
      await expect(breadcrumbs.getByRole('button', { name: 'Product milestones', exact: true })).toHaveAttribute(
        'aria-current',
        'location'
      );
      await page.keyboard.press(`${platform.key}+[`);
      await expect(breadcrumbs.getByRole('button', { name: 'Shared understanding', exact: true })).toHaveAttribute(
        'aria-current',
        'location'
      );
      await back.click();
      await expect(breadcrumbs).toHaveCount(0);
      await node(page, 'other').click({ button: 'right' });
      const menuDrill = page.getByRole('menuitem', { name: 'Drill down', exact: true });
      await expect(menuDrill.locator('kbd')).toHaveText(`${platform.label} + ]`);
      await page.keyboard.press(`${platform.key}+]`);
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(breadcrumbs.getByRole('button', { name: 'Team planning', exact: true })).toHaveAttribute(
        'aria-current',
        'location'
      );
      await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await page.keyboard.press(`${platform.key}+[`);
      await expect(breadcrumbs).toHaveCount(0);
      await node(page, 'theme').getByRole('button', { name: 'Shared understanding', exact: true }).click();
      await page.keyboard.press(`${platform.key}+]`);
      await expect(node(page, 'other')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await page.keyboard.press('Escape');
      await page.mouse.move(600, 800);
      await node(page, 'detail').getByRole('button', { name: 'Product milestones', exact: true }).click();
      await page.screenshot({
        path: `test-results/presentation/mindmap-shortcuts-${platform.name}.png`,
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(page.locator('.ps-node-detail')).toHaveCount(0);
      await expect(canvas).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(canvas).toHaveCount(0);
      await expect(page).toHaveURL(url);
      expect(errors).toEqual([]);
    });
  });
}

test('uses an icon-only native toolbar with shortcut tooltips in fullscreen and on narrow screens', async ({ page }) => {
  const { errors } = await openMap(page, 'model', branchingMap, { presentOnly: true, savedMap: true });
  const toolbar = page.getByRole('group', { name: 'Mind map controls' });
  const zoomTooltip = page.getByRole('tooltip', { name: /^Zoom in/ });
  const drill = toolbar.getByRole('button', { name: 'Drill down into selected node' });
  const zoomIn = toolbar.getByRole('button', { name: 'Zoom in', exact: true });
  await expect(node(page, 'theme')).toBeVisible();
  expect((await toolbar.getByRole('button').allTextContents()).every((label) => label.trim() === '')).toBe(true);
  await expect(drill).toBeDisabled();
  await zoomIn.hover();
  await expect(zoomTooltip).toContainText('Zoom in');
  await expect(zoomTooltip).toContainText('+');
  const nativeHoverColor = await toolbar.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-action)';
    el.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(zoomIn).toHaveCSS('color', nativeHoverColor);
  await expect(zoomIn).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await toolbar.getByRole('button', { name: 'Reset zoom to 100%' }).hover();
  await expect(page.getByRole('tooltip', { name: /^Reset zoom/ })).toContainText(`Current zoom: ${await zoom(page)}%`);
  await node(page, 'theme').getByRole('button', { name: 'Shared understanding', exact: true }).click();
  await expect(drill).toBeEnabled();
  await drill.click();
  const back = toolbar.getByRole('button', { name: 'Back to parent node' });
  await expect(back).toBeVisible();
  await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.mouse.move(700, 1080);
  await toolbar.getByRole('button', { name: 'Fit to screen', exact: true }).hover();
  const fitTooltip = page.getByRole('tooltip', { name: /^Fit to screen/ });
  await expect(fitTooltip).toContainText('F / 0');
  expect(await fitTooltip.evaluate((el) => document.fullscreenElement!.contains(el))).toBe(true);
  await page.keyboard.press('Escape');
  await back.hover();
  await expect(page.getByRole('tooltip', { name: /Back to parent node/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/presentation/mindmap-icon-toolbar-light.png', animations: 'disabled' });
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await back.hover();
  await page.screenshot({ path: 'test-results/presentation/mindmap-icon-toolbar-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      toolbar.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      })
    )
    .toBe(true);
  await back.click();
  await expect(page.getByRole('navigation', { name: 'Mind map location' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/presentation/mindmap-icon-toolbar-narrow.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

const structures = [
  { value: 'right', label: 'Right-facing tree' },
  { value: 'left', label: 'Left-facing tree' },
  { value: 'balanced', label: 'Two-sided mind map' },
  { value: 'down', label: 'Top-down tree' },
];

async function selectMapStyle(page: Page, label: string) {
  const radio = page.getByRole('dialog', { name: 'Mind map styles' }).getByRole('radio', { name: label });
  await radio.locator('..').click();
  await expect(radio).toBeChecked();
}

test('balances a large document under one title heading and preserves collapse, drill-down and source numbers', async ({
  page,
}) => {
  const map: MindMap = {
    ...generated,
    nodes: [
      generated.nodes[0],
      { ...generated.nodes[1], id: 'title', label: 'Document title' },
      ...Array.from({ length: 10 }, (_, section) => [
        {
          id: `section-${section}`,
          parentId: 'title',
          label: `Section ${section + 1}`,
          summary: '',
          sourceIds: [SAMPLE_SNAPSHOT.blocks[1].id],
        },
        ...Array.from({ length: 4 }, (_, detail) => ({
          id: `detail-${section}-${detail}`,
          parentId: `section-${section}`,
          label: `Finding ${section + 1}.${detail + 1}`,
          summary: 'The original finding and source are preserved.',
          sourceIds: [SAMPLE_SNAPSHOT.blocks[2].id],
        })),
      ]).flat(),
    ],
  };
  const { errors } = await openMap(page, 'model', map, { presentOnly: true, savedMap: true });
  const checkSides = async () => {
    const positions = await page.locator('.ps-map-node').evaluateAll((elements) =>
      elements.map((el) => ({
        id: el.getAttribute('data-node-id'),
        x: parseFloat((el as HTMLElement).style.left),
        y: parseFloat((el as HTMLElement).style.top),
      }))
    );
    const title = positions.find((p) => p.id === 'title')!;
    const sections = positions.filter((p) => p.id?.startsWith('section-'));
    expect(sections.filter((p) => p.x < title.x)).toHaveLength(5);
    expect(sections.filter((p) => p.x > title.x)).toHaveLength(5);
    expect(positions).toHaveLength(map.nodes.length);
    const root = positions.find((p) => p.id === 'topic')!;
    expect(root.x).toBe(title.x);
    expect(root.y + 64).toBeLessThan(title.y);
  };
  await checkSides();
  const root = node(page, 'topic').locator('button').first();
  await expect(node(page, 'topic')).toHaveAttribute('data-side', 'down');
  await root.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.ps-map-node')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await checkSides();
  await page.getByRole('button', { name: 'Collapse Document title', exact: true }).click();
  await expect(page.locator('.ps-map-node')).toHaveCount(2);
  await page.getByRole('button', { name: 'Expand Document title', exact: true }).click();
  await checkSides();
  await page.getByRole('button', { name: 'Mind map styles', exact: true }).click();
  await selectMapStyle(page, 'Left-facing tree');
  const leftHeight = await page.locator('.ps-map-content').evaluate((el) => el.clientHeight);
  await selectMapStyle(page, 'Two-sided mind map');
  await checkSides();
  expect(await page.locator('.ps-map-content').evaluate((el) => el.clientHeight)).toBeLessThan(leftHeight * 0.6);
  await selectMapStyle(page, 'Rounded branches');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await page.screenshot({
    path: 'test-results/presentation/mindmap-two-sided-single-heading.png',
    animations: 'disabled',
  });
  await node(page, 'title').locator('button').first().click();
  await page.getByRole('button', { name: 'Drill down', exact: true }).click();
  await node(page, 'section-0').locator('button').first().click();
  const panel = page.locator('.ps-node-detail');
  await expect(panel.getByRole('button', { name: /^Open source 3:/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Back to parent node', exact: true }).click();
  await checkSides();
  expect(errors).toEqual([]);
});

test('switches all four structures and both branch lines while keeping the content and collapsed branches', async ({
  page,
}) => {
  const { errors } = await openMap(page, 'model', branchingMap, { presentOnly: true, savedMap: true });
  const canvas = page.getByRole('region', { name: 'Interactive mind map' });
  await page.getByRole('button', { name: 'Collapse Team planning', exact: true }).click();
  const labels = await page.locator('.ps-map-node > button:first-child').allTextContents();
  await page.getByRole('button', { name: 'Mind map styles', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Mind map styles' });
  for (const structure of structures) {
    await selectMapStyle(page, structure.label);
    await expect(canvas).toHaveAttribute('data-structure', structure.value);
    expect(await page.locator('.ps-map-node > button:first-child').allTextContents()).toEqual(labels);
    const positions = await page.locator('.ps-map-node').evaluateAll((elements) =>
      elements.map((el) => ({
        id: el.getAttribute('data-node-id'),
        x: parseFloat((el as HTMLElement).style.left),
        y: parseFloat((el as HTMLElement).style.top),
      }))
    );
    const root = positions.find((p) => p.id === 'topic')!;
    const branches = positions.filter((p) => ['theme', 'other', 'third'].includes(p.id!));
    if (structure.value === 'down') expect(branches.every((p) => p.y > root.y)).toBe(true);
    else if (structure.value === 'right') expect(branches.every((p) => p.x > root.x)).toBe(true);
    else if (structure.value === 'left') expect(branches.every((p) => p.x < root.x)).toBe(true);
    else {
      expect(branches.some((p) => p.x < root.x)).toBe(true);
      expect(branches.some((p) => p.x > root.x)).toBe(true);
    }
    for (const line of ['Rounded branches', 'Curved branches']) {
      await selectMapStyle(page, line);
      const paths = await page
        .locator('.ps-map-lines path')
        .evaluateAll((els) => els.map((el) => el.getAttribute('d')!));
      expect(paths).toHaveLength(labels.length - 1);
      expect(paths.every((d) => (line.startsWith('Curved') ? d.includes(' C ') : !d.includes(' C ')))).toBe(true);
      await expect(picker).toBeVisible();
    }
    await page.screenshot({
      path: `test-results/presentation/mindmap-structure-${structure.value}.png`,
      animations: 'disabled',
    });
  }
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand Team planning', exact: true })).toHaveText('1');
  const theme = node(page, 'theme').getByRole('button', { name: 'Shared understanding', exact: true });
  await theme.focus();
  await page.keyboard.press('ArrowUp');
  await expect(node(page, 'detail')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(node(page, 'detail')).toBeVisible();
  await page.keyboard.press('Alt+Enter');
  await expect(node(page, 'other')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-structure', 'down');
  await expect(page.getByRole('navigation', { name: 'Mind map location' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps the style picker usable in fullscreen, in both themes, and on narrow screens', async ({ page }) => {
  const { errors } = await openMap(page, 'model', branchingMap, { presentOnly: true, savedMap: true });
  await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.mouse.move(700, 1080);
  const trigger = page.getByRole('button', { name: 'Mind map styles', exact: true });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Mind map styles' });
  expect(await picker.evaluate((el) => document.fullscreenElement!.contains(el))).toBe(true);
  await selectMapStyle(page, 'Right-facing tree');
  await page.getByRole('radio', { name: 'Right-facing tree' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Left-facing tree' })).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Rounded branches' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  for (const dark of [false, true]) {
    if (dark) await page.keyboard.press('ControlOrMeta+Shift+L');
    await trigger.click();
    const colors = await picker.evaluate((el) => {
      const probe = document.createElement('span');
      el.append(probe);
      const resolve = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const result = {
        selected: resolve('--fill-theme-select'),
        action: resolve('--text-action'),
        surface: resolve('--surface-layer-01'),
        hover: resolve('--fill-content-hover'),
      };
      probe.remove();
      return result;
    });
    await expect(picker).toHaveCSS('background-color', colors.surface);
    const selected = picker.getByRole('radio', { name: 'Left-facing tree' }).locator('..').locator('span');
    await expect(selected).toHaveCSS('background-color', colors.selected);
    await expect(selected).toHaveCSS('color', colors.action);
    const other = picker.getByRole('radio', { name: 'Right-facing tree' }).locator('..');
    await other.hover();
    await expect(other.locator('span')).toHaveCSS('background-color', colors.hover);
    await page.screenshot({
      path: `test-results/presentation/mindmap-style-picker-${dark ? 'dark' : 'light'}.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  expect(
    await picker.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    })
  ).toBe(true);
  await selectMapStyle(page, 'Top-down tree');
  await page.screenshot({ path: 'test-results/presentation/mindmap-style-picker-narrow.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('automatically fits every node after changing the structure of a large map', async ({ page }) => {
  const largeMap: MindMap = {
    schemaVersion: 1,
    warnings: [],
    nodes: [
      branchingMap.nodes[0],
      ...Array.from({ length: 124 }, (_, i) => ({
        id: `item-${i}`,
        parentId: 'topic',
        label: `Topic ${i + 1}`,
        summary: '',
        sourceIds: [SAMPLE_SNAPSHOT.pageId],
      })),
    ],
  };
  const { errors } = await openMap(page, 'model', largeMap, { presentOnly: true, savedMap: true });
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('.ps-map-node')).toHaveCount(125);
  await page.getByRole('button', { name: 'Mind map styles', exact: true }).click();
  for (const structure of structures) {
    await selectMapStyle(page, structure.label);
    await expect
      .poll(() =>
        page.locator('.ps-map-node').evaluateAll((nodes) =>
          nodes.every((el) => {
            const box = el.getBoundingClientRect();
            return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
          })
        )
      )
      .toBe(true);
    const scale = await zoom(page);
    await selectMapStyle(page, 'Rounded branches');
    expect(await zoom(page)).toBe(scale);
    await selectMapStyle(page, 'Curved branches');
    expect(await zoom(page)).toBe(scale);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Mind map styles' })).toHaveCount(0);
  const target = page.locator('.ps-map-node').first();
  const before = await target.boundingBox();
  await target.locator('button').first().click();
  await expect(page.locator('.ps-node-detail')).toBeVisible();
  const after = await target.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  expect((await popoverGeometry(page)).distance).toBeLessThanOrEqual(17);
  expect(errors).toEqual([]);
});

async function popoverGeometry(page: Page) {
  return page.locator('.ps-node-detail').evaluate((el) => {
    const box = el.getBoundingClientRect();
    const selected = document.querySelector('.ps-map-selected')!.getBoundingClientRect();
    const area = (other: DOMRect) =>
      Math.max(0, Math.min(box.right, other.right) - Math.max(box.left, other.left)) *
      Math.max(0, Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top));
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      withinViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      selectedOverlap: area(selected),
      otherOverlap: [...document.querySelectorAll('.ps-map-node:not(.ps-map-selected)')].reduce(
        (sum, node) => sum + area(node.getBoundingClientRect()),
        0
      ),
      distance: Math.min(
        Math.abs(box.right - selected.left),
        Math.abs(box.left - selected.right),
        Math.abs(box.bottom - selected.top),
        Math.abs(box.top - selected.bottom)
      ),
    };
  });
}

test('attaches node details to free space near either side and follows pan and zoom without three-dot menus', async ({
  page,
}) => {
  const { errors } = await openMap(page, 'model', branchingMap, { presentOnly: true, savedMap: true });
  const canvas = page.getByRole('region', { name: 'Interactive mind map' });
  await expect(page.locator('.ps-map-node-menu')).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
  for (const id of ['detail', 'other']) {
    await node(page, id).locator('button').first().click();
    const panel = page.locator('.ps-node-detail');
    await expect(panel).toBeVisible();
    await expect.poll(async () => (await popoverGeometry(page)).otherOverlap).toBe(0);
    const box = await popoverGeometry(page);
    expect(box.selectedOverlap).toBe(0);
    expect(box.withinViewport).toBe(true);
    expect(box.distance).toBeLessThanOrEqual(17);
    await page.screenshot({ path: `test-results/presentation/mindmap-node-popover-${id}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(node(page, id).locator('button').first()).toBeFocused();
  }
  await node(page, 'theme').locator('button').first().click();
  const initial = await popoverGeometry(page);
  await page.mouse.move(700, 180);
  await page.mouse.down();
  await page.mouse.move(800, 240, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.ps-node-detail')).toBeVisible();
  await expect.poll(async () => Math.abs((await popoverGeometry(page)).x - initial.x)).toBeGreaterThan(20);
  const previousZoom = await zoom(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => zoom(page)).toBeGreaterThan(previousZoom);
  await expect.poll(async () => (await popoverGeometry(page)).distance).toBeLessThanOrEqual(17);
  await expect(page.locator('.ps-node-detail')).toHaveCSS('width', '300px');
  await page.mouse.click(30, 180);
  await expect(page.locator('.ps-node-detail')).toHaveCount(0);
  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps long node details scrollable and attached in fullscreen, dark mode and narrow viewports', async ({
  page,
}) => {
  const map: MindMap = {
    ...branchingMap,
    nodes: branchingMap.nodes.map((node) =>
      node.id === 'theme'
        ? {
            ...node,
            summary: Array.from({ length: 12 }, (_, i) => `Finding ${i + 1}: Teams share knowledge and decisions.`).join(
              '\n'
            ),
          }
        : node
    ),
  };
  const { errors } = await openMap(page, 'model', map, { presentOnly: true, savedMap: true });
  await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await node(page, 'theme').locator('button').first().click();
  const panel = page.getByRole('dialog', { name: 'Shared understanding', exact: true });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => document.fullscreenElement!.contains(el))).toBe(true);
  await expect(panel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Close node details' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await page.setViewportSize({ width: 390, height: 844 });
  await node(page, 'theme').locator('button').first().click();
  await expect(panel).toBeVisible();
  const box = await popoverGeometry(page);
  expect(box.withinViewport).toBe(true);
  expect(box.selectedOverlap).toBe(0);
  expect(await panel.locator('.ps-node-detail-content').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await panel.locator('.ps-node-detail-content').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(panel.getByRole('heading', { name: 'Go to source' })).toHaveCount(0);
  await panel.getByRole('group', { name: 'Sources', exact: true }).getByRole('button').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-opened-source', SAMPLE_SNAPSHOT.blocks[0].id);
  await panel.locator('.ps-node-detail-content').evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({
    path: 'test-results/presentation/mindmap-node-popover-dark-narrow.png',
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: 'Close node details' }).click();
  await expect(node(page, 'theme').locator('button').first()).toBeFocused();
  expect(errors).toEqual([]);
});

test('places parent and drill icons in a fixed popover footer with native hover and fullscreen shortcut tooltips', async ({
  page,
}) => {
  const map: MindMap = {
    ...branchingMap,
    nodes: branchingMap.nodes.map((node) =>
      node.id === 'theme'
        ? {
            ...node,
            summary: Array.from({ length: 12 }, () => 'Share project knowledge, decisions, and everyday work.').join(
              '\n'
            ),
          }
        : node
    ),
  };
  const { errors } = await openMap(page, 'model', map, { presentOnly: true, savedMap: true });
  await node(page, 'theme').locator('button').first().click();
  const panel = page.locator('.ps-node-detail');
  const nav = panel.getByRole('group', { name: 'Node navigation' });
  const back = nav.getByRole('button', { name: 'Back to parent node' });
  const drill = nav.getByRole('button', { name: 'Drill down', exact: true });
  await expect(back).toBeDisabled();
  expect(await nav.getByRole('button').allTextContents()).toEqual(['', '']);
  const footerBefore = await nav.boundingBox();
  await panel.locator('.ps-node-detail-content').evaluate((el) => (el.scrollTop = el.scrollHeight));
  const footerAfter = await nav.boundingBox();
  expect(footerAfter).toEqual(footerBefore);
  const box = await panel.boundingBox();
  const drillBox = await drill.boundingBox();
  const source = panel.getByRole('button', { name: /^Open source 2:/ });
  const sourceBox = await source.boundingBox();
  expect(Math.abs(sourceBox!.y + sourceBox!.height / 2 - drillBox!.y - drillBox!.height / 2)).toBeLessThan(1);
  await expect(source).toHaveCSS('width', '24px');
  await expect(source).toHaveCSS('height', '24px');
  await expect(source).toHaveCSS('border-radius', '50%');
  expect(box!.x + box!.width - drillBox!.x - drillBox!.width).toBeLessThan(16);
  expect(box!.y + box!.height - drillBox!.y - drillBox!.height).toBeLessThan(12);
  await back.locator('..').hover();
  await expect(page.getByRole('tooltip', { name: /^Back to parent node/ })).toContainText('[');
  await drill.hover();
  await expect(page.getByRole('tooltip', { name: /^Drill down/ })).toContainText(']');
  const hover = await drill.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--fill-content-hover)';
    el.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(drill).toHaveCSS('background-color', hover);
  await page.screenshot({ path: 'test-results/presentation/mindmap-popover-footer-light.png', animations: 'disabled' });
  await drill.click();
  await node(page, 'detail').locator('button').first().click();
  await expect(back).toBeEnabled();
  await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await back.hover();
  const tooltip = page.getByRole('tooltip', { name: /^Back to parent node/ });
  await expect(tooltip).toBeVisible();
  expect(await tooltip.evaluate((el) => document.fullscreenElement!.contains(el))).toBe(true);
  await page.screenshot({ path: 'test-results/presentation/mindmap-popover-footer-dark.png', animations: 'disabled' });
  await back.click();
  await expect(page.getByRole('navigation', { name: 'Mind map location' })).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  expect(errors).toEqual([]);
});

test('wraps numbered sources beside navigation without losing source targets in light and dark fullscreen', async ({
  page,
}) => {
  const sourceIds = SAMPLE_SNAPSHOT.blocks.slice(0, 9).map((block) => block.id);
  const map: MindMap = {
    ...branchingMap,
    nodes: branchingMap.nodes.map((item) => (item.id === 'theme' ? { ...item, sourceIds } : item)),
  };
  const { errors } = await openMap(page, 'model', map, { presentOnly: true, savedMap: true });
  await node(page, 'theme').locator('button').first().click();
  const panel = page.locator('.ps-node-detail');
  const sources = panel.getByRole('group', { name: 'Sources', exact: true }).getByRole('button');
  await expect(sources).toHaveText(sourceIds.map((_, index) => String(index + 2)));
  await expect(panel.getByText('Go to source', { exact: true })).toHaveCount(0);
  for (const dark of [false, true]) {
    if (dark) {
      await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await page.keyboard.press('ControlOrMeta+Shift+L');
      await page.setViewportSize({ width: 390, height: 844 });
    }
    // Wait for popover repositioning after fullscreen/viewport changes and
    // measure all related rectangles in one frame.
    await expect
      .poll(() =>
        panel.evaluate((el) => {
          const buttons = el.querySelectorAll('[aria-label="Sources"] button');
          const first = buttons[0].getBoundingClientRect();
          const last = buttons[buttons.length - 1].getBoundingClientRect();
          const nav = el.querySelector('[aria-label="Node navigation"]')!.getBoundingClientRect();
          return last.y > first.bottom && Math.abs(last.y + last.height / 2 - nav.y - nav.height / 2) < 1;
        })
      )
      .toBe(true);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (let index = 0; index < sourceIds.length; index++) {
      await sources.nth(index).click();
      await expect(page.locator('html')).toHaveAttribute('data-opened-source', sourceIds[index]);
    }
    await sources.last().hover();
    const tooltip = page.getByRole('tooltip', { name: `Source 10 · ${sourceIds[8]}` });
    await expect(tooltip).toBeVisible();
    if (dark) expect(await tooltip.evaluate((el) => document.fullscreenElement!.contains(el))).toBe(true);
    const hover = await sources.last().evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--fill-content-hover)';
      el.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect(sources.last()).toHaveCSS('background-color', hover);
    await page.screenshot({
      path: `test-results/presentation/mindmap-sources-${dark ? 'dark-narrow' : 'light'}.png`,
      animations: 'disabled',
    });
  }
  expect(errors).toEqual([]);
});

test('keeps cumulative source numbers across nodes, shared references and drill-down', async ({ page }) => {
  const [first, shared, last] = SAMPLE_SNAPSHOT.blocks.slice(0, 3).map((block) => block.id);
  const map: MindMap = {
    ...generated,
    nodes: generated.nodes.map((item) => ({
      ...item,
      sourceIds: item.id === 'theme' ? [first, shared] : item.id === 'detail' ? [shared, last] : item.sourceIds,
    })),
  };
  const { errors } = await openMap(page, 'model', map, { presentOnly: true, savedMap: true });
  const panel = page.locator('.ps-node-detail');
  const sources = panel.getByRole('group', { name: 'Sources', exact: true }).getByRole('button');
  // Open the last node first: numbering follows the map, not the click order.
  await node(page, 'detail').locator('button').first().click();
  await expect(sources).toHaveText(['3', '4']);
  await panel.getByRole('button', { name: `Open source 3: ${shared}`, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-opened-source', shared);
  await node(page, 'theme').locator('button').first().click();
  await expect(sources).toHaveText(['2', '3']);
  await panel.getByRole('button', { name: 'Drill down', exact: true }).click();
  await node(page, 'detail').locator('button').first().click();
  await expect(sources).toHaveText(['3', '4']);
  await panel.getByRole('button', { name: 'Back to parent node', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await node(page, 'theme').locator('button').first().click();
  await expect(sources).toHaveText(['2', '3']);
  await expect(node(page, 'detail')).toHaveCount(0);
  await node(page, 'topic').locator('button').first().click();
  await expect(sources).toHaveText(['1']);
  expect(errors).toEqual([]);
});
