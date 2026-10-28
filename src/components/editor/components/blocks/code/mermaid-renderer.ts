import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

// Mermaid has process-wide configuration. Serialize initialize + render so two
// editors (or a theme change) cannot change a render already in progress.
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

export function renderMermaid(
  source: string,
  dark: boolean,
  isCurrent: () => boolean = () => true
): Promise<string | undefined> {
  const work = queue.then(async () => {
    if (!isCurrent()) return;
    const id = `appflowy-mermaid-${++sequence}`;
    const container = document.createElement('div');

    container.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
    document.body.appendChild(container);
    try {
      const text = dark ? '#e2e4ef' : '#21232a';
      const border = dark ? '#989eb7' : '#6f748c';
      const fill = dark ? '#4c5966' : '#e6e9f0';

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        secure: [
          'securityLevel',
          'startOnLoad',
          'maxTextSize',
          'maxEdges',
          'suppressErrorRendering',
          'htmlLabels',
          'flowchart',
        ],
        htmlLabels: false,
        flowchart: { htmlLabels: false, curve: 'linear' },
        themeVariables: {
          darkMode: dark,
          background: 'transparent',
          primaryColor: fill,
          primaryTextColor: text,
          primaryBorderColor: border,
          lineColor: border,
          secondaryColor: fill,
          secondaryTextColor: text,
          secondaryBorderColor: border,
          tertiaryColor: fill,
          tertiaryTextColor: text,
          tertiaryBorderColor: border,
          textColor: text,
          mainBkg: fill,
          nodeBorder: border,
          edgeLabelBackground: fill,
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
          fontSize: '14px',
        },
      });
      const { svg } = await mermaid.render(id, source, container);

      if (!isCurrent()) return;
      return DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'script'],
      });
    } finally {
      container.remove();
    }
  });

  queue = work.catch(() => undefined);
  return work;
}
