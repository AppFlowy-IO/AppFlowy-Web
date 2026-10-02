/* eslint-disable @typescript-eslint/no-explicit-any -- the probe runs inside the page and reads untyped DOM state. */
/**
 * The in-page half of the web visual parity probe (VISUAL-PARITY.md §3):
 * finds parity ids (`data-parity-id`, or the baseline fallback selectors
 * below), scopes them to a widget or the page, and reads raw metrics from
 * `getBoundingClientRect()` and `getComputedStyle()`. Colors stay raw CSS here;
 * `dashboard-visual-parity.ts` normalizes, resolves the expected values and
 * compares.
 *
 * `installParityProbe` is serialized into the page, so it must not reference
 * anything outside its own body.
 */
import type { Page } from '@playwright/test';

/** How a scope root is found. */
export type ScopeSpec =
  | { kind: 'page' }
  | { kind: 'widget'; widgetId: string }
  | { kind: 'widget-containing'; id?: string; pattern?: string; prefer?: string }
  | { kind: 'widget-index'; index: number }
  | { kind: 'row-index'; index: number };

export interface FallbackSpec {
  /** Elements to tag. */
  css: string;
  /** Tag `el.closest(closest)` instead of the match. */
  closest?: string;
  /** Keep only the first match inside each element matching `firstWithin`. */
  firstWithin?: string;
  /**
   * Tag the matches even where the id is attached for real: one surface draws
   * some instances itself and takes the others from a shared component.
   */
  union?: boolean;
  /** Where the id would be attached for real (report note). */
  note: string;
}

/**
 * Baseline only (§7 Baseline phase, step 2): ids whose web attach site is
 * outside the dashboard and chart components today (shared grid, tab,
 * condition and tooltip components) are found through their existing test ids
 * or classes. A real `data-parity-id` anywhere on the page always wins, and
 * every row measured through this map is marked `measure: "fallback"`.
 */
export const PARITY_FALLBACK_SELECTORS: Record<string, FallbackSpec> = {
  'dash-content-column': { css: '.database-tabs', note: 'tab row container of DatabaseTabs' },
  'dash-view-tab': { css: '.database-tabs [data-testid^="view-tab-"]', note: 'DatabaseTabItem' },
  'dash-toolbar-settings': {
    css: '[data-testid="database-actions-container"] [data-testid="database-actions-settings"]',
    note: 'DatabaseActions settings button of the dashboard page',
  },
  'dash-toolbar-open-as-page': {
    css: '[data-testid="database-actions-container"] [data-testid="database-actions-open-as-page"]',
    note: 'DatabaseActions open-as-page button of the dashboard page',
  },
  'dash-widget-tools': {
    css: '[data-testid="database-actions"][data-dashboard-widget="true"]',
    note: 'DatabaseActions root inside a widget',
  },
  'dash-widget-tool-filter': {
    css: '[data-dashboard-widget="true"] [data-testid="database-actions-filter"]',
    note: 'FiltersButton inside a widget',
  },
  'dash-widget-tool-sort': {
    css: '[data-dashboard-widget="true"] [data-testid="database-actions-sort"]',
    note: 'SortsButton inside a widget',
  },
  'dash-widget-tool-settings': {
    css: '[data-dashboard-widget="true"] [data-testid="dashboard-widget-settings-button"]',
    note: 'DatabaseActions settings button inside a widget',
  },
  'dash-widget-tool-search': {
    css: '[data-dashboard-widget="true"] [data-testid="database-actions-search"]',
    note: 'DatabaseSearchAction inside a widget',
  },
  'dash-widget-search-field': {
    css: '[data-dashboard-widget="true"] [data-testid="database-actions-search-field"]',
    note: 'DatabaseSearchAction field inside a widget',
  },
  'dash-widget-conditions-bar': {
    css: '[data-testid="dashboard-widget-body"] > div:first-child[style*="visibility"]',
    note: 'DatabaseConditionsPanel root inside a widget',
  },
  'dash-widget-grid-header': {
    css: '[data-testid="dashboard-widget-body"] [data-testid="grid-row-undefined"]:has([data-testid^="grid-field-header-"])',
    note: 'grid header row (GridVirtualRow)',
  },
  'dash-widget-grid-first-column': {
    css: '[data-testid="grid-row-undefined"]:has([data-testid^="grid-field-header-"]) .grid-row-cell',
    firstWithin: '[data-testid="grid-row-undefined"]',
    note: 'first header cell (GridVirtualColumn)',
  },
  'dash-widget-grid-header-cell__icon': {
    css: '[data-testid="dashboard-widget-body"] [data-testid^="grid-field-header-"] svg',
    note: 'field type glyph of a header cell (GridHeaderColumn)',
  },
  'dash-widget-grid-row': {
    css: '[data-testid="dashboard-widget-body"] [data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])',
    note: 'grid data row (GridVirtualRow)',
  },
  'dash-widget-grid-new-row': {
    css: '[data-testid="dashboard-widget-body"] [data-testid="grid-new-row"]',
    note: 'GridNewRow',
  },
  'dash-widget-grid-row-controls': {
    css: '[data-testid="dashboard-widget-body"] [data-testid="row-accessory-button"]',
    closest: '.justify-end',
    note: 'HoverControls root',
  },
  'dash-widget-grid-scrollbar': {
    css: '[data-testid="dashboard-widget-body"] .appflowy-custom-scroller',
    note: 'GridVirtualizer scroller',
  },
  'dash-widget-title-pill__icon': {
    css: '[data-testid="dashboard-widget-title-button"] > :first-child:not([data-testid="dashboard-widget-title"])',
    note: 'PageIcon of the title pill',
  },
  // The settings host draws its Filter, Sort and Source rows itself (real ids); the view's
  // own rows come from the shared settings components, so the two sets are measured together.
  'dash-widget-settings-row': {
    css: '[data-parity-id="dash-widget-settings"] [role="menuitem"]',
    union: true,
    note: 'settings row of a shared view settings component (Properties, Layout, Group, …)',
  },
  'dash-widget-settings-row__label': {
    css: '[data-parity-id="dash-widget-settings"] [role="menuitem"] > span:first-of-type',
    union: true,
    note: 'label of a shared view settings row',
  },
  'dash-widget-settings-row__value': {
    css: '[data-parity-id="dash-widget-settings"] [role="menuitem"] > span.ml-auto',
    union: true,
    note: 'trailing value of a shared view settings row',
  },
  'dash-widget-settings-row__chevron': {
    css: '[data-parity-id="dash-widget-settings"] [data-slot="dropdown-menu-sub-trigger"] > svg:last-child',
    union: true,
    note: 'chevron of DropdownMenuSubTrigger (a shared ui component draws it)',
  },
  'dash-tooltip': { css: '[data-slot="tooltip-content"]', note: 'TooltipContent' },
  'dash-chart-tick-label': { css: '.recharts-cartesian-axis-tick-value', note: 'Recharts axis tick text' },
  'dash-donut-ring': { css: '.recharts-pie', note: 'Recharts Pie' },
};

