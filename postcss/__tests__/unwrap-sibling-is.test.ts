/**
 * @jest-environment node
 */
import postcss from 'postcss';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const unwrapSiblingIs = require('../unwrap-sibling-is.cjs');

const { unwrapSelector, specificityOf } = unwrapSiblingIs as {
  unwrapSelector: (selector: string) => string[] | null;
  specificityOf: (selector: string) => [number, number, number] | null;
};

async function run(plugin: () => postcss.Plugin, css: string): Promise<string> {
  return (await postcss([plugin()]).process(css, { from: undefined })).css;
}

/** The thirteen rules of PERFORMANCE-REPORT W1, as Tailwind 3.4 emits them with `important: '#body'`. */
const THIRTEEN = [
  ['#body :is(.-space-x-2>:not([hidden])~:not([hidden]))', '#body .-space-x-2>:not([hidden])~:not([hidden])'],
  ['#body :is(.space-x-1>:not([hidden])~:not([hidden]))', '#body .space-x-1>:not([hidden])~:not([hidden])'],
  ['#body :is(.space-x-2>:not([hidden])~:not([hidden]))', '#body .space-x-2>:not([hidden])~:not([hidden])'],
  ['#body :is(.space-x-4>:not([hidden])~:not([hidden]))', '#body .space-x-4>:not([hidden])~:not([hidden])'],
  ['#body :is(.space-y-1>:not([hidden])~:not([hidden]))', '#body .space-y-1>:not([hidden])~:not([hidden])'],
  ['#body :is(.space-y-2>:not([hidden])~:not([hidden]))', '#body .space-y-2>:not([hidden])~:not([hidden])'],
  ['#body :is(.space-y-3>:not([hidden])~:not([hidden]))', '#body .space-y-3>:not([hidden])~:not([hidden])'],
  ['#body :is(.divide-y>:not([hidden])~:not([hidden]))', '#body .divide-y>:not([hidden])~:not([hidden])'],
  [
    '#body :is(.divide-border-primary>:not([hidden])~:not([hidden]))',
    '#body .divide-border-primary>:not([hidden])~:not([hidden])',
  ],
  [
    '#body :is(.\\[\\&\\>svg\\~\\*\\]\\:pl-7>svg~*)',
    '#body .\\[\\&\\>svg\\~\\*\\]\\:pl-7>svg~*',
  ],
  [
    '#body :is(.\\[\\&\\>svg\\+div\\]\\:translate-y-\\[-3px\\]>svg+div)',
    '#body .\\[\\&\\>svg\\+div\\]\\:translate-y-\\[-3px\\]>svg+div',
  ],
  [
    '#appflowy-editor :is(.\\[\\&\\>svg\\~\\*\\]\\:pl-7>svg~*)',
    '#appflowy-editor .\\[\\&\\>svg\\~\\*\\]\\:pl-7>svg~*',
  ],
  [
    '#appflowy-editor :is(.\\[\\&\\>svg\\+div\\]\\:translate-y-\\[-3px\\]>svg+div)',
    '#appflowy-editor .\\[\\&\\>svg\\+div\\]\\:translate-y-\\[-3px\\]>svg+div',
  ],
] as const;

