import highlighter from '../code-grammars';
import { filterCodeLanguages, normalizeCodeLanguage, supportLanguages } from '../constants';
import { decorateCode } from '../utils';

describe('Flutter language compatibility and GitHub regressions', () => {
  test.each(supportLanguages.filter(({ id }) => !['auto', 'plaintext'].includes(id)))(
    '$title has a bundled grammar',
    ({ id }) => {
      expect(highlighter.getLanguage(id)).toBeDefined();
    }
  );
  test.each([
    ['C#', 'cs'],
    ['plain text', 'plaintext'],
    ['delphi', 'delphi'],
    ['HTML', 'html'],
    ['cpp', 'cpp'],
    ['yml', 'yaml'],
    ['', 'auto'],
  ])('%s normalizes to %s', (input, output) => {
    expect(normalizeCodeLanguage(input)).toBe(output);
  });
  test('search trims, ignores case and matches IDs, labels and aliases', () => {
    expect(filterCodeLanguages(' RUST ').map(({ id }) => id)).toEqual(['rust']);
    expect(filterCodeLanguages('c#').map(({ id }) => id)).toEqual(['cs']);
    expect(filterCodeLanguages('not-a-language')).toEqual([]);
    expect(filterCodeLanguages('Java').map(({ id }) => id)).toEqual(['java', 'javascript']);
  });
  test.each([
    ['rust', 'fn main() { let x: u32 = 3; println!("{}", x); }'],
    ['delphi', 'program Hello; begin writeln(42); end.'],
    ['verilog', 'module counter(input clk, output reg [3:0] count); endmodule'],
    ['vhdl', 'entity test is port(clk: in std_logic); end test;'],
    ['zig', 'const std = @import("std"); pub fn main() void {}'],
    ['python', 'def f(x):\n  return x + 1'],
    ['mermaid', 'graph TD\n  A --> B'],
  ])('%s highlights literals without changing their content', (language, text) => {
    const node = { text };
    const ranges = decorateCode([node, [0, 0, 0]], language);

    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0].anchor.offset).toBe(0);
    expect(ranges[ranges.length - 1].focus.offset).toBe(text.length);
    expect(node.text).toBe(text);
  });
  test('plain text and unknown languages are readable without fetching CSS or scripts', () => {
    const append = jest.spyOn(document.head, 'appendChild');

    expect(decorateCode([{ text: 'const value = 1;' }, [0]], 'plaintext')).toEqual([]);
    expect(decorateCode([{ text: 'const value = 1;' }, [0]], 'not-a-language')).toEqual([]);
    expect(append).not.toHaveBeenCalled();
    append.mockRestore();
  });
});

test('pasted Rust can be detected in Auto mode (#6919)', () => {
  const code = 'fn main() {\n    let mut items: Vec<i32> = vec![1, 2, 3];\n    for item in &items { println!("{}", item); }\n}';

  expect(highlighter.highlightAuto(code).language).toBe('rust');
});

test('decoration offsets preserve leading newlines, CRLF, Unicode and HTML metacharacters', () => {
  const text = '\n\r\ndef hello():\r\n  return "你好 <&>"';
  const ranges = decorateCode([{ text }, [0, 0, 0]], 'python');

  expect(ranges.map((range) => text.slice(range.anchor.offset, range.focus.offset)).join('')).toBe(text);
  expect(ranges.find((range) => range.prism_token.includes('keyword'))?.anchor.offset).toBe(3);
});
