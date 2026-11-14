import { expect } from '@jest/globals';

import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { loadMentionParityFixture } from '@/components/editor/components/panels/mention-panel/__tests__/mention-parity-helpers';
import {
  boundMentionText,
  codePointOrderKey,
  compareCodePoints,
  compareCodeUnits,
  compareDashboardText,
  countCodePoints,
  isMentionBlankText,
  normalizeDashboardText,
  normalizeMentionText,
} from '@/utils/normalize-text';

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
    expect(normalizeDashboardText('éclair')).toBe(normalizeDashboardText('e\u0301clair'));
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

// The @-mention matcher's normalizer, the typeahead contract's `mention_match::normalize`.
describe('normalizeMentionText (mention-parity/normalize.json)', () => {
  const vectors = loadMentionParityFixture<{ cases: { id: string; in: string; out: string }[] }>('normalize.json').cases;
  const WHITE_SPACE = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

  /** The contract's steps, one code point at a time, as the Rust reference applies them. */
  function perCodePoint(text: string): string {
    return Array.from(text.normalize('NFKD'))
      .filter((char) => !/^\p{M}$/u.test(char))
      .map((char) => char.toLowerCase())
      .join('')
      .split(WHITE_SPACE)
      .filter(Boolean)
      .join(' ');
  }

  it.each(vectors.map((entry) => [entry.id, entry] as const))('%s', (_, entry) => {
    expect(normalizeMentionText(entry.in)).toBe(entry.out);
  });

  it('differs from normalizeDashboardText in sigma and White_Space, as the server does', () => {
    expect(normalizeDashboardText('ΟΔΟΣ')).toBe('οδος');
    expect(normalizeMentionText('ΟΔΟΣ')).toBe('οδοσ');
    expect(normalizeMentionText('a\u0085b')).toBe('a b');
    expect(normalizeMentionText('a\ufeffb')).toBe('a\ufeffb');
    expect(normalizeMentionText('\u00a0Café\u3000MENU ')).toBe('cafe menu');
  });

  it('lowercases every code point on its own, in any context', () => {
    const mismatches: string[] = [];
    const check = (text: string) => {
      if (normalizeMentionText(text) !== perCodePoint(text)) mismatches.push(JSON.stringify(text));
    };

    for (let codePoint = 0; codePoint <= 0x2ffff; codePoint += codePoint < 0x20000 ? 1 : 7) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;

      const char = String.fromCodePoint(codePoint);

      // A capital sigma before and after it, the context Final_Sigma reads.
      check(`Σ${char}Σ`);
    }

    ['ΟΔΟΣ ΟΔΟΣ', 'ΑΣ.', 'Σ', 'ΑΣ\u0301', 'İSTANBUL', 'ǅemal', 'ΣΑΣ σ'].forEach(check);
    expect(mismatches.slice(0, 20)).toEqual([]);
  });
});

describe('mention text helpers', () => {
  it('cuts text at 512 code points, counting a surrogate pair once', () => {
    expect(boundMentionText('road')).toBe('road');
    expect(boundMentionText('x'.repeat(600))).toBe('x'.repeat(512));
    expect(boundMentionText('😀'.repeat(600))).toBe('😀'.repeat(512));
    expect(boundMentionText(`${'x'.repeat(511)}😀😀`)).toBe(`${'x'.repeat(511)}😀`);
    expect(boundMentionText('abc', 2)).toBe('ab');
  });

  it('counts code points as Array.from does, lone surrogates included', () => {
    ['', 'road', 'Café', 'e\u0301', '😀👩\u200d💻', '\ud83d', 'a\ude00b', '\ud83d😀'].forEach((text) => {
      expect([text, countCodePoints(text)]).toEqual([text, Array.from(text).length]);
    });
  });

  it('counts from the first surrogate on, however long the text before it', () => {
    const long = 'x'.repeat(5000);

    [
      long,
      `路线${long}`,
      `${long}😀`,
      `😀${long}`,
      `${long}\ud83d`,
      `${long}\ude00${long}`,
      `${long}😀\ud83d😀`,
      '😀'.repeat(3000),
    ].forEach((text) => {
      expect([text.length, countCodePoints(text)]).toEqual([text.length, Array.from(text).length]);
    });
  });

  it('orders by code point, as UTF-8 bytes do', () => {
    const alphabet = ['a', 'z', 'é', '\ud7ff', '\ue000', '\uff21', '\uffff', '\ud800\udc00', '\ud83d\ude00'];
    let state = 7;
    const next = () => {
      state = (state * 48271) % 2147483647;
      return state;
    };
    const word = () => Array.from({ length: next() % 4 }, () => alphabet[next() % alphabet.length]).join('');

    for (let sample = 0; sample < 2000; sample += 1) {
      const a = word();
      const b = word();

      const bytes = Math.sign(Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));

      expect([a, b, Math.sign(compareCodePoints(a, b))]).toEqual([a, b, bytes]);
      expect([a, b, Math.sign(compareCodeUnits(codePointOrderKey(a), codePointOrderKey(b)))]).toEqual([a, b, bytes]);
    }

    expect(codePointOrderKey('page:00000000-0000-4000-8000-0000000000a1')).toBe(
      'page:00000000-0000-4000-8000-0000000000a1'
    );

    expect(compareCodePoints('\uff21', '\ud83d\ude00')).toBeLessThan(0);
    expect('\uff21' < '\ud83d\ude00').toBe(false);
  });

  it('calls only Unicode White_Space blank', () => {
    expect(isMentionBlankText('')).toBe(true);
    expect(isMentionBlankText(' \t\u3000\u0085\u00a0')).toBe(true);
    expect(isMentionBlankText('\ufeff')).toBe(false);
    expect(isMentionBlankText('\u200b')).toBe(false);
    expect(isMentionBlankText(' a ')).toBe(false);
  });
});
