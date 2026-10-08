import DOMPurify from 'dompurify';

/**
 * Strip mermaid directives / active content before parsing.
 *
 * Never bypass sanitization for `%%{init}%%` blocks: init directives can
 * enable click handlers and custom config, so they are removed and the
 * remainder is still filtered.
 */
export const sanitizeDiagram = (diagramText: string) => {
  return diagramText
    .replace(/%%\{init:[\s\S]*?\}%%/gi, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=/gi, '')
    .replace(/(?:javascript|data|vbscript):/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
};

/** Sanitize mermaid-rendered SVG before `dangerouslySetInnerHTML`. */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
