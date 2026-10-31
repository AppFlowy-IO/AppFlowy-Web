import { expect, test } from '@playwright/test';

const title = 'Model training';
const paragraph = 'Training data quality improves knowledge and task coverage.';
const row = '| Pretraining | Large-scale web text | Curated, multilingual data |';
const input = {
  title,
  markdown: `# ${title}\n\n${'Earlier document content.\n\n'.repeat(
    45
  )}${paragraph}\n\n| Dimension | Earlier approach | Modern approach |\n| --- | --- | --- |\n${row}\n| Post-training | Supervised fine-tuning | Verifiable rewards |\n\n${'Later document content.\n\n'.repeat(
    35
  )}`,
  map: {
    schemaVersion: 1,
    warnings: [],
    nodes: [
      { id: 'root', parentId: null, label: title, summary: '', sourceIds: ['L1'] },
      {
        id: 'training',
        parentId: 'root',
        label: 'Pretraining data',
        summary: 'Training data improves coverage.',
        sourceIds: ['L53', 'L62'],
      },
    ],
  },
  mapImport: {
    fileName: 'article.json',
    importedAt: '2026-10-23T00:00:00Z',
    referenceKind: 'external',
    sourceQuotes: { L1: title, L53: row, L62: paragraph },
  },
};

test('imported sources exit the map, scroll the real editor to a table row or paragraph, and work repeatedly', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/presentation-source-input.json', (route) => route.fulfill({ json: input }));
  await page.route('**/presentation-source-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-mindmap-source.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto('/presentation-source-fixture');
  await expect(page.getByTestId('reference-resolution')).toHaveAttribute('data-resolved', '3');
  const resolution = JSON.parse((await page.getByTestId('reference-resolution').textContent()) ?? '{}').resolved;

  for (const [ref, number] of [
    ['L53', 2],
    ['L62', 3],
    ['L53', 2],
  ] as const) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.getByRole('button', { name: 'Present mind map', exact: true }).click();
    if (ref === 'L62') {
      await page.getByRole('button', { name: 'Present mind map fullscreen' }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    }
    await page.getByRole('button', { name: 'Pretraining data', exact: true }).click();
    await page.getByRole('button', { name: `Open source ${number}: ${ref}`, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Interactive mind map' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await expect(page.locator('html')).toHaveAttribute('data-revealed', 'true');
    const target = page.locator(`[data-document-id="source-navigation-page"][data-block-id="${resolution[ref]}"]`);
    await expect(target).toBeInViewport();
    await expect(target).toHaveClass(/highlight-block/);
    if (ref === 'L53') await expect(target).toHaveAttribute('data-block-type', 'simple_table_row');
  }
  expect(errors).toEqual([]);
});
