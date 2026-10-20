import { render, screen, waitFor } from '@testing-library/react';

import { MathEquationResponse } from '../MathEquationResponse';

jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));

describe('equation AI Markdown response', () => {
  it('renders headings, overlapping marks, nested lists, tasks, quotes, code, links, and tables', () => {
    const { container } = render(
      <MathEquationResponse
        content={[
          '## Solution',
          '**Bold and *italic*** with ~~old~~ and `code`.',
          '3. First\n4. Second\n   - Nested',
          '- [x] Verified\n- [ ] Pending',
          '> A useful note',
          '```js\nconst x = 2;\n```',
          '[Reference](https://example.com)',
          '| Symbol | Meaning |\n| --- | --- |\n| x | Unknown |',
        ].join('\n\n')}
      />
    );

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Solution');
    expect(container.querySelector('strong em')?.textContent).toBe('italic');
    expect(container.querySelector('s')?.textContent).toBe('old');
    expect(container.querySelector('ol > li')?.getAttribute('value')).toBe('3');
    expect(container.querySelector('ol > li > ul > li')?.textContent).toBe('Nested');
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').map((checkbox) => checkbox.checked)).toEqual([true, false]);
    expect(container.querySelector('blockquote')?.textContent).toBe('A useful note');
    expect(container.querySelector('pre code')?.textContent).toBe('const x = 2;');
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com');
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Symbol', 'Meaning']);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['x', 'Unknown']);
  });

  it.each([
    ['The variable $x$ is unknown.', false, 'x'],
    [String.raw`The variable \(x\) is unknown.`, true, 'x'],
    [String.raw`$$\frac{x}{2}$$`, true, String.raw`\frac{x}{2}`],
    [String.raw`\[\frac{x}{2}\]`, true, String.raw`\frac{x}{2}`],
    ['```latex\nx=2\n```', true, 'x=2'],
    ['```tex\nx=2\n```', true, 'x=2'],
    ['```math\nx=2\n```', true, 'x=2'],
    ['```latex\n$$x=2$$\n```', true, 'x=2'],
    ['```tex\n\\[x=2\\]\n```', true, 'x=2'],
  ])('typesets math instead of showing Markdown wrappers: %s', async (content, display, latex) => {
    const { container } = render(<MathEquationResponse content={content} />);

    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    expect(Boolean(container.querySelector('.katex-display'))).toBe(display);
    expect(container.querySelector('annotation')?.textContent).toBe(latex);
  });

  it('updates a partial Markdown response into formatted prose and math without duplicating content', async () => {
    const { container, rerender } = render(<MathEquationResponse content='## Sol' />);

    expect(screen.getByRole('heading').textContent).toBe('Sol');
    rerender(<MathEquationResponse content={'## Solution\n\nThe answer is **two**: $$x=2$$'} />);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(container.querySelector('strong')?.textContent).toBe('two');
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
  });

  it('keeps invalid TeX readable and recovers when the response is corrected', async () => {
    const { container, rerender } = render(<MathEquationResponse content={'$$\\invalidCommand{x}$$'} />);

    expect((await screen.findByRole('status')).textContent).toContain('Undefined control sequence');
    rerender(<MathEquationResponse content='$$x=2$$' />);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not render executable HTML or unsafe links from AI text', () => {
    const { container } = render(
      <MathEquationResponse
        content={[
          '<script>alert(1)</script>',
          '[Unsafe](javascript:alert%281%29)',
          '[Safe](https://example.com)',
          '`<img src=x onerror=alert(1)>`',
        ].join('\n\n')}
      />
    );

    expect(container.querySelector('script, img')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link').textContent).toBe('Safe');
    expect(screen.getByText('Unsafe')).toBeTruthy();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });
});
