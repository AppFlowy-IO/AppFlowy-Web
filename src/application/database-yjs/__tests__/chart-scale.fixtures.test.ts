import {
  computeBarWidth,
  computeDonutGeometry,
  computeHorizontalLabelWidth,
  computeValueDomain,
  computeXAxisHeight,
  computeYAxisWidth,
  DonutSliceInput,
  fitCategoryLabels,
  layoutDonutLabels,
  legendItemWidth,
  niceTicks,
  paginateLegend,
  resolveLegend,
  thinLabelIndices,
  truncateToWidth,
} from '../chart-scale';

import { loadParityFixture } from './dashboard-parity-helpers';

interface Point {
  x: number;
  y: number;
}

interface ChartGeometryFixture {
  measurer: { px12PerChar: number; px10PerChar: number };
  niceTicks: { min: number; max: number; maxTicks: number; integerOnly: boolean; expected: number[] }[];
  valueDomain: { values: number[]; integerOnly: boolean; ticks: number[]; domain: [number, number] }[];
  yAxisWidth: { ticks: string[]; expected: number }[];
  barWidth: { plotLength: number; count: number; expected: number }[];
  thin: { count: number; step: number; expected: number[] }[];
  fitCategoryLabels: { name: string; widths: number[]; slot: number; mode: 'horizontal' | 'rotated'; shown: number[] }[];
  truncate: { text: string; maxWidth: number; expected: string }[];
  xAxisHeight: { mode: 'horizontal' | 'rotated'; widestLabel: number; expected: number }[];
  horizontalLabelWidth: { widths: number[]; innerWidth: number; expected: number }[];
  donutGeometry: {
    width: number;
    height: number;
    legendHeight: number;
    labelsWanted: boolean;
    expected: Record<string, number | boolean>;
  }[];
  donutLabels: {
    name: string;
    box: { width: number; height: number };
    geometry: { cx: number; cy: number; outer: number; inner: number; labelsOn: boolean };
    slices: DonutSliceInput[];
    expected: {
      visible: boolean;
      side: 'left' | 'right';
      text: string;
      textX: number;
      textY: number;
      leader: Point[];
      anchor: Point;
    }[];
  }[];
  legend: {
    name: string;
    labels: string[];
    glyph: 'square' | 'line';
    width: number;
    itemWidths: number[];
    expected: { pages: number[][]; lines: number; height: number };
  }[];
  resolveLegend: { chartType: number; seriesCount: number; position: 'auto' | 'off' | 'bottom'; expected: unknown }[];
}

const fixture = loadParityFixture<ChartGeometryFixture>('chart-geometry.json');
const measure12 = (text: string) => Array.from(text).length * fixture.measurer.px12PerChar;
const measure10 = (text: string) => Array.from(text).length * fixture.measurer.px10PerChar;

function expectClose(actual: number, expected: number, tolerance = 0.01) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function expectPointClose(actual: Point, expected: Point) {
  expectClose(actual.x, expected.x);
  expectClose(actual.y, expected.y);
}

