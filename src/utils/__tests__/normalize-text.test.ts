import { expect } from '@jest/globals';

import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { compareDashboardText, normalizeDashboardText } from '@/utils/normalize-text';

interface TextNormalizeFixture {
  cases: { in: string; out: string }[];
}

const fixture = loadParityFixture<TextNormalizeFixture>('text-normalize.json');
const labelCompare = loadParityFixture<{ labelCompare: [string, string, number][] }>('group-keys.json').labelCompare;

describe('normalizeDashboardText (dashboard-parity/text-normalize.json)', () => {
  it('covers the WP08 cases', () => {
    const inputs = fixture.cases.map((entry) => entry.in);

    expect(inputs).toEqual(expect.arrayContaining(['Café', '  ÉTÉ ', 'ﬁle', 'Ｆｕｌｌ', 'İstanbul', 'Straße', '']));
  });

  it.each(fixture.cases.map((entry) => [JSON.stringify(entry.in), entry] as const))('%s', (_, entry) => {
    expect(normalizeDashboardText(entry.in)).toBe(entry.out);
  });

  it('folds precomposed and decomposed accents to the same text', () => {
    expect(normalizeDashboardText('éclair')).toBe(normalizeDashboardText('éclair'));
  });

  it('is idempotent', () => {
    fixture.cases.forEach((entry) => {
      expect(normalizeDashboardText(normalizeDashboardText(entry.in))).toBe(entry.out);
    });
  });
});

// The one comparator chart labels (`compareChartLabels`) and the MCP connected apps sort by.
describe('compareDashboardText (dashboard-parity/group-keys.json#labelCompare)', () => {
  it.each(labelCompare)('%p vs %p', (a, b, sign) => {
    expect(Math.sign(compareDashboardText(a, b))).toBe(sign);
  });
});
