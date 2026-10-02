import * as Y from 'yjs';

import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { TextCell } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { MentionType, YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';

import {
  getMentionedPageIds,
  hasStoredPageTitle,
  isPlainRichText,
  isRichTextTooLarge,
  MAX_RICH_TEXT_DELTA_BYTES,
  parseRichTextCellValue,
  richTextToPlainText,
  serializeRichTextCellValue,
} from '../rich-text';

function makeCell(fieldType: FieldType, values: Record<string, unknown>) {
  const doc = new Y.Doc();
  const cell = doc.getMap('cell') as YDatabaseCell;

  cell.set(YjsDatabaseKey.field_type, fieldType);
  Object.entries(values).forEach(([key, value]) => cell.set(key, value));
  return cell;
}

function makeField(fieldType: FieldType) {
  const doc = new Y.Doc();
  const field = doc.getMap('field') as YDatabaseField;

  field.set(YjsDatabaseKey.type, fieldType);
  return field;
}

const boldDelta = [{ insert: 'Hello ' }, { insert: 'world', attributes: { bold: true } }];

describe('text cell rich text', () => {
  it('reads formatting only while it still describes data', () => {
    const stored = serializeRichTextCellValue('Hello world', boldDelta);

    expect(parseRichTextCellValue(stored, 'Hello world')).toEqual(boldDelta);
    // Another client rewrote `data` and left the formatting behind.
    expect(parseRichTextCellValue(stored, 'Edited on desktop')).toBeUndefined();
  });

  it('reads a stored value once, and gives every read of it the same delta', () => {
    const delta = [{ insert: 'Read ' }, { insert: 'once', attributes: { bold: true } }];
    const stored = serializeRichTextCellValue('Read once', delta);
    const parseSpy = jest.spyOn(JSON, 'parse');
    const first = parseRichTextCellValue(stored, 'Read once');
    const again = parseRichTextCellValue(stored, 'Read once');
    // The same JSON in another string (another row holding the same text).
    const copy = parseRichTextCellValue(`${stored} `.trimEnd(), 'Read once');
    const parses = parseSpy.mock.calls.filter(([json]) => json === stored).length;

    parseSpy.mockRestore();

    expect(first).toEqual(delta);
    // Renderers memoized on the delta skip a cell whose value did not change.
    expect(again).toBe(first);
    expect(copy).toBe(first);
    expect(parses).toBe(1);
    // The text it was saved for is still checked on every read.
    expect(parseRichTextCellValue(stored, 'Edited on desktop')).toBeUndefined();
    expect(parseRichTextCellValue(stored, 'Read once')).toBe(first);
  });

  it('forgets the values read longest ago once it holds enough of them', () => {
    const value = (text: string) => serializeRichTextCellValue(text, [{ insert: text, attributes: { bold: true } }]);
    const early = value('early');
    const kept = value('kept');
    const earlyDelta = parseRichTextCellValue(early, 'early');
    const keptDelta = parseRichTextCellValue(kept, 'kept');

    // Large values read since, with `kept` read again in between.
    for (let index = 0; index < 5; index++) {
      const text = `${index}`.repeat(450_000);

      expect(parseRichTextCellValue(value(text), text)).toHaveLength(1);
      expect(parseRichTextCellValue(kept, 'kept')).toBe(keptDelta);
    }

    const earlyAgain = parseRichTextCellValue(early, 'early');

    expect(earlyAgain).toEqual(earlyDelta);
    expect(earlyAgain).not.toBe(earlyDelta);
  });

  it('ignores malformed, unformatted or non-string values', () => {
    expect(parseRichTextCellValue('{not json', 'x')).toBeUndefined();
    expect(parseRichTextCellValue(JSON.stringify({ text: 'x', delta: 'x' }), 'x')).toBeUndefined();
    expect(parseRichTextCellValue(JSON.stringify({ text: 'x', delta: [{ nope: 1 }] }), 'x')).toBeUndefined();
    expect(parseRichTextCellValue(serializeRichTextCellValue('x', [{ insert: 'x' }]), 'x')).toBeUndefined();
    expect(parseRichTextCellValue(undefined, 'x')).toBeUndefined();
    expect(parseRichTextCellValue(serializeRichTextCellValue('1', boldDelta), 1)).toBeUndefined();
  });

  it('reads Desktop values: the empty clear marker, sorted keys and null attributes', () => {
    // A plain save on Desktop writes rich_text "".
    expect(parseRichTextCellValue('', 'x')).toBeUndefined();
    // serde_json sorts keys; null attributes mean none (Rust accepts them too).
    const desktop =
      '{"delta":[{"attributes":null,"insert":"Hello "},{"attributes":{"bold":true},"insert":"world"}],"text":"Hello world"}';

    expect(parseRichTextCellValue(desktop, 'Hello world')).toEqual(boldDelta);
    // Array attributes are invalid on both clients.
    expect(
      parseRichTextCellValue(JSON.stringify({ text: 'x', delta: [{ insert: 'x', attributes: ['bold'] }] }), 'x')
    ).toBeUndefined();
  });

  it('writes a page mention with its current name over the stored title', () => {
    const delta = [
      { insert: '$', attributes: { mention: { type: MentionType.PageRef, page_id: 'p1', data: { title: 'Old' } } } },
    ];

    expect(richTextToPlainText(delta, () => 'Renamed')).toBe('Renamed');
    expect(richTextToPlainText(delta, () => undefined)).toBe('Old');
  });

  it('preserves long link attributes accepted by Desktop within the shared delta limit', () => {
    // Desktop's rich_text.rs also tests hrefs longer than 32 KB. The limit
    // applies to the entire delta, not an individual attribute's length.
    const href = `https://example.com/${'a'.repeat(33_000)}`;
    const delta = [{ insert: 'Link', attributes: { href } }];
    const stored = serializeRichTextCellValue('Link', delta);

    expect(isRichTextTooLarge(delta)).toBe(false);
    expect(parseRichTextCellValue(stored, 'Link')).toEqual(delta);
    expect(serializeRichTextCellValue('Link', parseRichTextCellValue(stored, 'Link')!)).toBe(stored);
  });

  it('treats inserts without attributes (or only false ones) as plain', () => {
    expect(isPlainRichText([{ insert: 'a' }, { insert: 'b', attributes: { bold: false } }])).toBe(true);
    expect(isPlainRichText(boldDelta)).toBe(false);
  });

  it('writes mentions and equations as readable plain text', () => {
    const text = richTextToPlainText(
      [
        { insert: 'Ask ' },
        { insert: '@', attributes: { mention: { type: MentionType.Person, person_id: 'u1', person_name: 'Ada' } } },
        { insert: ' about ' },
        { insert: '@', attributes: { mention: { type: MentionType.PageRef, page_id: 'p1' } } },
        { insert: ' on ' },
        { insert: '@', attributes: { mention: { type: MentionType.Date, date: '2026-09-30T08:00:00' } } },
        { insert: ': ' },
        { insert: '$', attributes: { formula: 'E=mc^2' } },
      ],
      (id) => (id === 'p1' ? 'Roadmap' : undefined)
    );

    expect(text).toBe('Ask @Ada about Roadmap on @Sep 30, 2026: E=mc^2');
  });

  it('lists mentioned pages once', () => {
    const mention = { type: MentionType.PageRef, page_id: 'p1' };

    expect(
      getMentionedPageIds([
        { insert: '@', attributes: { mention } },
        { insert: '@', attributes: { mention } },
        { insert: '@', attributes: { mention: { type: MentionType.Person, person_id: 'u' } } },
      ])
    ).toEqual(['p1']);
  });

  it('parses formatting into a Text cell for renderers that ask for it', () => {
    const cell = makeCell(FieldType.RichText, {
      [YjsDatabaseKey.data]: 'Hello world',
      [YjsDatabaseKey.rich_text]: serializeRichTextCellValue('Hello world', boldDelta),
    });
    const field = makeField(FieldType.RichText);

    expect((parseYDatabaseCellToCell(cell, field, { richText: true }) as TextCell).richText).toEqual(boldDelta);
    // Filters, sorts, groups and calculations read `data` only: no JSON parse.
    const parseSpy = jest.spyOn(JSON, 'parse');
    const plain = parseYDatabaseCellToCell(cell, field) as TextCell;

    expect(plain.data).toBe('Hello world');
    expect(plain.richText).toBeUndefined();
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it('drops formatting once the cell is read as another type or the text changed', () => {
    const cell = makeCell(FieldType.RichText, {
      [YjsDatabaseKey.data]: 'Hello world',
      [YjsDatabaseKey.rich_text]: serializeRichTextCellValue('Hello world', boldDelta),
    });

    expect(
      (parseYDatabaseCellToCell(cell, makeField(FieldType.SingleSelect), { richText: true }) as TextCell).richText
    ).toBeUndefined();

    cell.set(YjsDatabaseKey.data, 'Changed');
    expect(
      (parseYDatabaseCellToCell(cell, makeField(FieldType.RichText), { richText: true }) as TextCell).richText
    ).toBeUndefined();
  });

  describe('values of unexpected shapes', () => {
    function parse(delta: unknown[]) {
      return parseRichTextCellValue(JSON.stringify({ text: 'x', delta }), 'x');
    }

    it('keeps each attribute only in the shape the renderers read', () => {
      const deep: Record<string, unknown> = {};
      let level = deep;

      for (let index = 0; index < 50; index++) {
        level.next = {};
        level = level.next as Record<string, unknown>;
      }

      expect(
        parse([
          {
            insert: 'x',
            attributes: {
              bold: true,
              italic: 'yes',
              underline: 1,
              font_color: 1,
              bg_color: { x: 1 },
              af_text_color: true,
              af_background_color: '',
              href: 5,
              formula: { latex: 'x' },
              code: true,
              zzz: deep,
              'comment-ids': ['c1'],
            },
          },
        ])
      ).toEqual([{ insert: 'x', attributes: { bold: true, code: true } }]);
      // Nothing usable is left: the cell reads as plain text.
      expect(parse([{ insert: 'x', attributes: { font_color: 1, mention: 42 } }])).toBeUndefined();
    });

    it('keeps typed mention fields and preserves valid unknown fields', () => {
      expect(
        parse([
          {
            insert: '@',
            attributes: {
              mention: {
                type: 'person',
                person_id: 'u1',
                person_name: { first: 'Ada' },
                url: 5,
                include_time: 'yes',
                data: { title: 'T', nested: { deep: true } },
                future_field: 'kept',
                future_object: { kept: true },
              },
            },
          },
        ])
      ).toEqual([
        {
          insert: '@',
          attributes: {
            mention: {
              type: 'person',
              person_id: 'u1',
              data: { title: 'T', nested: { deep: true } },
              future_field: 'kept',
              future_object: { kept: true },
            },
          },
        },
      ]);
    });

    it('reads mentions the way Desktop stores them: JSON text, and legacy reminders as dates', () => {
      expect(
        parse([
          {
            insert: '$',
            attributes: {
              mention: JSON.stringify({ type: 'reminder', date: '2026-09-30T08:05:00', reminder_id: 'r1' }),
            },
          },
        ])
      ).toEqual([
        {
          insert: '$',
          attributes: { mention: { type: MentionType.Date, date: '2026-09-30T08:05:00', reminder_id: 'r1' } },
        },
      ]);
      expect(parse([{ insert: '$', attributes: { mention: { person_id: 'no type' } } }])).toBeUndefined();
    });
  });

  describe('database row mentions', () => {
    const rowMention = {
      type: MentionType.PageRef,
      page_id: 'db-view',
      database_view_id: 'db-view',
      row_id: 'row-1',
      data: { title: 'Task A' },
    };
    const delta = [{ insert: 'See ' }, { insert: '@', attributes: { mention: rowMention } }];

    it("write the row's title, which their chip shows, not their database view's name", () => {
      expect(richTextToPlainText(delta, () => 'Projects')).toBe('See Task A');
      expect(getMentionedPageIds(delta)).toEqual([]);
    });

    it("say nothing about their database view's own title", () => {
      const withDatabase = [
        ...delta,
        { insert: '@', attributes: { mention: { type: MentionType.PageRef, page_id: 'db-view' } } },
      ];

      expect(getMentionedPageIds(withDatabase)).toEqual(['db-view']);
      expect(hasStoredPageTitle(withDatabase, 'db-view')).toBe(false);
    });
  });

  it('measures formatting in UTF-8 bytes, as Desktop bounds it', () => {
    const mention = { type: MentionType.Person, person_id: 'u1', person_name: 'Ada' };
    const underLimit = [{ insert: '@', attributes: { mention: { ...mention, person_name: 'a'.repeat(1000) } } }];
    // About 2 bytes per character in UTF-8, though 1 UTF-16 unit each.
    const wide = 'é'.repeat(MAX_RICH_TEXT_DELTA_BYTES / 2);
    const overLimit = [{ insert: '@', attributes: { mention: { ...mention, person_name: wide } } }];

    expect(isRichTextTooLarge(underLimit)).toBe(false);
    expect(JSON.stringify(overLimit).length).toBeLessThan(MAX_RICH_TEXT_DELTA_BYTES + 200);
    expect(isRichTextTooLarge(overLimit)).toBe(true);
  });
});