describe('chart scales (dashboard-parity/chart-geometry.json)', () => {
  it.each(fixture.niceTicks.map((entry) => [`${entry.min}..${entry.max}`, entry] as const))('niceTicks %s', (_n, entry) => {
    expect(niceTicks(entry.min, entry.max, entry.maxTicks, entry.integerOnly)).toEqual(entry.expected);
  });

  it.each(fixture.valueDomain.map((entry) => [JSON.stringify(entry.values), entry] as const))(
    'computeValueDomain %s',
    (_n, entry) => {
      expect(computeValueDomain(entry.values, entry.integerOnly)).toEqual({ ticks: entry.ticks, domain: entry.domain });
    }
  );

  it.each(fixture.yAxisWidth.map((entry) => [entry.ticks.join(' '), entry] as const))('computeYAxisWidth %s', (_n, entry) => {
    expect(computeYAxisWidth(entry.ticks, measure12)).toBe(entry.expected);
  });

  it.each(fixture.barWidth.map((entry) => [`${entry.plotLength}/${entry.count}`, entry] as const))(
    'computeBarWidth %s',
    (_n, entry) => {
      expectClose(computeBarWidth(entry.plotLength, entry.count), entry.expected, 1e-6);
    }
  );

  it.each(fixture.thin.map((entry) => [`${entry.count} by ${entry.step}`, entry] as const))('thinLabelIndices %s', (_n, entry) => {
    expect(thinLabelIndices(entry.count, entry.step)).toEqual(entry.expected);
  });

  it.each(fixture.fitCategoryLabels.map((entry) => [entry.name, entry] as const))('fitCategoryLabels: %s', (_n, entry) => {
    expect(fitCategoryLabels(entry.widths, entry.slot)).toEqual({ mode: entry.mode, shown: entry.shown });
  });

  it.each(fixture.truncate.map((entry) => [`${entry.text} in ${entry.maxWidth}px`, entry] as const))(
    'truncateToWidth %s',
    (_n, entry) => {
      expect(truncateToWidth(entry.text, entry.maxWidth, measure12)).toBe(entry.expected);
    }
  );

  it.each(fixture.xAxisHeight.map((entry) => [`${entry.mode} ${entry.widestLabel}`, entry] as const))(
    'computeXAxisHeight %s',
    (_n, entry) => {
      expect(computeXAxisHeight(entry.mode, entry.widestLabel)).toBe(entry.expected);
    }
  );

  it.each(fixture.horizontalLabelWidth.map((entry) => [`${entry.widths} in ${entry.innerWidth}`, entry] as const))(
    'computeHorizontalLabelWidth %s',
    (_n, entry) => {
      expectClose(computeHorizontalLabelWidth(entry.widths, entry.innerWidth), entry.expected, 1e-6);
    }
  );

  it.each(fixture.donutGeometry.map((entry) => [`${entry.width}x${entry.height}`, entry] as const))(
    'computeDonutGeometry %s',
    (_n, entry) => {
      const geometry = computeDonutGeometry(entry.width, entry.height, entry.legendHeight, entry.labelsWanted) as unknown as Record<
        string,
        number | boolean
      >;

      Object.entries(entry.expected).forEach(([key, value]) => {
        if (typeof value === 'number') expectClose(geometry[key] as number, value, 1e-6);
        else expect(geometry[key]).toBe(value);
      });
    }
  );

  it.each(fixture.donutLabels.map((entry) => [entry.name, entry] as const))('layoutDonutLabels: %s', (_n, entry) => {
    const layouts = layoutDonutLabels(entry.slices, entry.geometry, entry.box, measure10);

    expect(layouts).toHaveLength(entry.expected.length);
    layouts.forEach((layout, index) => {
      const expected = entry.expected[index];

      expect({ visible: layout.visible, side: layout.side, text: layout.text }).toEqual({
        visible: expected.visible,
        side: expected.side,
        text: expected.text,
      });
      expectClose(layout.textX, expected.textX);
      expectClose(layout.textY, expected.textY);
      layout.leader.forEach((point, pointIndex) => expectPointClose(point, expected.leader[pointIndex]));
      expectPointClose(layout.anchor, expected.anchor);
    });
  });

  it.each(fixture.legend.map((entry) => [entry.name, entry] as const))('paginateLegend: %s', (_n, entry) => {
    const itemWidths = entry.labels.map((label) => legendItemWidth(measure12(label), entry.glyph));

    expect(itemWidths).toEqual(entry.itemWidths);
    expect(paginateLegend(itemWidths, entry.width)).toEqual(entry.expected);
  });

  it.each(
    fixture.resolveLegend.map((entry) => [`type ${entry.chartType} × ${entry.seriesCount} ${entry.position}`, entry] as const)
  )('resolveLegend %s', (_n, entry) => {
    expect(resolveLegend(entry.chartType, entry.seriesCount, entry.position)).toEqual(entry.expected);
  });
});