describe('unwrap-sibling-is', () => {
  it.each(THIRTEEN)('unwraps %s', async (selector, expected) => {
    expect(unwrapSelector(selector)).toEqual([expected]);
    expect(await run(unwrapSiblingIs, `${selector}{margin-top:4px}`)).toBe(`${expected}{margin-top:4px}`);
  });

  it('keeps the specificity of every rewritten rule', () => {
    THIRTEEN.forEach(([selector, expected]) => {
      expect(specificityOf(expected)).toEqual(specificityOf(selector));
    });
    expect(specificityOf('#body :is(.space-y-1>:not([hidden])~:not([hidden]))')).toEqual([1, 3, 0]);
    expect(specificityOf('#body .stack>svg+div')).toEqual([1, 1, 2]);
  });

  it('unwraps the formatted output of Tailwind and the dependency stylesheets', () => {
    expect(unwrapSelector('#body :is(.space-y-1 > :not([hidden]) ~ :not([hidden]))')).toEqual([
      '#body .space-y-1 > :not([hidden]) ~ :not([hidden])',
    ]);
    expect(unwrapSelector('#appflowy-editor :is(.peer:disabled ~ .peer-disabled\\:opacity-70)')).toEqual([
      '#appflowy-editor .peer:disabled ~ .peer-disabled\\:opacity-70',
    ]);
  });

  it('splits an :is() list into one selector per entry', async () => {
    expect(unwrapSelector('#body :is(.a > .b ~ .c, .d > .e + .f)')).toEqual(['#body .a > .b ~ .c', '#body .d > .e + .f']);
    expect(await run(unwrapSiblingIs, '.x, #body :is(.a~.b, .c+.d){color:red}')).toBe(
      '.x, #body .a~.b, #body .c+.d{color:red}'
    );
  });

  it('keeps a list whose entries differ in specificity (:is() takes the highest)', () => {
    expect(unwrapSelector('#body :is(.a ~ .b, .c)')).toBeNull();
    expect(unwrapSelector('#body :is(.a ~ .b, .c ~ div)')).toBeNull();
  });

  it('keeps a pseudo-element after the :is()', () => {
    expect(unwrapSelector('#body :is(.peer:focus ~ .x)::placeholder')).toEqual(['#body .peer:focus ~ .x::placeholder']);
  });

  it('leaves selectors with a descendant combinator alone', async () => {
    const descendant = [
      '#body :is(.\\[\\&_\\[data-slot\\=dropdown-menu-sub-trigger\\]\\>\\.ml-auto\\+svg\\]\\:\\!ml-0 [data-slot=dropdown-menu-sub-trigger]>.ml-auto+svg)',
      '#body :is(.dark .dark\\:space-y-1 > :not([hidden]) ~ :not([hidden]))',
      '#body :is(.a ~ .b .c)',
      '#body :is(.a [data-x] + .c)',
    ];

    descendant.forEach((selector) => expect(unwrapSelector(selector)).toBeNull());
    const css = `${descendant[0]}{margin-left:0}`;

    expect(await run(unwrapSiblingIs, css)).toBe(css);
  });

  it('leaves selectors that are not `<id> :is(...)` alone', async () => {
    const untouched = [
      '.space-y-1 > :not([hidden]) ~ :not([hidden])',
      ':is(.a ~ .b)',
      '.c :is(.a ~ .b)',
      '[data-x] :is(.a ~ .b)',
      '#body.dark :is(.a ~ .b)',
      '#body:is(.a ~ .b)',
      '#body > :is(.a ~ .b)',
      '#body :is(.a ~ .b):hover',
      '#body :where(.a ~ .b)',
      '#body :is(.a > .b)',
      '#body :is(.group:hover .x)',
      '#body .a ~ .b',
    ];

    untouched.forEach((selector) => expect(unwrapSelector(selector)).toBeNull());
    for (const selector of untouched) {
      const css = `${selector}{color:red}`;

      expect(await run(unwrapSiblingIs, css)).toBe(css);
    }
  });

  it('does not read escaped characters as combinators', () => {
    expect(unwrapSelector('#body :is(.a\\~b > .c)')).toBeNull();
    expect(unwrapSelector('#body :is(.a\\ b ~ .c)')).toEqual(['#body .a\\ b ~ .c']);
    expect(unwrapSelector('#body :is(.\\32 xl\\:a ~ .b)')).toEqual(['#body .\\32 xl\\:a ~ .b']);
    expect(unwrapSelector('#body :is([data-x="a ~ b"] + .c)')).toEqual(['#body [data-x="a ~ b"] + .c']);
  });

  it('leaves keyframe selectors and unbalanced selectors alone', async () => {
    const keyframes = '@keyframes k{0%{opacity:0}to{opacity:1}}';

    expect(await run(unwrapSiblingIs, keyframes)).toBe(keyframes);
    expect(unwrapSelector('#body :is(.a ~ .b')).toBeNull();
    expect(unwrapSelector('#body :is(.a ~ [x)')).toBeNull();
  });

  it('rewrites rules nested in at-rules', async () => {
    expect(await run(unwrapSiblingIs, '@media (min-width:768px){#body :is(.md\\:space-x-2>:not([hidden])~:not([hidden])){margin-left:8px}}')).toBe(
      '@media (min-width:768px){#body .md\\:space-x-2>:not([hidden])~:not([hidden]){margin-left:8px}}'
    );
  });
});
