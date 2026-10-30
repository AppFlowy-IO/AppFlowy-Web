import { readFileSync } from 'fs';
import { join } from 'path';

import { SelectOptionColor } from '@/application/database-yjs';
import {
  CHART_EMPTY_VALUE_COLOR,
  CHECKBOX_CHECKED_COLOR,
  DONUT_CHART_COLORS,
} from '@/application/database-yjs/chart.type';
import {
  getSelectOptionChartColor,
  getSelectOptionChartFillHex,
  TAG_FILL_LIGHT_HEX,
} from '@/components/database/chart/hooks/chartColors';
import {
  contrastRatio,
  DARK_CHART_SURFACE,
  deepTone,
  hexToHsl,
  hslToHex,
  nearestInPalette,
  readableTone,
} from '@/components/database/chart/widgets/chartPalette';
import { resolveDonutSectionColors } from '@/components/database/chart/widgets/chartUtils';

const hueGap = (a: string, b: string) => {
  const gap = Math.abs(hexToHsl(a).hue - hexToHsl(b).hue) % 360;

  return gap > 180 ? 360 - gap : gap;
};
const isGrey = (color: string) => hexToHsl(color).saturation < 0.15;

describe('nearestInPalette', () => {
  it('keeps a color that is already in the palette', () => {
    for (const fill of DONUT_CHART_COLORS) {
      expect(nearestInPalette(fill, DONUT_CHART_COLORS)).toBe(fill);
    }
  });

  it('keeps the hue of the color it snapped', () => {
    // Desktop's sources: what matters is the hue surviving the round trip.
    for (const source of ['#F44336', '#FF9800', '#FFC107', '#4CAF50', '#00BCD4', '#2196F3', '#673AB7', '#9C27B0']) {
      expect(hueGap(source, nearestInPalette(source, DONUT_CHART_COLORS))).toBeLessThan(20);
    }
  });

  it('routes near-grey onto the grey end rather than a hue', () => {
    expect(nearestInPalette('#B8B8B8', DONUT_CHART_COLORS)).toBe('#B8B8B8');
  });

  it('never sends a dark grey to a hue, unlike desktop', () => {
    // Desktop compares a grey's lightness with every entry, and the ramp's
    // darkest entry is lime: the thick slate tag and dark greys land on it.
    for (const source of ['#4C5966', '#333333', '#1F2329', '#FFFFFF']) {
      expect(isGrey(nearestInPalette(source, DONUT_CHART_COLORS))).toBe(true);
    }

    expect(nearestInPalette('#4C5966', DONUT_CHART_COLORS)).toBe(CHART_EMPTY_VALUE_COLOR);
  });
});

