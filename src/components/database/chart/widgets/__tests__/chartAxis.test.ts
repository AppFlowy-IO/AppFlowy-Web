import { barCategoryAxisLayout, lineCategoryAxisLayout } from '@/components/database/chart/widgets/chartAxis';

/** 6px per character, so the truncated 18-character labels measure 108px. */
const measure = (text: string) => text.length * 6;
const LINE_HEIGHT = 18;
const SIN = Math.sin(0.5);
const COS = Math.cos(0.5);

const LONG = ['A very long category name', 'Mid length', 'Another extremely long one', 'Tiny'];

/** Vertical extent of each label once it is rotated about the center the layout gives it. */
function rotatedExtents(labels: string[], labelCenter: number, tilted: boolean) {
  return labels.map((label) => {
    const width = measure(label.length > 15 ? `${label.substring(0, 15)}...` : label);
    const half = tilted ? (width * SIN + LINE_HEIGHT * COS) / 2 : LINE_HEIGHT / 2;

    return { top: labelCenter - half, bottom: labelCenter + half };
  });
}

describe('barCategoryAxisLayout', () => {
  it('keeps the labels upright in the 40px band while a slot is at least 80px wide', () => {
    expect(barCategoryAxisLayout(LONG, 80, measure)).toEqual({ tilted: false, height: 40, labelCenter: 17 });
  });

  it('tilts narrower slots and sizes the gap and band from the longest label', () => {
    const layout = barCategoryAxisLayout(LONG, 79.9, measure);
    const half = (108 * SIN + LINE_HEIGHT * COS) / 2;

    expect(layout.tilted).toBe(true);
    // Desktop's `space` (half - h/2) above the label box, and `space + h/2 + half` for the band.
    expect(layout.labelCenter).toBeCloseTo(half - LINE_HEIGHT / 2 + LINE_HEIGHT / 2);
    expect(layout.height).toBeCloseTo(2 * half);
  });

  it('never lets a tilted label rise above the axis or spill out of the band', () => {
    const layout = barCategoryAxisLayout(LONG, 40, measure);

    for (const { top, bottom } of rotatedExtents(LONG, layout.labelCenter, true)) {
      expect(top).toBeGreaterThanOrEqual(-1e-9);
      expect(bottom).toBeLessThanOrEqual(layout.height + 1e-9);
    }
  });

  it('needs no gap when a tilted label is no taller than its line', () => {
    // An empty label rotates to 18·cos(0.5) ≈ 15.8px, inside its 18px line.
    const layout = barCategoryAxisLayout([''], 10, measure);

    expect(layout.labelCenter).toBe(LINE_HEIGHT / 2);
    expect(layout.height).toBeCloseTo(LINE_HEIGHT / 2 + (LINE_HEIGHT * COS) / 2);
  });
});

describe('lineCategoryAxisLayout', () => {
  it('keeps the labels upright in the 40px band while a slot is at least 100px wide', () => {
    expect(lineCategoryAxisLayout(LONG, 100, measure)).toEqual({ tilted: false, height: 40, labelCenter: 17 });
  });

  it('tilts narrower slots into a band of the widest label plus 8px, centered under the gap', () => {
    const layout = lineCategoryAxisLayout(LONG, 99.9, measure);
    const height = 108 * SIN + LINE_HEIGHT * COS + 8;

    expect(layout).toEqual({
      tilted: true,
      height: expect.closeTo(height),
      labelCenter: expect.closeTo(8 + (height - 8) / 2),
    });

    for (const { top, bottom } of rotatedExtents(LONG, layout.labelCenter, true)) {
      expect(top).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(bottom).toBeLessThanOrEqual(layout.height + 1e-9);
    }
  });

  it('never shrinks the band below 40px', () => {
    expect(lineCategoryAxisLayout(['A', 'B'], 10, measure)).toEqual({ tilted: true, height: 40, labelCenter: 24 });
  });
});