export interface ProbeRequest {
  key: string;
  /** The element id; with `pattern`, every id matching it. */
  id: string;
  pattern?: string;
  scope: ScopeSpec;
  relativeTo?: string;
  content?: string[];
  metrics: string[];
  deps: { id: string; metric: string }[];
  gapAxis?: 'x' | 'y';
  /** Scroll the element (or its first scrollable descendant) by this many px first. */
  scrollBy?: number;
  /** Measure only the nth visible instance in reading order (`second pill`). */
  nth?: number;
  /** Measure only instances in a selected / pressed / checked state (`selected type`). */
  selected?: boolean;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProbeInstance {
  id: string;
  /** Position among the visible instances of `id` in scope, in reading order. */
  index: number;
  box: Box;
  source: 'render' | 'fallback';
  values: Record<string, unknown>;
  notes: Record<string, string>;
  deps: Record<string, number | null>;
  iconHtml?: string | null;
}

export interface ProbeResult {
  key: string;
  widgetId: string | null;
  rowIndex: number | null;
  instances: ProbeInstance[];
  /** Visible instances of the id in scope (for `count`). */
  count: number;
  missing?: string;
}

export interface GlyphInstance {
  html: string;
  width: number;
  height: number;
  color: string | null;
  opacity: number;
  source: 'render' | 'fallback';
}

export interface ParityProbeApi {
  tagFallbacks(map: Record<string, FallbackSpec>): string[];
  resolveScope(spec: ScopeSpec): { found: boolean; widgetId: string | null; rowIndex: number | null };
  measure(requests: ProbeRequest[]): ProbeResult[];
  order(request: { container: string; scope: ScopeSpec; axis: 'x' | 'y'; family: string[] }): {
    ids: string[] | null;
    missing?: string;
    box?: Box;
    boxes?: (Box & { id: string })[];
  };
  text(request: { element: string; scope: ScopeSpec; kind: string }): { value: string | null; missing?: string; box?: Box };
  boxes(request: { ids: string[]; scope: ScopeSpec }): (Box & { id: string })[];
  tooltipText(): string | null;
  glyphs(request: { part: string; owner: string; scope: ScopeSpec }): GlyphInstance[];
  mark(request: { id: string; scope: ScopeSpec; pattern?: string }): string | null;
  environment(): Record<string, unknown>;
}

/** Installs `window.__DASH_PARITY__` (idempotent). Serialized into the page. */
export function installParityProbe() {
  const win = window as any;

  if (win.__DASH_PARITY__) return;
  const ATTR = 'data-parity-id';
  const FALLBACK = 'data-parity-fallback';
  const MARK = 'data-parity-probe-target';
  let markCounter = 0;

  const pid = (el: Element | null): string | null =>
    el ? el.getAttribute(ATTR) || el.getAttribute(FALLBACK) : null;
  const sourceOf = (el: Element): 'render' | 'fallback' => (el.getAttribute(ATTR) ? 'render' : 'fallback');
  const ownerOf = (id: string) => id.split('__')[0];
  const r2 = (value: number) => Math.round(value * 100) / 100;
  const rect = (el: Element) => el.getBoundingClientRect();
  const boxOf = (el: Element) => {
    const r = rect(el);

    return { x: r2(r.left), y: r2(r.top), width: r2(r.width), height: r2(r.height) };
  };
  const isSelected = (el: Element) =>
    ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current'].some((name) => {
      const value = el.getAttribute(name);

      return value !== null && value !== 'false';
    }) ||
    el.getAttribute('data-selected') === 'true' ||
    ['on', 'checked', 'active'].includes(el.getAttribute('data-state') ?? '');
  const style = (el: Element) => getComputedStyle(el);
  const isVisible = (el: Element) => {
    if (!el.isConnected || el.getClientRects().length === 0) return false;
    const computed = style(el);

    return computed.visibility !== 'hidden' && computed.display !== 'none';
  };
  const readingOrder = (a: Element, b: Element) => {
    const ra = rect(a);
    const rb = rect(b);

    return Math.abs(ra.top - rb.top) > 1 ? ra.top - rb.top : ra.left - rb.left;
  };
  const selector = (id: string) => `[${ATTR}="${id}"],[${FALLBACK}="${id}"]`;
  const px = (value: string) => {
    const number = parseFloat(value);

    return Number.isFinite(number) ? r2(number) : null;
  };

  function tagFallbacks(map: Record<string, any>): string[] {
    document.querySelectorAll(`[${FALLBACK}]`).forEach((el) => el.removeAttribute(FALLBACK));
    const tagged: string[] = [];

    Object.entries(map).forEach(([id, spec]) => {
      let matches: Element[] = [];

      try {
        matches = Array.from(document.querySelectorAll(spec.css));
      } catch {
        return;
      }

      if (spec.closest) matches = matches.map((el) => el.closest(spec.closest)).filter(Boolean) as Element[];
      if (spec.firstWithin) {
        const seen = new Set<Element>();

        matches = matches.filter((el) => {
          const container = el.closest(spec.firstWithin);

          if (!container || seen.has(container)) return false;
          seen.add(container);
          return true;
        });
      }

      // A real attach of the id wins, per scope: skip matches that sit in a
      // widget (or the page) where the id is attached for real.
      const realScopes = Array.from(document.querySelectorAll(`[${ATTR}="${id}"]`)).map(
        (el) => el.closest('[data-testid="dashboard-widget"]') ?? document.documentElement
      );

      new Set(matches).forEach((el) => {
        if (el.hasAttribute(ATTR) || el.hasAttribute(FALLBACK)) return;
        const scope = el.closest('[data-testid="dashboard-widget"]') ?? document.documentElement;

        if (!spec.union && realScopes.includes(scope)) return;
        el.setAttribute(FALLBACK, id);
        tagged.push(id);
      });
    });
    return [...new Set(tagged)];
  }

  function widgetBoxes(): Element[] {
    return Array.from(document.querySelectorAll(`${selector('dash-widget-box')},[data-testid="dashboard-widget"]`))
      .filter((el, index, all) => all.indexOf(el) === index)
      .filter(isVisible)
      .sort(readingOrder);
  }

  function rows(): Element[] {
    return Array.from(document.querySelectorAll(`${selector('dash-row')},[data-testid="dashboard-row"]`))
      .filter((el, index, all) => all.indexOf(el) === index)
      .filter(isVisible)
      .sort(readingOrder);
  }

  function matchesId(el: Element, id: string | undefined, pattern: RegExp | null) {
    const value = pid(el);

    if (!value) return false;
    return pattern ? pattern.test(value) : value === id;
  }

  function within(root: Element, id: string | undefined, pattern: RegExp | null): Element[] {
    const found: Element[] = [];

    if (root !== document.documentElement && matchesId(root, id, pattern)) found.push(root);
    const query = pattern || !id ? `[${ATTR}],[${FALLBACK}]` : selector(id);

    root.querySelectorAll(query).forEach((el) => {
      if (matchesId(el, id, pattern)) found.push(el);
    });
    return found;
  }

  function resolveScopeRoot(spec: any): { root: Element | null; widgetId: string | null; rowIndex: number | null } {
    if (spec.kind === 'page') return { root: document.documentElement, widgetId: null, rowIndex: null };
    if (spec.kind === 'widget') {
      const box = document.querySelector(`[data-testid="dashboard-widget"][data-widget-id="${spec.widgetId}"]`);

      return { root: box, widgetId: box ? spec.widgetId : null, rowIndex: null };
    }

    if (spec.kind === 'widget-index') {
      const box = widgetBoxes()[spec.index] ?? null;

      return { root: box, widgetId: box?.getAttribute('data-widget-id') ?? null, rowIndex: null };
    }

    if (spec.kind === 'row-index') {
      const row = rows()[spec.index] ?? null;

      return { root: row, widgetId: null, rowIndex: row ? spec.index : null };
    }

    const pattern = spec.pattern ? new RegExp(spec.pattern) : null;
    const candidates = widgetBoxes();
    const preferred = spec.prefer
      ? candidates.find((candidate) => candidate.getAttribute('data-widget-id') === spec.prefer)
      : undefined;
    const contains = (candidate: Element) => (!spec.id && !pattern ? true : within(candidate, spec.id, pattern).length > 0);
    // No widget holds the id: measure in the preferred (or first) widget, so the id is
    // reported missing there and `count` is 0 rather than "scope not found".
    const box = (preferred && contains(preferred) ? preferred : candidates.find(contains)) ?? preferred ?? candidates[0] ?? null;

    return { root: box, widgetId: box?.getAttribute('data-widget-id') ?? null, rowIndex: null };
  }

  function nearestParityAncestor(el: Element): Element | null {
    let node = el.parentElement;

    while (node) {
      if (pid(node)) return node;
      node = node.parentElement;
    }

    return null;
  }

  /** The parity element a node belongs to: its own id's owner element when it is a part. */
  function parityOwner(el: Element): Element | null {
    const id = pid(el);

    if (id && id.includes('__')) {
      let node = el.parentElement;

      while (node) {
        if (pid(node) === ownerOf(id)) return node;
        node = node.parentElement;
      }
    }

    return el;
  }

  /** The parity element that owns `node` for glyph counts: nearest parity ancestor-or-self, parts folded into owners. */
  function owningElement(node: Element): Element | null {
    let current: Element | null = node;

    while (current && !pid(current)) current = current.parentElement;
    return current ? parityOwner(current) : null;
  }

  function parityChildren(container: Element, includeParts: boolean): Element[] {
    const result: Element[] = [];

    container.querySelectorAll(`[${ATTR}],[${FALLBACK}]`).forEach((el) => {
      if (nearestParityAncestor(el) !== container) return;
      if (!includeParts && (pid(el) ?? '').includes('__')) return;
      if (!isVisible(el)) return;
      result.push(el);
    });
    return result;
  }

  function findRelative(id: string, el: Element, root: Element): Element | null {
    let node = el.parentElement;

    while (node) {
      if (pid(node) === id) return node;
      node = node.parentElement;
    }

    const inScope = within(root, id, null).filter(isVisible).sort(readingOrder);

    if (inScope.length > 0) return inScope[0];
    return within(document.documentElement, id, null).filter(isVisible).sort(readingOrder)[0] ?? null;
  }

  function parts(el: Element, id: string): Element[] {
    return Array.from(el.querySelectorAll(`[${ATTR}^="${id}__"],[${FALLBACK}^="${id}__"]`)).filter(isVisible);
  }

  function unionRect(elements: Element[]) {
    const rects = elements.map(rect);

    return {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  }

  function opacityChain(el: Element): number {
    let value = 1;
    let node: Element | null = el;

    while (node) {
      const opacity = parseFloat(style(node).opacity);

      if (Number.isFinite(opacity)) value *= opacity;
      node = node.parentElement;
    }

    return r2(value);
  }

  function splitTopLevel(value: string): string[] {
    const items: string[] = [];
    let depth = 0;
    let current = '';

    for (const char of value) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === ',' && depth === 0) {
        items.push(current.trim());
        current = '';
      } else current += char;
    }

    if (current.trim()) items.push(current.trim());
    return items;
  }

  function parseShadows(value: string) {
    if (!value || value === 'none') return [];
    return splitTopLevel(value).map((item) => {
      const inset = /\binset\b/.test(item);
      const colorMatch = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]{3,8}|transparent)/.exec(item);
      const lengths = item
        .replace(colorMatch ? colorMatch[0] : '', '')
        .replace(/\binset\b/, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => parseFloat(part));

      return {
        x: lengths[0] ?? 0,
        y: lengths[1] ?? 0,
        blur: lengths[2] ?? 0,
        spread: lengths[3] ?? 0,
        color: colorMatch ? colorMatch[0] : 'currentcolor',
        inset,
      };
    });
  }

  const isRingShadow = (shadow: any) => shadow.x === 0 && shadow.y === 0 && shadow.blur === 0 && shadow.spread !== 0;
  // A shadow that paints nothing is no shadow (§3.2): the dark card keeps
  // `0 0 0 0 transparent` only so `var(--dash-card-shadow), <ring>` stays valid.
  const paintsNothing = (shadow: any) =>
    /^(transparent|rgba\([^)]*,\s*0\)|rgba\([^)]*\/\s*0\))$/.test(shadow.color.replace(/\s+/g, ' ').trim()) ||
    (shadow.x === 0 && shadow.y === 0 && shadow.blur === 0 && shadow.spread === 0);

  /** The corner radius of a Recharts bar: its `<path>` draws each rounded corner as an arc `A r,r`. */
  function svgCorners(el: Element) {
    if (el instanceof SVGRectElement) {
      const r = px(style(el).getPropertyValue('rx')) ?? 0;

      return { tl: r, tr: r, br: r, bl: r };
    }

    const d = el.getAttribute('d');

    if (!(el instanceof SVGPathElement) || !d) return null;
    const box = rect(el);
    const origin = (el.ownerSVGElement ?? el).getBoundingClientRect();
    const corner = { tl: 0, tr: 0, br: 0, bl: 0 };
    const arcs = d.matchAll(/A\s*([\d.]+)[\s,]+([\d.]+)[\s,]+[\d.]+[\s,]+[01][\s,]*[01][\s,]*(-?[\d.]+)[\s,]+(-?[\d.]+)/g);

    for (const arc of arcs) {
      // An arc ends on an edge of the bar box, within its radius of the corner it rounds.
      const x = Number(arc[3]) + origin.left;
      const y = Number(arc[4]) + origin.top;
      const top = Math.abs(y - box.top) <= Math.abs(y - box.bottom);
      const left = Math.abs(x - box.left) <= Math.abs(x - box.right);

      corner[`${top ? 't' : 'b'}${left ? 'l' : 'r'}` as keyof typeof corner] = Number(arc[1]);
    }

    return corner;
  }

  function corners(el: Element) {
    const svg = el instanceof SVGGeometryElement ? svgCorners(el) : null;

    if (svg) return svg;
    const computed = style(el);
    const box = rect(el);
    // A "full" radius (`rounded-full` is 9999px) is half the shorter side; a
    // token radius is reported as written, even when the box is shorter.
    const used = (value: string) => {
      const radius = px(value);

      if (radius === null || radius <= Math.max(box.width, box.height)) return radius;
      return r2(Math.min(box.width, box.height) / 2);
    };

    return {
      tl: used(computed.borderTopLeftRadius),
      tr: used(computed.borderTopRightRadius),
      br: used(computed.borderBottomRightRadius),
      bl: used(computed.borderBottomLeftRadius),
    };
  }

  function borders(el: Element) {
    const computed = style(el);
    const side = (name: string) => ({
      width: computed.getPropertyValue(`border-${name}-style`) === 'none' ? 0 : px(computed.getPropertyValue(`border-${name}-width`)) ?? 0,
      color: computed.getPropertyValue(`border-${name}-color`),
    });

    return { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
  }

  function uniform<T>(values: T[]): T | { values: T[] } {
    return values.every((value) => JSON.stringify(value) === JSON.stringify(values[0])) ? values[0] : { values };
  }

  function lineHeightOf(el: Element): number | null {
    const computed = style(el);

    if (computed.lineHeight !== 'normal') return px(computed.lineHeight);
    const probe = document.createElement('span');

    probe.textContent = 'Hg';
    probe.style.cssText = `position:absolute;visibility:hidden;display:block;white-space:nowrap;line-height:normal;font:${computed.font};`;
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;

    probe.remove();
    return r2(height);
  }

  function textOf(el: Element): string {
    const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';

    return raw.replace(/\s+/g, ' ').trim();
  }

  function accessibleName(el: Element): string {
    const labelledBy = el.getAttribute('aria-labelledby');

    if (labelledBy) {
      return labelledBy
        .split(/\s+/)
        .map((ref) => (document.getElementById(ref) ? textOf(document.getElementById(ref) as Element) : ''))
        .join(' ')
        .trim();
    }

    const label = el.getAttribute('aria-label');

    if (label) return label.trim();
    const role = el.getAttribute('role');

    if (['BUTTON', 'A'].includes(el.tagName) || ['button', 'menuitem', 'link', 'tab'].includes(role ?? '')) {
      const text = textOf(el);

      if (text) return text;
    }

    return (el.getAttribute('title') ?? '').trim();
  }

  function glyphOf(el: Element, id: string): Element | null {
    const part = el.querySelector(`[${ATTR}="${id}__icon"],[${FALLBACK}="${id}__icon"]`);

    if (part) return part.tagName.toLowerCase() === 'svg' ? part : part.querySelector('svg') ?? part;
    if (el.tagName.toLowerCase() === 'svg') return el;
    const own = Array.from(el.querySelectorAll('svg')).find(
      (svg) => isVisible(svg) && owningElement(svg) === el && !svg.parentElement?.closest('svg')
    );

    return own ?? null;
  }

  function paintOf(svg: Element): string | null {
    const shapes = svg.matches('path,rect,circle,line,polyline,polygon,ellipse')
      ? [svg]
      : Array.from(svg.querySelectorAll('path,rect,circle,line,polyline,polygon,ellipse'));

    for (const shape of shapes) {
      const computed = style(shape);

      if (computed.stroke && computed.stroke !== 'none') return computed.stroke;
      if (computed.fill && computed.fill !== 'none') return computed.fill;
    }

    return style(svg).color || null;
  }

  function scrollerOf(el: Element): Element {
    const candidates = [el, ...Array.from(el.querySelectorAll('*'))];

    return (
      candidates.find((node) => {
        const computed = style(node);

        return /(auto|scroll)/.test(computed.overflowY + computed.overflowX) && (node as HTMLElement).scrollHeight > (node as HTMLElement).clientHeight + 1;
      }) ?? el
    );
  }

  function measureMetric(
    name: string,
    el: Element,
    id: string,
    ctx: { root: Element; relativeTo?: string; content?: string[]; gapAxis?: 'x' | 'y'; instances: Element[] }
  ): { value: unknown; note?: string } {
    const box = rect(el);
    const computed = style(el);
    const reference = () => (ctx.relativeTo ? findRelative(ctx.relativeTo, el, ctx.root) : null);

    switch (name) {
      case 'width':
        return { value: r2(box.width) };
      case 'height':
        return { value: r2(box.height) };
      case 'widthMin':
      case 'widthMax':
        return { value: r2(box.width) };
      case 'maxWidth':
        return computed.maxWidth === 'none' ? { value: null, note: 'max-width: none' } : { value: px(computed.maxWidth) };
      case 'left':
      case 'right':
      case 'top':
      case 'bottom':
      case 'centerX':
      case 'centerY':
      case 'centerXFromLeft':
      case 'centerXFromRight': {
        const ref = reference();

        if (!ref) return { value: null, note: ctx.relativeTo ? `no ${ctx.relativeTo} reference box` : 'no relativeTo' };
        const r = rect(ref);
        const values: Record<string, number> = {
          left: box.left - r.left,
          right: r.right - box.right,
          top: box.top - r.top,
          bottom: r.bottom - box.bottom,
          centerX: box.left + box.width / 2 - (r.left + r.width / 2),
          centerY: box.top + box.height / 2 - (r.top + r.height / 2),
          centerXFromLeft: box.left + box.width / 2 - r.left,
          centerXFromRight: box.left + box.width / 2 - r.right,
        };

        return { value: r2(values[name]) };
      }

      case 'paddingTop':
      case 'paddingRight':
      case 'paddingBottom':
      case 'paddingLeft': {
        const content = ctx.content
          ? ctx.content.flatMap((contentId) => within(el, contentId, null).filter(isVisible))
          : parts(el, id);

        if (content.length === 0) return { value: null, note: ctx.content ? 'no content boxes' : 'no __parts' };
        const union = unionRect(content);
        const values: Record<string, number> = {
          paddingTop: union.top - box.top,
          paddingRight: box.right - union.right,
          paddingBottom: box.bottom - union.bottom,
          paddingLeft: union.left - box.left,
        };

        return { value: r2(values[name]) };
      }

      case 'gapToNext': {
        const axis = ctx.gapAxis ?? 'x';
        const parent = nearestParityAncestor(el);
        const siblings = (parent ? parityChildren(parent, id.includes('__')) : ctx.instances).filter(
          (candidate) => candidate !== el
        );
        const start = (r: DOMRect) => (axis === 'x' ? r.left : r.top);
        const end = (r: DOMRect) => (axis === 'x' ? r.right : r.bottom);
        const isAfter = (candidate: Element) => start(rect(candidate)) > start(box) + 0.5;
        const after = siblings.filter(isAfter);
        const sameId = after.filter((candidate) => pid(candidate) === id);
        let pool = sameId.length > 0 ? sameId : after;

        if (pool.length === 0) {
          // No sibling follows (a card is alone in its widget box): the next
          // instance of the same id on the page that overlaps it across the axis.
          const overlaps = (r: DOMRect) =>
            axis === 'x' ? r.top < box.bottom && r.bottom > box.top : r.left < box.right && r.right > box.left;

          pool = within(document.documentElement, id, null).filter(
            (candidate) => candidate !== el && isVisible(candidate) && isAfter(candidate) && overlaps(rect(candidate))
          );
        }

        pool.sort((a, b) => start(rect(a)) - start(rect(b)));
        if (pool.length === 0) return { value: null, note: 'no next parity sibling' };
        return { value: r2(start(rect(pool[0])) - end(box)) };
      }

      case 'childGap': {
        const children = parityChildren(el, true);

        if (children.length < 2) return { value: null, note: `${children.length} parity child(ren)` };
        const axis = computed.flexDirection.startsWith('column') ? 'y' : 'x';
        const sorted = children.sort((a, b) => (axis === 'x' ? rect(a).left - rect(b).left : rect(a).top - rect(b).top));
        const gaps: number[] = [];

        for (let index = 1; index < sorted.length; index += 1) {
          const previous = rect(sorted[index - 1]);
          const next = rect(sorted[index]);

          gaps.push(r2(axis === 'x' ? next.left - previous.right : next.top - previous.bottom));
        }

        return { value: gaps };
      }

      case 'pitch': {
        const sameId = ctx.instances.filter((candidate) => pid(candidate) === pid(el)).sort(readingOrder);
        const index = sameId.indexOf(el);

        if (index === -1 || index === sameId.length - 1) return { value: null, note: 'last instance' };
        return { value: r2(rect(sameId[index + 1]).top - box.top) };
      }

      case 'iconCount': {
        const own = Array.from(el.querySelectorAll('svg')).filter(
          (svg) => isVisible(svg) && !svg.parentElement?.closest('svg') && owningElement(svg) === el
        );

        return { value: own.length + (el.tagName.toLowerCase() === 'svg' ? 1 : 0) };
      }

      case 'buttonCount': {
        const buttons = [el, ...Array.from(el.querySelectorAll('*'))].filter(
          (node) => node.matches('button,[role="button"]') && isVisible(node)
        );

        return { value: buttons.filter((node) => !buttons.some((other) => other !== node && other.contains(node))).length };
      }

      case 'checkboxCount':
        return {
          value: Array.from(el.querySelectorAll('input[type="checkbox"],[role="checkbox"]')).filter(isVisible).length,
        };
      case 'badgeCount':
        return { value: parts(el, id).filter((part) => (pid(part) ?? '').endsWith('__badge')).length };
      case 'cursor': {
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);

        return { value: hit && el.contains(hit) ? style(hit).cursor : computed.cursor };
      }

      case 'borderRadius': {
        const c = corners(el);

        return { value: uniform([c.tl, c.tr, c.br, c.bl]) };
      }

      case 'borderRadiusTop': {
        const c = corners(el);

        return { value: uniform([c.tl, c.tr]) };
      }

      case 'borderWidth': {
        const b = borders(el);

        return { value: uniform([b.top.width, b.right.width, b.bottom.width, b.left.width]) };
      }

      case 'borderBottomWidth':
        return { value: borders(el).bottom.width };
      case 'borderColor': {
        const b = borders(el);
        const sides = [b.top, b.right, b.bottom, b.left].filter((sideValue) => sideValue.width > 0);

        if (sides.length === 0) return { value: null, note: 'no border' };
        return { value: uniform(sides.map((sideValue) => sideValue.color)) };
      }

      case 'ringWidth':
      case 'ringColor': {
        const shadows = parseShadows(computed.boxShadow).filter(isRingShadow);
        const ring = shadows.find((shadow) => !shadow.inset) ?? shadows.find((shadow) => shadow.inset);

        if (ring) return { value: name === 'ringWidth' ? Math.abs(ring.spread) : ring.color };
        const b = borders(el);
        const widths = [b.top.width, b.right.width, b.bottom.width, b.left.width];

        if (widths.every((width) => width > 0 && width === widths[0])) {
          return { value: name === 'ringWidth' ? widths[0] : b.top.color, note: 'drawn as a border' };
        }

        return name === 'ringWidth' ? { value: 0 } : { value: null, note: 'no ring' };
      }

      case 'outlineWidth':
      case 'outlineColor':
      case 'outlineRadius': {
        const inset = parseShadows(computed.boxShadow).find((shadow) => shadow.inset && isRingShadow(shadow));

        if (inset) {
          if (name === 'outlineWidth') return { value: Math.abs(inset.spread) };
          if (name === 'outlineColor') return { value: inset.color };
          return { value: corners(el).tl };
        }

        if (computed.outlineStyle !== 'none' && (px(computed.outlineWidth) ?? 0) > 0) {
          if (name === 'outlineWidth') return { value: px(computed.outlineWidth) };
          if (name === 'outlineColor') return { value: computed.outlineColor };
          return { value: corners(el).tl };
        }

        return name === 'outlineWidth' ? { value: 0 } : { value: null, note: 'no outline' };
      }

      case 'background':
        return { value: computed.backgroundColor };
      case 'shadow':
        return {
          value: parseShadows(computed.boxShadow)
            .filter((shadow) => !isRingShadow(shadow) && !paintsNothing(shadow))
            .map(({ x, y, blur, spread, color }) => ({ x, y, blur, spread, color })),
        };
      case 'opacity':
        return { value: opacityChain(el) };
      case 'transitionMs': {
        const durations = computed.transitionDuration
          .split(',')
          .map((part) => part.trim())
          .map((part) => (part.endsWith('ms') ? parseFloat(part) : parseFloat(part) * 1000))
          .filter((number) => Number.isFinite(number));

        return { value: durations.length ? Math.max(...durations) : 0 };
      }

      case 'strokeColor':
      case 'strokeWidth':
      case 'dashArray': {
        const shape = el.matches('line,path,rect,polyline,polygon,circle,ellipse')
          ? el
          : el.querySelector('line,path,rect,polyline,polygon,circle,ellipse');

        if (!shape) return { value: null, note: 'no SVG shape' };
        const shapeStyle = style(shape);

        if (name === 'strokeColor') return { value: shapeStyle.stroke };
        if (name === 'strokeWidth') return { value: px(shapeStyle.strokeWidth) };
        const dash = shapeStyle.strokeDasharray;

        return {
          value:
            !dash || dash === 'none'
              ? []
              : dash
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .map((part) => parseFloat(part)),
        };
      }

      case 'fontSize':
        return { value: px(computed.fontSize) };
      case 'lineHeight':
        return { value: lineHeightOf(el) };
      case 'fontWeight':
        return { value: Number(computed.fontWeight) };
      case 'color':
        return { value: computed.color };
      case 'textOverflow':
        return {
          value:
            computed.textOverflow === 'ellipsis' && computed.overflowX === 'hidden' && computed.whiteSpace.includes('nowrap')
              ? 'ellipsis'
              : 'clip',
        };
      case 'tabularNums':
        return {
          value: computed.fontVariantNumeric.includes('tabular-nums') || computed.fontFeatureSettings.includes('tnum'),
        };
      case 'text':
        return { value: textOf(el) };
      case 'placeholder': {
        const input = el.matches('input,textarea') ? el : el.querySelector('input,textarea');

        return input ? { value: (input as HTMLInputElement).placeholder } : { value: null, note: 'no input' };
      }

      case 'accessibleName':
        return { value: accessibleName(el) };
      case 'icon': {
        const glyph = glyphOf(el, id);

        return glyph ? { value: glyph.outerHTML } : { value: null, note: 'no SVG glyph' };
      }

      case 'iconSize': {
        const glyph = glyphOf(el, id);

        if (!glyph) return { value: null, note: 'no SVG glyph' };
        const r = rect(glyph);

        return { value: Math.abs(r.width - r.height) <= 0.5 ? r2(r.width) : `${r2(r.width)}x${r2(r.height)}` };
      }

      case 'iconColor':
      case 'effectiveIconColor': {
        const glyph = glyphOf(el, id);

        if (!glyph) return { value: null, note: 'no SVG glyph' };
        const paint = paintOf(glyph);

        return { value: name === 'iconColor' ? paint : { color: paint, opacity: opacityChain(glyph) } };
      }

      case 'scrollbarVisible':
      case 'thumbThicknessMax':
      case 'thumbInset':
      case 'trackVisible': {
        const scroller = scrollerOf(el) as HTMLElement;
        const b = borders(scroller);
        const classic = Math.max(
          scroller.offsetWidth - scroller.clientWidth - b.left.width - b.right.width,
          scroller.offsetHeight - scroller.clientHeight - b.top.width - b.bottom.width
        );

        // Headless Chromium runs with --hide-scrollbars (Playwright's default): no gutter and no
        // painted thumb, so only a classic scrollbar is observable here (VISUAL-PARITY.md §6.3).
        const hidden =
          'no scrollbar gutter: this browser paints no classic scrollbar (headless Chromium runs with --hide-scrollbars) and an overlay thumb is not observable from the DOM';

        if (name === 'scrollbarVisible') return classic > 0 ? { value: true, note: 'classic scrollbar' } : { value: null, note: hidden };
        if (name === 'thumbThicknessMax') return classic > 0 ? { value: classic } : { value: null, note: hidden };
        return { value: null, note: classic > 0 ? 'thumb inset and track paint are not observable from the DOM' : hidden };
      }

      default:
        return { value: null, note: `metric "${name}" is not implemented by the web probe` };
    }
  }

  function boxMetric(el: Element, metric: string): number | null {
    const box = rect(el);
    const computed = style(el);

    if (metric === 'width') return r2(box.width);
    if (metric === 'height') return r2(box.height);
    if (metric === 'fontSize') return px(computed.fontSize);
    if (metric === 'lineHeight') return lineHeightOf(el);
    return null;
  }

  function measure(requests: any[]) {
    return requests.map((request) => {
      const scope = resolveScopeRoot(request.scope);
      const base = { key: request.key, widgetId: scope.widgetId, rowIndex: scope.rowIndex };

      if (!scope.root) return { ...base, instances: [], count: 0, missing: 'scope not found' };
      const pattern = request.pattern ? new RegExp(request.pattern) : null;
      const all = within(scope.root, request.id, pattern);
      const visible = all.filter(isVisible).sort(readingOrder);
      const count = visible.length;

      if (request.scrollBy) {
        const target = visible[0] ?? (scope.root as Element);

        scrollerOf(target).scrollBy({ top: request.scrollBy });
      }

      let pool = visible;

      if (request.selected) pool = pool.filter(isSelected);
      if (typeof request.nth === 'number') pool = pool.slice(request.nth, request.nth + 1);
      const targets = pattern ? pool : pool.slice(0, 1);

      if (targets.length === 0) {
        const why =
          all.length === 0
            ? 'no element with this id in scope'
            : visible.length === 0
            ? 'only hidden instances'
            : request.selected
            ? 'no selected instance'
            : `only ${visible.length} visible instance(s)`;

        return { ...base, instances: [], count, missing: why };
      }

      const instances = targets.map((el) => {
        const id = pid(el) as string;
        const index = visible.filter((candidate) => pid(candidate) === id).indexOf(el);
        const values: Record<string, unknown> = {};
        const notes: Record<string, string> = {};

        request.metrics.forEach((metric: string) => {
          const result = measureMetric(metric, el, id, {
            root: scope.root as Element,
            relativeTo: request.relativeTo,
            content: request.content,
            gapAxis: request.gapAxis,
            instances: visible,
          });

          values[metric] = result.value;
          if (result.note) notes[metric] = result.note;
        });

        const deps: Record<string, number | null> = {};

        request.deps.forEach((dep: { id: string; metric: string }) => {
          const target = dep.id === 'self' ? el : findRelative(dep.id, el, scope.root as Element);

          deps[`${dep.id}.${dep.metric}`] = target ? boxMetric(target, dep.metric) : null;
        });
        return { id, index, box: boxOf(el), source: sourceOf(el), values, notes, deps };
      });

      return { ...base, instances, count };
    });
  }

  function order(request: any) {
    const scope = resolveScopeRoot(request.scope);

    if (!scope.root) return { ids: null, missing: 'scope not found' };
    const container = within(scope.root, request.container, null).filter(isVisible).sort(readingOrder)[0];

    if (!container) return { ids: null, missing: `no ${request.container} in scope` };
    const family = new Set<string>(request.family);
    const axis = request.axis;
    const children = parityChildren(container, false)
      .filter((el) => family.has(pid(el) as string))
      .sort((a, b) => {
        const ra = rect(a);
        const rb = rect(b);
        const primary = axis === 'x' ? ra.left - rb.left : ra.top - rb.top;

        if (Math.abs(primary) > 0.5) return primary;
        return axis === 'x' ? ra.top - rb.top : ra.left - rb.left;
      });

    return {
      ids: children.map((el) => pid(el) as string),
      box: boxOf(container),
      boxes: children.map((el) => ({ id: pid(el) as string, ...boxOf(el) })),
    };
  }

  function text(request: any) {
    const scope = resolveScopeRoot(request.scope);

    if (!scope.root) return { value: null, missing: 'scope not found' };
    const el = within(scope.root, request.element, null).filter(isVisible).sort(readingOrder)[0];

    if (!el) return { value: null, missing: `no ${request.element} in scope` };
    const box = boxOf(el);

    if (request.kind === 'placeholder') {
      const input = el.matches('input,textarea') ? el : el.querySelector('input,textarea');

      return { value: input ? (input as HTMLInputElement).placeholder : null, missing: input ? undefined : 'no input', box };
    }

    if (request.kind === 'accessibleName') return { value: accessibleName(el), box };
    return { value: textOf(el), box };
  }

  /** The first visible instance of each id in scope (reference boxes and calc inputs for the review page). */
  function boxes(request: any) {
    const scope = resolveScopeRoot(request.scope);

    if (!scope.root) return [];
    return (request.ids as string[]).flatMap((id) => {
      const el = within(scope.root as Element, id, null).filter(isVisible).sort(readingOrder)[0];

      return el ? [{ id, ...boxOf(el) }] : [];
    });
  }

  function tooltipText() {
    const tips = Array.from(document.querySelectorAll('[data-slot="tooltip-content"],[role="tooltip"]')).filter(isVisible);

    return tips.length ? textOf(tips[tips.length - 1]) : null;
  }

  function glyphs(request: any) {
    const scope = resolveScopeRoot(request.scope);

    if (!scope.root) return [];
    let hosts = within(scope.root, request.part, null).filter(isVisible);
    let viaOwner = false;

    if (hosts.length === 0) {
      hosts = within(scope.root, request.owner, null).filter(isVisible);
      viaOwner = true;
    }

    return hosts
      .map((host) => {
        const glyph = viaOwner
          ? glyphOf(host, request.owner)
          : host.tagName.toLowerCase() === 'svg'
          ? host
          : host.querySelector('svg');

        if (!glyph) return null;
        const r = rect(glyph);

        return {
          html: glyph.outerHTML,
          width: r2(r.width),
          height: r2(r.height),
          color: paintOf(glyph),
          opacity: opacityChain(glyph),
          source: sourceOf(host),
        };
      })
      .filter(Boolean);
  }

  function mark(request: any) {
    const scope = resolveScopeRoot(request.scope);

    if (!scope.root) return null;
    const pattern = request.pattern ? new RegExp(request.pattern) : null;
    const el = within(scope.root, request.id, pattern).filter(isVisible).sort(readingOrder)[0];

    if (!el) return null;
    markCounter += 1;
    const token = `t${markCounter}`;

    el.setAttribute(MARK, token);
    return token;
  }

  function environment() {
    const probe = document.createElement('div');

    probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;';
    document.body.appendChild(probe);
    const gutter = probe.offsetWidth - probe.clientWidth;

    probe.remove();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      darkMode: document.documentElement.getAttribute('data-dark-mode'),
      classicScrollbarGutter: gutter,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      userAgent: navigator.userAgent,
    };
  }

  win.__DASH_PARITY__ = {
    tagFallbacks,
    resolveScope: (spec: any) => {
      const scope = resolveScopeRoot(spec);

      return { found: Boolean(scope.root), widgetId: scope.widgetId, rowIndex: scope.rowIndex };
    },
    measure,
    order,
    text,
    boxes,
    tooltipText,
    glyphs,
    mark,
    environment,
  };
}

/** Install the probe (after every navigation) and tag the fallback ids. */
export async function prepareParityProbe(page: Page): Promise<string[]> {
  await page.evaluate(installParityProbe);
  return page.evaluate(
    (map) => (window as any).__DASH_PARITY__.tagFallbacks(map) as string[],
    PARITY_FALLBACK_SELECTORS
  );
}

export async function callParityProbe<K extends keyof ParityProbeApi>(
  page: Page,
  method: K,
  ...args: Parameters<ParityProbeApi[K]>
): Promise<ReturnType<ParityProbeApi[K]>> {
  return page.evaluate(
    ({ method, args }) => {
      const api = (window as any).__DASH_PARITY__;

      return api[method](...args);
    },
    { method, args: args as unknown[] }
  ) as Promise<ReturnType<ParityProbeApi[K]>>;
}
