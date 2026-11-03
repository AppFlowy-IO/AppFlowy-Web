import { createContext, useContext, useSyncExternalStore } from 'react';

import type { TextMeasurer } from '@/application/database-yjs/chart-scale';

/** Text measurers for the chart font: 12px (ticks, data labels, legend) and 10px (donut labels). */
export interface ChartMeasure {
  measure12: TextMeasurer;
  measure10: TextMeasurer;
}

/**
 * Cached widths per font size. One chart measures its category labels, data
 * labels, ticks and truncation probes, and a dashboard holds up to 12 charts
 * that are laid out again together on a resize, so the limit covers a full
 * dashboard of charts with a few hundred categories each. The 500 entries this
 * replaced were cycled through by a single 250-category chart.
 */
const CACHE_LIMIT = 4000;

/** Width of a character at 12px where there is no canvas (jsdom, SSR). */
const FALLBACK_CHAR_WIDTH = 6.5;

// jsdom has no canvas metrics. Checked once: `measureChartText` runs for every label.
const IS_JSDOM = typeof navigator !== 'undefined' && /jsdom/.test(navigator.userAgent);

const caches = new Map<number, Map<string, number>>();
let canvas: CanvasRenderingContext2D | null | undefined;
/** The font size the canvas is set to, so `font` is assigned only when it changes. */
let canvasFontSize: number | null = null;
/** The body font, resolved on the first measurement and again after fonts load. */
let fontFamily: string | null = null;
let watchingFonts = false;

function canvasContext() {
  if (canvas === undefined) {
    canvas = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }

  return canvas;
}

function resolveFontFamily() {
  if (fontFamily === null) {
    fontFamily =
      typeof document === 'undefined' || !document.body
        ? 'sans-serif'
        : getComputedStyle(document.body).fontFamily || 'sans-serif';
  }

  return fontFamily;
}

function fallbackWidth(text: string, fontSize: number) {
  return Array.from(text).length * FALLBACK_CHAR_WIDTH * (fontSize / 12);
}

/**
 * Canvas `measureText` with the body font at `fontSize`, behind a cache.
 * Without canvas metrics (jsdom) a character is 6.5px at 12px; tests that
 * assert layout inject their own measurer through `ChartMeasureContext`.
 */
export function measureChartText(text: string, fontSize: number): number {
  if (IS_JSDOM) return fallbackWidth(text, fontSize);
  let cache = caches.get(fontSize);

  if (!cache) {
    cache = new Map();
    caches.set(fontSize, cache);
  }

  const cached = cache.get(text);

  if (cached !== undefined) return cached;
  const ctx = canvasContext();

  if (!ctx) return fallbackWidth(text, fontSize);
  watchFonts();
  if (canvasFontSize !== fontSize) {
    ctx.font = `400 ${fontSize}px ${resolveFontFamily()}`;
    canvasFontSize = fontSize;
  }

  const width = ctx.measureText(text).width;

  // Oldest first out. A hit does not reorder: at this limit an eviction is
  // rare, and a hit stays a single lookup.
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(text, width);
  return width;
}

function createMeasure(): ChartMeasure {
  return {
    measure12: (text) => measureChartText(text, 12),
    measure10: (text) => measureChartText(text, 10),
  };
}

// The measurers are replaced, not just emptied, when the metrics change: chart
// layouts are memoized on them, so a new pair lays every mounted chart out again.
let defaultMeasure = createMeasure();
const metricsListeners = new Set<() => void>();

/**
 * Drops every cached width and the resolved font. Widths measured before a
 * web font finished loading belong to its fallback font and would keep labels
 * truncated or rotated for the wrong width.
 */
export function resetChartTextMetrics() {
  caches.clear();
  fontFamily = null;
  canvasFontSize = null;
  defaultMeasure = createMeasure();
  metricsListeners.forEach((listener) => listener());
}

/** The families of the body font, lower-cased and unquoted, as `FontFace.family` is compared. */
function chartFontFamilies(): Set<string> {
  return new Set(resolveFontFamily().split(',').map(normalizeFontFamily));
}

function normalizeFontFamily(family: string): string {
  return family.trim().replace(/^["']|["']$/g, '').toLowerCase();
}

/** `FontFaceSetLoadEvent` without the DOM lib: the faces the batch loaded, absent in old implementations. */
type FontLoadEvent = Event & { fontfaces?: ReadonlyArray<{ family: string }> };

let resetFrame: number | null = null;

/** One reset per frame: a dashboard's charts are laid out again together, not once per batch. */
function scheduleReset() {
  if (resetFrame !== null) return;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    resetChartTextMetrics();
    return;
  }

  resetFrame = window.requestAnimationFrame(() => {
    resetFrame = null;
    resetChartTextMetrics();
  });
}

/**
 * `loadingdone` fires for any batch of faces (an emoji or CJK subset a
 * document next to the charts pulls in, too); only a face of the body font
 * changes what the charts measured. A batch that does not say which faces it
 * loaded is taken as one that did.
 */
function onFontsLoaded(event?: FontLoadEvent) {
  const faces = event?.fontfaces;

  if (faces) {
    const families = chartFontFamilies();

    if (!faces.some((face) => families.has(normalizeFontFamily(face.family)))) return;
  }

  scheduleReset();
}

function watchFonts() {
  if (watchingFonts) return;
  watchingFonts = true;
  if (typeof document === 'undefined') return;
  document.fonts?.addEventListener?.('loadingdone', onFontsLoaded);
}

function subscribeToMetrics(listener: () => void) {
  metricsListeners.add(listener);
  return () => {
    metricsListeners.delete(listener);
  };
}

function getDefaultMeasure() {
  return defaultMeasure;
}

/** Tests inject a measurer here; without a provider the canvas measurer is used. */
export const ChartMeasureContext = createContext<ChartMeasure | null>(null);

export function useChartMeasure(): ChartMeasure {
  const injected = useContext(ChartMeasureContext);
  const measured = useSyncExternalStore(subscribeToMetrics, getDefaultMeasure, getDefaultMeasure);

  return injected ?? measured;
}
