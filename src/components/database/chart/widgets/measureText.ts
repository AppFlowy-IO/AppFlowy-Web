import { createContext, useContext } from 'react';

import type { TextMeasurer } from '@/application/database-yjs/chart-scale';

/** Text measurers for the chart font: 12px (ticks, data labels, legend) and 10px (donut labels). */
export interface ChartMeasure {
  measure12: TextMeasurer;
  measure10: TextMeasurer;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;

function isJsdom() {
  return typeof navigator !== 'undefined' && /jsdom/.test(navigator.userAgent);
}

function canvasContext() {
  if (context === undefined) {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }

  return context;
}

function bodyFontFamily() {
  if (typeof document === 'undefined' || !document.body) return 'sans-serif';
  return getComputedStyle(document.body).fontFamily || 'sans-serif';
}

/**
 * Canvas `measureText` with the body font at `fontSize`, behind a 500-entry
 * LRU cache. jsdom has no canvas metrics, so there a character is 6.5px at
 * 12px; tests that assert layout inject their own measurer through
 * `ChartMeasureContext`.
 */
export function measureChartText(text: string, fontSize: number): number {
  if (isJsdom()) return Array.from(text).length * 6.5 * (fontSize / 12);
  const key = `${fontSize}|${text}`;
  const cached = cache.get(key);

  if (cached !== undefined) {
    // Refresh the entry's place in the LRU order.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const ctx = canvasContext();

  if (!ctx) return Array.from(text).length * 6.5 * (fontSize / 12);
  ctx.font = `400 ${fontSize}px ${bodyFontFamily()}`;
  const width = ctx.measureText(text).width;

  cache.set(key, width);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return width;
}

const DEFAULT_MEASURE: ChartMeasure = {
  measure12: (text) => measureChartText(text, 12),
  measure10: (text) => measureChartText(text, 10),
};

export const ChartMeasureContext = createContext<ChartMeasure>(DEFAULT_MEASURE);

export function useChartMeasure(): ChartMeasure {
  return useContext(ChartMeasureContext);
}