describe('deepTone', () => {
  it('stays readable as text on the white chart surface', () => {
    for (const fill of DONUT_CHART_COLORS) {
      expect(contrastRatio(deepTone(fill), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the hue it deepened', () => {
    for (const fill of DONUT_CHART_COLORS.filter((color) => !isGrey(color))) {
      expect(Math.abs(hexToHsl(fill).hue - hexToHsl(deepTone(fill)).hue)).toBeLessThan(2);
    }
  });

  it('derives the same tones as desktop', () => {
    expect(deepTone('#FFB6B6')).toBe('#E90000');
    expect(deepTone('#FFD39A')).toBe('#A45D00');
    expect(deepTone('#E7EB74')).toBe('#6B6F10');
    expect(deepTone('#ACACFF')).toBe('#5A5AFF');
    expect(deepTone('#B0B5BF')).toBe('#6D7687');
  });
});

describe('readableTone', () => {
  it('lifts the label above the dark chart surfaces instead of deepening it', () => {
    for (const fill of DONUT_CHART_COLORS) {
      const tone = readableTone(fill, true);

      expect(contrastRatio(tone, DARK_CHART_SURFACE)).toBeGreaterThanOrEqual(4.5);
      // `--background-primary`, the darker of the two.
      expect(contrastRatio(tone, '#21232A')).toBeGreaterThanOrEqual(4.5);
    }

    // The pastels already read on dark, so they label themselves there.
    expect(readableTone('#FFB6B6', true)).toBe('#FFB6B6');
    expect(readableTone('#FFB6B6', false)).toBe('#E90000');
  });

  it('lifts a fill that is too dark for the dark surface', () => {
    const tone = readableTone('#4545A6', true);

    expect(contrastRatio('#4545A6', DARK_CHART_SURFACE)).toBeLessThan(4.5);
    expect(contrastRatio(tone, DARK_CHART_SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(hueGap(tone, '#4545A6')).toBeLessThan(2);
  });
});

describe('HSL conversions', () => {
  it('round-trips every palette entry like Flutter’s HSLColor', () => {
    for (const fill of DONUT_CHART_COLORS) {
      expect(hslToHex(hexToHsl(fill))).toBe(fill);
    }
  });
});

describe('option fills', () => {
  it('keeps the light tag fill table in step with the theme CSS', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/variables/semantic.light.css'), 'utf8');
    const fromCss = Object.fromEntries(
      Array.from(css.matchAll(/(--tag-fill-\d\d-(?:light|thick)):\s*(#[0-9a-f]{6});/gi), ([, token, hex]) => [
        token,
        hex.toUpperCase(),
      ])
    );

    expect(TAG_FILL_LIGHT_HEX).toEqual(fromCss);
  });

  it('maps every option fill back to its light color, and nothing else', () => {
    for (const color of Object.values(SelectOptionColor)) {
      expect(getSelectOptionChartFillHex(getSelectOptionChartColor(color))).toMatch(/^#[0-9A-F]{6}$/);
    }

    expect(getSelectOptionChartFillHex(CHECKBOX_CHECKED_COLOR)).toBeUndefined();
    expect(getSelectOptionChartFillHex('var(--text-primary)')).toBeUndefined();
  });
});

describe('resolveDonutSectionColors', () => {
  const item = (overrides = {}) => ({ label: 'Item', value: 1, rowIds: [], ...overrides });

  it('snaps an option fill onto the palette and labels it in the same hue', () => {
    // Yellow tag → apricot.
    expect(
      resolveDonutSectionColors(item({ color: getSelectOptionChartColor(SelectOptionColor.OptionColor5) }), 0, false)
    ).toEqual({ fill: '#FFE2A1', text: '#976800' });
    // Thick indigo tag: desktop snaps its white tag text color, which lands on the red end.
    expect(
      resolveDonutSectionColors(item({ color: getSelectOptionChartColor(SelectOptionColor.OptionColor11) }), 0, false)
    ).toEqual({ fill: '#ACACFF', text: '#5A5AFF' });
    // Thick slate tag: grey, not lime.
    expect(
      resolveDonutSectionColors(item({ color: getSelectOptionChartColor(SelectOptionColor.OptionColor20) }), 0, false)
    ).toEqual({ fill: CHART_EMPTY_VALUE_COLOR, text: '#6D7687' });
  });

  it('keeps checkbox colors, greys the empty category and walks the palette otherwise', () => {
    expect(resolveDonutSectionColors(item({ color: CHECKBOX_CHECKED_COLOR }), 3, false).fill).toBe(
      CHECKBOX_CHECKED_COLOR
    );
    expect(resolveDonutSectionColors(item({ isEmptyCategory: true }), 3, false)).toEqual({
      fill: CHART_EMPTY_VALUE_COLOR,
      text: '#6D7687',
    });
    expect(resolveDonutSectionColors(item(), 1, false)).toEqual({ fill: '#FFD39A', text: '#A45D00' });
    expect(resolveDonutSectionColors(item(), DONUT_CHART_COLORS.length + 1, false).fill).toBe('#FFD39A');
  });

  it('labels with the lifted tone on the dark theme', () => {
    expect(resolveDonutSectionColors(item(), 1, true)).toEqual({ fill: '#FFD39A', text: '#FFD39A' });
  });
});
