import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { labelRoom, layoutHorizontalCartesian, layoutVerticalCartesian } from '../cartesianLayout';

import { FIXTURE_MEASURE } from './chartTestUtils';

const { measure12 } = FIXTURE_MEASURE;

function items(labels: string[]): ChartDataItem[] {
  return labels.map((label, index) => ({ key: `k${index}`, label, value: index + 1, rowIds: [] }));
}

describe('layoutVerticalCartesian', () => {
  it('draws horizontal labels in full when each fits its slot', () => {
    const data = items(['Alice', 'Bob', 'Carol']);
    const layout = layoutVerticalCartesian(data, { width: 630, height: 300 }, 30, ['1', '2', '3'], measure12);

    expect(layout.rotated).toBe(false);
    expect(layout.slot).toBe(200);
    expect(layout.ticks).toEqual([
      { label: 'Alice', text: 'Alice' },
      { label: 'Bob', text: 'Bob' },
      { label: 'Carol', text: 'Carol' },
    ]);
    expect(layout.dataLabels).toEqual(['1', '2', '3']);
    // A data label's line above the plot, the 24px axis below it.
    expect([layout.marginTop, layout.xAxisHeight, layout.plotHeight]).toEqual([16, 24, 260]);
    expect(layout.anchors.map((anchor) => [anchor.label, anchor.x, anchor.width])).toEqual([
      ['Alice', 30, 200],
      ['Bob', 230, 200],
      ['Carol', 430, 200],
    ]);
  });

  it('rotates and truncates labels that do not fit, keeping the full label for the title', () => {
    const long = 'A category name far longer than its slot';
    const layout = layoutVerticalCartesian(items([long, 'Short']), { width: 130, height: 300 }, 30, null, measure12);

    expect(layout.rotated).toBe(true);
    expect(layout.ticks[0]?.label).toBe(long);
    expect(layout.ticks[0]?.text.endsWith('…')).toBe(true);
    // 80px at 6px per character.
    expect(measure12(layout.ticks[0]?.text ?? '')).toBeLessThanOrEqual(80);
    expect(layout.ticks[1]).toEqual({ label: 'Short', text: 'Short' });
    // Labels off: only the 4px top room, and no label texts.
    expect(layout.dataLabels).toBeNull();
    expect(layout.marginTop).toBe(labelRoom(false));
  });

  it('thins labels in narrow slots and leaves the others out of the ticks', () => {
    const data = items(Array.from({ length: 60 }, (_, index) => `Day ${index + 1}`));
    const layout = layoutVerticalCartesian(data, { width: 630, height: 300 }, 30, null, measure12);
    const shown = layout.ticks.flatMap((tick, index) => (tick ? [index] : []));

    expect(layout.slot).toBe(10);
    expect(shown.length).toBeLessThan(60);
    expect(shown[0]).toBe(0);
    expect(shown[shown.length - 1]).toBe(59);
    // Every category keeps its anchor, also one whose label is thinned out.
    expect(layout.anchors).toHaveLength(60);
  });

  it('drops a data label that is wider than its slot', () => {
    const layout = layoutVerticalCartesian(
      items(['A', 'B']),
      { width: 70, height: 300 },
      30,
      ['1', '$1,300,000'],
      measure12
    );

    expect(layout.slot).toBe(20);
    expect(layout.dataLabels).toEqual(['1', null]);
  });

  it('measures each label once when the labels fit their slots', () => {
    const measure = jest.fn(measure12);
    const data = items(Array.from({ length: 40 }, (_, index) => `Category ${index}`));
    const layout = layoutVerticalCartesian(data, { width: 4030, height: 300 }, 30, null, measure);

    expect(layout.rotated).toBe(false);
    expect(measure).toHaveBeenCalledTimes(40);
  });
});

describe('layoutHorizontalCartesian', () => {
  const data = items(['Lead', 'Lost', 'Proposal', 'Won']);
  const ticks = ['-2K', '-1K', '0', '1K', '2K'];

  it('reserves the label column, the value axis and the data labels gutter', () => {
    const layout = layoutHorizontalCartesian(data, { width: 600, height: 300 }, ticks, ['800', '-1.5K', '1.2K', '6.5'], measure12);

    // "Proposal" is 48px wide; the column is the widest label, then the 8px gap.
    expect([layout.labelColumn, layout.yAxisWidth]).toEqual([48, 56]);
    // "-1.5K" is 30px, plus the label's 4px offset and 2px of clearance.
    expect(layout.marginRight).toBe(36);
    expect([layout.marginTop, layout.valueAxisHeight]).toEqual([4, 24]);
    expect(layout.plotWidth).toBe(600 - 56 - 36);
    expect(layout.plotHeight).toBe(300 - 4 - 24);
    expect(layout.slot).toBe(68);
    expect(layout.dataLabels).toEqual(['800', '-1.5K', '1.2K', '6.5']);
    expect(layout.anchors.map((anchor) => [anchor.label, anchor.x, anchor.y, anchor.height])).toEqual([
      ['Lead', 56, 4, 68],
      ['Lost', 56, 72, 68],
      ['Proposal', 56, 140, 68],
      ['Won', 56, 208, 68],
    ]);
  });

  it('keeps half of the last tick inside the frame when labels are off', () => {
    const layout = layoutHorizontalCartesian(data, { width: 600, height: 300 }, ['0', '1,000,000'], null, measure12);

    // "1,000,000" is 54px; the tick is centred on the plot edge.
    expect(layout.marginRight).toBe(27);
    expect(layout.dataLabels).toBeNull();
  });

  it('truncates a category to the label column and keeps its full label', () => {
    const long = 'A category name far longer than the label column allows';
    const layout = layoutHorizontalCartesian(items([long, 'Short']), { width: 400, height: 300 }, ticks, null, measure12);

    // The column is capped at 35% of the width.
    expect(layout.labelColumn).toBe(140);
    expect(layout.ticks[0]?.label).toBe(long);
    expect(layout.ticks[0]?.text.endsWith('…')).toBe(true);
    expect(measure12(layout.ticks[0]?.text ?? '')).toBeLessThanOrEqual(140);
    expect(layout.ticks[1]).toEqual({ label: 'Short', text: 'Short' });
  });

  it('thins the labels of rows closer than the minimum label spacing', () => {
    const many = items(Array.from({ length: 40 }, (_, index) => `Row ${index + 1}`));
    const layout = layoutHorizontalCartesian(many, { width: 600, height: 228 }, ticks, null, measure12);
    const shown = layout.ticks.flatMap((tick, index) => (tick ? [index] : []));

    expect(layout.slot).toBe(5);
    expect(shown.length).toBeLessThan(40);
    expect(shown[0]).toBe(0);
    expect(shown[shown.length - 1]).toBe(39);
    expect(layout.anchors).toHaveLength(40);
  });
});
