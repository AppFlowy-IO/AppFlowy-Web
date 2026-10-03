import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

type MeasureModule = typeof import('../measureText');

/**
 * Loads `measureText` as a browser would: a user agent that is not jsdom, a
 * canvas that measures 7px per character at 12px, and a `document.fonts` that
 * records its listeners.
 */
function loadInBrowser() {
  const assignedFonts: string[] = [];
  const measured: string[] = [];
  const fontListeners: Record<string, () => void> = {};
  let font = '';
  const context = {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
      assignedFonts.push(value);
    },
    measureText: (text: string) => {
      measured.push(text);
      return { width: (text.length * 7 * parseFloat(font.split(' ')[1])) / 12 };
    },
  };
  const userAgent = jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome');
  const getContext = jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const computedStyle = jest
    .spyOn(window, 'getComputedStyle')
    .mockReturnValue({ fontFamily: 'Inter, sans-serif' } as CSSStyleDeclaration);
  const fonts = {
    addEventListener: jest.fn((type: string, listener: () => void) => {
      fontListeners[type] = listener;
    }),
  };

  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });

  let measure: MeasureModule | undefined;

  // A fresh module (its caches and its jsdom check are module state), on this test's React.
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    measure = jest.requireActual('../measureText') as MeasureModule;
  });
  jest.dontMock('react');

  return {
    measure: measure as MeasureModule,
    assignedFonts,
    measured,
    computedStyle,
    fonts,
    fontListeners,
    restore: () => {
      userAgent.mockRestore();
      getContext.mockRestore();
      computedStyle.mockRestore();
      Reflect.deleteProperty(document, 'fonts');
    },
  };
}

describe('measureChartText', () => {
  it('estimates 6.5px per character at 12px where there are no canvas metrics', () => {
    const { measureChartText } = jest.requireActual('../measureText') as MeasureModule;

    expect(measureChartText('abcd', 12)).toBe(26);
    expect(measureChartText('abcd', 10)).toBeCloseTo((26 * 10) / 12);
  });

  it('resolves the font once and sets the canvas font only when the size changes', () => {
    const browser = loadInBrowser();

    try {
      const { measureChartText } = browser.measure;

      expect(measureChartText('Alice', 12)).toBe(35);
      // 300 distinct labels, as one chart with many categories measures.
      for (let index = 0; index < 300; index += 1) measureChartText(`Category ${index}`, 12);
      expect(browser.computedStyle).toHaveBeenCalledTimes(1);
      expect(browser.assignedFonts).toEqual(['400 12px Inter, sans-serif']);

      measureChartText('Alice', 10);
      measureChartText('Bob', 10);
      measureChartText('Bob', 12);
      expect(browser.assignedFonts).toEqual([
        '400 12px Inter, sans-serif',
        '400 10px Inter, sans-serif',
        '400 12px Inter, sans-serif',
      ]);
      expect(browser.computedStyle).toHaveBeenCalledTimes(1);
    } finally {
      browser.restore();
    }
  });

  it('keeps every label of a dashboard of charts cached', () => {
    const browser = loadInBrowser();

    try {
      const { measureChartText } = browser.measure;
      // 12 charts of 250 categories: six times what the 500-entry cache held.
      const labels = Array.from({ length: 3000 }, (_, index) => `Category ${index}`);

      labels.forEach((label) => measureChartText(label, 12));
      const measuredOnce = browser.measured.length;

      // The next layout pass of every chart is served from the cache.
      labels.forEach((label) => measureChartText(label, 12));
      expect(browser.measured).toHaveLength(measuredOnce);
      // The two sizes do not share entries.
      expect(measureChartText('Category 1', 10)).toBeCloseTo((70 * 10) / 12);
    } finally {
      browser.restore();
    }
  });

  it('drops its widths and font when fonts finish loading, and lays mounted charts out again', () => {
    const browser = loadInBrowser();

    try {
      const { measureChartText, useChartMeasure } = browser.measure;
      const { result } = renderHook(() => useChartMeasure());
      const before = result.current;

      expect(before.measure12('Alice')).toBe(35);
      expect(browser.fonts.addEventListener).toHaveBeenCalledWith('loadingdone', expect.any(Function));
      expect(browser.fonts.addEventListener).toHaveBeenCalledTimes(1);

      // The web font arrives: the body font and every width may have changed.
      browser.computedStyle.mockReturnValue({ fontFamily: 'Loaded, sans-serif' } as CSSStyleDeclaration);
      act(() => browser.fontListeners.loadingdone());

      // Layouts are memoized on the measurers, so a new pair re-lays every chart out.
      expect(result.current).not.toBe(before);
      expect(result.current.measure12).not.toBe(before.measure12);
      const measuredBefore = browser.measured.length;

      measureChartText('Alice', 12);
      expect(browser.measured).toHaveLength(measuredBefore + 1);
      expect(browser.assignedFonts[browser.assignedFonts.length - 1]).toBe('400 12px Loaded, sans-serif');
    } finally {
      browser.restore();
    }
  });

  it('prefers a measurer injected through the context', () => {
    const { ChartMeasureContext, useChartMeasure } = jest.requireActual('../measureText') as MeasureModule;
    const injected = { measure12: () => 1, measure10: () => 2 };
    const { result } = renderHook(() => useChartMeasure(), {
      wrapper: ({ children }) => <ChartMeasureContext.Provider value={injected}>{children}</ChartMeasureContext.Provider>,
    });

    expect(result.current).toBe(injected);
  });
});
