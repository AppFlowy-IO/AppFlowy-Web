import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseCell } from '@/application/types';

import {
  encodeRichTextCellValue,
  getMentionedPageIds,
  isPlainRichText,
  MAX_RICH_TEXT_DELTA_BYTES,
  MAX_RICH_TEXT_TEXT_BYTES,
  normalizeEditorDelta,
  packRichTextDelta,
  readRichTextCell,
  RICH_TEXT_FORBIDDEN_KEYS,
  RICH_TEXT_FORMAT_VERSION,
  RICH_TEXT_RESERVED_KEYS,
  RICH_TEXT_UNKNOWN_KEY_PATTERN,
  RICH_TEXT_UNKNOWN_MAX_DEPTH,
  RICH_TEXT_UNKNOWN_MAX_KEYS,
  RichTextDelta,
  richTextToPlainText,
  sanitizeStoredDelta,
  serializeRichTextCellValue,
  unpackRichTextDelta,
  withMentionLabels,
} from '../rich-text';

import conformance from './rich-text-conformance.json';

/**
 * The shared conformance cases (rich text spec section 19): Desktop runs the
 * same file, byte for byte. The `editability` section runs against the real
 * write helpers in dispatch/__tests__/rich-text-cell-write.test.ts; the
 * `notificationTitle` section belongs to the mention notification runner.
 */

type Json = unknown;

interface Case {
  id: string;
  description: string;
}

const sections = conformance.sections as unknown as {
  plainText: { cases: (Case & { delta: RichTextDelta; pageNames?: Record<string, string>; text: string; pageIds: string[] })[] };
  envelope: {
    cases: (Case & {
      fieldType: FieldType;
      cell: Record<string, Json>;
      expected: { state: string; editable: boolean; delta: Json };
    })[];
  };
  sanitize: { cases: (Case & { delta: RichTextDelta; expected: Json })[] };
  mentionLabels: {
    cases: (Case & { delta: RichTextDelta; pageNames?: Record<string, string>; expected: { delta: Json; text: string } })[];
  };
  write: { cases: (Case & { data: string; delta: RichTextDelta; expected: { rich_text: Json } })[] };
};

const byId = <T extends Case>(cases: T[]) => cases.map((testCase) => [testCase.id, testCase] as const);

/** A cell as stored: every key the case has, with its value as given (null, strings and floats included). */
function makeCell(values: Record<string, Json>) {
  const doc = new Y.Doc();
  const cell = doc.getMap('cell') as YDatabaseCell;

  Object.entries(values).forEach(([key, value]) => cell.set(key, value));
  return cell;
}

/** Compares as JSON (`-0`, key order and the absence of undefined keys do not matter). */
function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

describe('rich text conformance', () => {
  it('uses the shared limits', () => {
    const { limits } = conformance;

    expect(conformance.formatVersion).toBe(RICH_TEXT_FORMAT_VERSION);
    expect(limits.maxTextBytes).toBe(MAX_RICH_TEXT_TEXT_BYTES);
    expect(limits.maxDeltaBytes).toBe(MAX_RICH_TEXT_DELTA_BYTES);
    expect(limits.unknownMaxDepth).toBe(RICH_TEXT_UNKNOWN_MAX_DEPTH);
    expect(limits.unknownMaxKeys).toBe(RICH_TEXT_UNKNOWN_MAX_KEYS);
    expect(limits.unknownKeyPattern).toBe(RICH_TEXT_UNKNOWN_KEY_PATTERN.source);
    expect(limits.forbiddenKeys).toEqual(RICH_TEXT_FORBIDDEN_KEYS);
    expect(limits.reservedKeys).toEqual(RICH_TEXT_RESERVED_KEYS);
    expect(limits.maxSafeInteger).toBe(Number.MAX_SAFE_INTEGER);
  });

  describe('plainText', () => {
    it.each(byId(sections.plainText.cases))('%s', (_id, testCase) => {
      const pageNames = testCase.pageNames ?? {};

      expect(richTextToPlainText(testCase.delta, (id) => pageNames[id])).toBe(testCase.text);
      expect(getMentionedPageIds(testCase.delta)).toEqual(testCase.pageIds);
    });
  });

  describe('envelope', () => {
    it.each(byId(sections.envelope.cases))('%s', (_id, testCase) => {
      const read = readRichTextCell(makeCell(testCase.cell), testCase.fieldType);

      expect(read.state).toBe(testCase.expected.state);
      expect(read.editable).toBe(testCase.expected.editable);
      expect(asJson(read.delta && unpackRichTextDelta(read.delta))).toEqual(testCase.expected.delta);
    });
  });

  describe('sanitize', () => {
    it.each(byId(sections.sanitize.cases))('%s', (_id, testCase) => {
      const sanitized = sanitizeStoredDelta(testCase.delta);

      expect(asJson(sanitized)).toEqual(testCase.expected);
      // The editor's own normalization keeps what was preserved (R34).
      const packed = packRichTextDelta(testCase.delta);
      const normalized = normalizeEditorDelta(packed, { keepUnknown: true });

      expect(normalizeEditorDelta(normalized, { keepUnknown: true })).toEqual(normalized);
      expect(unpackRichTextDelta(packed)).toEqual(sanitized);
      expect(packRichTextDelta(unpackRichTextDelta(normalized))).toEqual(normalized);
    });
  });

  describe('mentionLabels', () => {
    it.each(byId(sections.mentionLabels.cases))('%s', (_id, testCase) => {
      const pageNames = testCase.pageNames ?? {};
      const labelled = withMentionLabels(testCase.delta, (id) => pageNames[id]);

      expect(asJson(labelled)).toEqual(testCase.expected.delta);
      expect(richTextToPlainText(labelled, (id) => pageNames[id])).toBe(testCase.expected.text);
    });
  });

  describe('write', () => {
    it.each(byId(sections.write.cases))('%s', (_id, testCase) => {
      // '' is what the writers store for "no envelope": they delete the key.
      const raw = encodeRichTextCellValue(testCase.data, testCase.delta);

      expect(raw ? JSON.parse(raw) : null).toEqual(testCase.expected.rich_text);
      expect(raw === '').toBe(isPlainRichText(testCase.delta));
      if (raw) expect(raw).toBe(serializeRichTextCellValue(testCase.data, testCase.delta));
    });
  });
});
