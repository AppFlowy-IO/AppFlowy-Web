import { sanitizeDiagram, sanitizeMermaidSvg } from '../mermaid-sanitize';

describe('mermaid sanitization', () => {
  it('strips init directives instead of bypassing sanitization', () => {
    const input = '%%{init: {"securityLevel": "loose"}}%%\ngraph TD\nA-->B';

    const sanitized = sanitizeDiagram(input);

    expect(sanitized).not.toContain('%%{init');
    expect(sanitized).toContain('graph TD');
  });

  it('removes script blocks, event handlers, schemes and comments', () => {
    const input =
      'graph TD\nA-->B<script>alert(1)</script>\nC[click me](javascript:alert(1))\nD<!-- secret -->\nE[onload=x]';

    const sanitized = sanitizeDiagram(input);

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).not.toContain('<!--');
    expect(sanitized).not.toMatch(/\bon\w+\s*=/i);
  });

  it('keeps plain diagrams intact', () => {
    const input = 'graph TD\nA-->B\nB-->C';

    expect(sanitizeDiagram(input)).toBe(input);
  });

  it('sanitizes rendered svg output (no script / handlers)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><g onclick="evil()"><script>alert(1)</script>' +
      '<text>hello</text></g></svg>';

    const clean = sanitizeMermaidSvg(svg);

    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).toContain('<svg');
    expect(clean).toContain('hello');
  });
});
