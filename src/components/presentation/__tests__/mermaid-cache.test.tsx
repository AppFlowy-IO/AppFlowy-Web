import { act, render, screen, waitFor } from '@testing-library/react';
import mermaid from 'mermaid';

import { cachedMermaid, renderMermaid } from '@/components/editor/components/blocks/code/mermaid-renderer';
import MermaidPreview from '@/components/editor/components/blocks/code/MermaidPreview';

jest.mock('mermaid', () => ({ __esModule: true, default: { initialize: jest.fn(), render: jest.fn() } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

const mermaidRender = mermaid.render as jest.Mock;
// Mermaid scopes a diagram's styles and markers by the render ID.
const diagram = (id: string) =>
  `<svg id="${id}"><style>#${id} .node { fill: #e6e9f0; }</style><defs><marker id="${id}_pointEnd"></marker></defs>` +
  `<path marker-end="url(#${id}_pointEnd)"></path></svg>`;
const ids = (svg?: string) => [...new Set(svg?.match(/appflowy-mermaid-\d+/g))];
const preview = (source: string) => (
  <MermaidPreview source={source} expanded={false} showPreview onClose={() => undefined} />
);

beforeEach(() => {
  mermaidRender.mockReset().mockImplementation(async (id: string) => ({ svg: diagram(id) }));
});

test('renders a diagram once per theme and gives every copy its own element IDs', async () => {
  const source = 'graph TD; A-->B';
  const copies = await Promise.all([renderMermaid(source, false), renderMermaid(source, false)]);

  copies.push(await renderMermaid(source, false), cachedMermaid(source, false));
  await renderMermaid(source, true);
  expect(mermaidRender).toHaveBeenCalledTimes(2);
  // Styles, markers and their references move to the copy's ID together.
  copies.forEach((svg) => expect(ids(svg)).toHaveLength(1));
  expect(new Set(copies.map((svg) => ids(svg)[0])).size).toBe(copies.length);
  expect(new Set(copies.map((svg) => svg?.replace(/appflowy-mermaid-\d+/g, 'id'))).size).toBe(1);
});

test('keeps a bounded set of the most recently used diagrams', async () => {
  await renderMermaid('lru 0', false);
  await renderMermaid('lru 1', false);
  expect(cachedMermaid('lru 0', false)).toBeDefined();
  for (let index = 2; index <= 32; index++) await renderMermaid(`lru ${index}`, false);
  expect(cachedMermaid('lru 1', false)).toBeUndefined();
  expect(cachedMermaid('lru 0', false)).toBeDefined();
  expect(cachedMermaid('lru 32', false)).toBeDefined();
});

test('a preview of a rendered diagram shows it at once, without the debounce or another render', async () => {
  const source = 'graph LR; Source-->Slide';

  await renderMermaid(source, false);
  mermaidRender.mockClear();
  render(preview(source));
  expect(screen.queryByText('Rendering diagram…')).toBeNull();
  expect(screen.getByTestId('mermaid-diagram').querySelector('svg')).not.toBeNull();
  await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
  expect(mermaidRender).not.toHaveBeenCalled();
});

test('two previews of a new diagram, like a slide and its measuring copy, render it once', async () => {
  const source = 'graph TD; Ruler-->Slide';

  render(
    <>
      {preview(source)}
      {preview(source)}
    </>
  );
  expect(screen.getAllByText('Rendering diagram…')).toHaveLength(2);
  await waitFor(() => expect(screen.getAllByTestId('mermaid-diagram')).toHaveLength(2));
  expect(mermaidRender).toHaveBeenCalledTimes(1);
  const [first, second] = screen.getAllByTestId('mermaid-diagram').map((element) => element.querySelector('svg')?.id);

  expect(first).not.toBe(second);
});
