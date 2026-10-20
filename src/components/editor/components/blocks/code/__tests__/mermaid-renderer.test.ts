import mermaid from 'mermaid';

import { renderMermaid } from '../mermaid-renderer';

jest.mock('mermaid', () => ({ __esModule: true, default: { initialize: jest.fn(), render: jest.fn() } }));
const render = mermaid.render as jest.Mock;
const initialize = mermaid.initialize as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  render.mockResolvedValue({ svg: '<svg><text>diagram</text></svg>' });
});

test('invalid diagrams do not poison subsequent renders and temporary DOM is always removed', async () => {
  render.mockRejectedValueOnce(new Error('syntax'));
  const before = document.body.childElementCount;

  await expect(renderMermaid('invalid', false)).rejects.toThrow('syntax');
  await expect(renderMermaid('graph TD; A-->B', false)).resolves.toContain('<text>diagram</text>');
  expect(document.body.childElementCount).toBe(before);
});

test('serializes theme configuration and rendering; IDs remain unique across diagrams', async () => {
  let finish!: (value: { svg: string }) => void;

  render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const first = renderMermaid('light', false);
  const second = renderMermaid('dark', true);

  await Promise.resolve();
  await Promise.resolve();
  expect(initialize).toHaveBeenCalledTimes(1);
  finish({ svg: '<svg><text>light</text></svg>' });
  await Promise.all([first, second]);
  expect(initialize.mock.calls[0][0].themeVariables.darkMode).toBe(false);
  expect(initialize.mock.calls[1][0].themeVariables.darkMode).toBe(true);
  expect(render.mock.calls[0][0]).not.toBe(render.mock.calls[1][0]);
});

test('skips stale queued work and refuses stale results after source changes', async () => {
  await expect(renderMermaid('old', false, () => false)).resolves.toBeUndefined();
  expect(render).not.toHaveBeenCalled();
  let current = true;

  render.mockImplementationOnce(async () => {
    current = false;
    return { svg: '<svg />' };
  });
  await expect(renderMermaid('changed', false, () => current)).resolves.toBeUndefined();
});

test('untrusted SVG cannot include executable scripts, foreign HTML or event handlers', async () => {
  render.mockResolvedValue({
    svg: '<svg onload="alert(1)"><script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject><text>safe</text></svg>',
  });
  const svg = await renderMermaid('untrusted', true);

  expect(svg).toContain('safe');
  expect(svg).not.toMatch(/script|foreignObject|onload|unsafe/);
  expect(initialize.mock.calls[0][0].securityLevel).toBe('strict');
});
