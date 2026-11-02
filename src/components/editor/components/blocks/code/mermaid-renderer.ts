import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

// Mermaid has process-wide configuration. Serialize initialize + render so two
// editors (or a theme change) cannot change a render already in progress.
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

// Recent renders by theme and source, so revisits and repeated copies skip the
// debounce and Mermaid. Bounded by count and by total SVG length.
const MAX_CACHED_DIAGRAMS = 32;
const MAX_CACHED_LENGTH = 4 * 1024 * 1024;
const diagrams = new Map<string, { id: string; svg: string }>();
let cachedLength = 0;

const diagramKey = (source: string, dark: boolean) => `${dark ? 'dark' : 'light'}\n${source}`;
const nextId = () => `appflowy-mermaid-${++sequence}`;

function remember(key: string, id: string, svg: string) {
  const previous = diagrams.get(key);

  if (previous) cachedLength -= previous.svg.length;
  diagrams.delete(key);
  diagrams.set(key, { id, svg });
  cachedLength += svg.length;
  // Maps iterate in insertion order: evict the least recently used first.
  for (const [oldest, diagram] of diagrams) {
    if (diagrams.size <= MAX_CACHED_DIAGRAMS && cachedLength <= MAX_CACHED_LENGTH) break;
    diagrams.delete(oldest);
    cachedLength -= diagram.svg.length;
  }
}

/**
 * A diagram rendered earlier for this theme, if any. Mermaid scopes the SVG's styles and
 * markers by its element ID, so each copy gets a fresh ID: a page can show one diagram twice.
 */
export function cachedMermaid(source: string, dark: boolean): string | undefined {
  const key = diagramKey(source, dark);
  const diagram = diagrams.get(key);

  if (!diagram) return;
  diagrams.delete(key);
  diagrams.set(key, diagram);
  return diagram.svg.replace(new RegExp(`${diagram.id}(?!\\d)`, 'g'), nextId());
}

export function renderMermaid(
  source: string,
  dark: boolean,
  isCurrent: () => boolean = () => true
): Promise<string | undefined> {
  const cached = cachedMermaid(source, dark);

  if (cached !== undefined) return Promise.resolve(isCurrent() ? cached : undefined);
  const work = queue.then(async () => {
    if (!isCurrent()) return;
    // The same diagram may have rendered while this request waited in the queue.
    const queued = cachedMermaid(source, dark);

    if (queued !== undefined) return queued;
    const id = nextId();
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
      const sanitized = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'script'],
      });

      // A superseded request still completed a valid render for its source and theme.
      remember(diagramKey(source, dark), id, sanitized);
      if (!isCurrent()) return;
      return sanitized;
    } finally {
      container.remove();
    }
  });

  queue = work.catch(() => undefined);
  return work;
}
