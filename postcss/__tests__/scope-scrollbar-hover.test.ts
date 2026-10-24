/**
 * @jest-environment node
 */
import postcss from 'postcss';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const scopeScrollbarHover = require('../scope-scrollbar-hover.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { specificityOf } = require('../unwrap-sibling-is.cjs') as {
  specificityOf: (selector: string) => [number, number, number] | null;
};

const { scopeSelector, NESTED_SCROLLERS } = scopeScrollbarHover as {
  scopeSelector: (selector: string) => string[] | null;
  NESTED_SCROLLERS: string[];
};

async function run(css: string): Promise<string> {
  return (await postcss([scopeScrollbarHover()]).process(css, { from: undefined })).css;
}

describe('scope-scrollbar-hover', () => {
  const where = `:where(${NESTED_SCROLLERS.join(', ')})`;

  it('scopes the universal hover thumb of the editor package', async () => {
    const css =
      '.appflowy-scrollbar:hover::-webkit-scrollbar-thumb, .appflowy-scrollbar:hover *::-webkit-scrollbar-thumb {\n  border-radius: 4px;\n}';

    expect(await run(css)).toBe(
      `.appflowy-scrollbar:hover::-webkit-scrollbar-thumb, .appflowy-scrollbar:hover ${where}::-webkit-scrollbar-thumb, .appflowy-scrollbar *:hover::-webkit-scrollbar-thumb {\n  border-radius: 4px;\n}`
    );
  });

  it('scopes every universal-subject scrollbar part under :hover, with or without `*`', () => {
    expect(scopeSelector('body[data-os=windows] .MuiBox-root:hover *::-webkit-scrollbar-thumb')).toEqual([
      `body[data-os=windows] .MuiBox-root:hover ${where}::-webkit-scrollbar-thumb`,
      'body[data-os=windows] .MuiBox-root *:hover::-webkit-scrollbar-thumb',
    ]);
    expect(scopeSelector('.x:hover ::-webkit-scrollbar-track')).toEqual([
      `.x:hover ${where}::-webkit-scrollbar-track`,
      '.x *:hover::-webkit-scrollbar-track',
    ]);
  });

  it('keeps the specificity of the selector it replaces', () => {
    const original = specificityOf('.appflowy-scroller:hover *::-webkit-scrollbar-thumb');

    expect(original).toEqual([0, 2, 1]);
    scopeSelector('.appflowy-scroller:hover *::-webkit-scrollbar-thumb')?.forEach((selector) => {
      expect(specificityOf(selector)).toEqual(original);
    });
  });

  it('lists only class selectors', () => {
    NESTED_SCROLLERS.forEach((selector) => expect(selector).toMatch(/^\.[-a-z]+$/));
  });

  it('leaves every other selector alone', () => {
    [
      '.appflowy-scroller:hover::-webkit-scrollbar-thumb',
      '.appflowy-scroller *::-webkit-scrollbar-thumb',
      '::-webkit-scrollbar-thumb:hover',
      '.x:hover .y::-webkit-scrollbar-thumb',
      '.x:hover > *::-webkit-scrollbar-thumb',
      '.x:hover *',
      '.x:focus *::-webkit-scrollbar-thumb',
      '.x\\:hover *::-webkit-scrollbar-thumb',
      ':hover *::-webkit-scrollbar-thumb',
    ].forEach((selector) => expect(scopeSelector(selector)).toBeNull());
  });
});
