import { extractNextJsonObject } from '../stream-json-parser';

describe('extractNextJsonObject', () => {
  it('extracts a simple json object', () => {
    const result = extractNextJsonObject('prefix {"a":"b"} suffix');

    expect(result).toEqual({
      jsonStr: '{"a":"b"}',
      nextIndex: 'prefix {"a":"b"}'.length,
    });
  });

  it('handles braces inside string values', () => {
    const streamChunk = '{"delta":"hello {ref:block_1}"}{"done":true}';
    const first = extractNextJsonObject(streamChunk);

    expect(first?.jsonStr).toBe('{"delta":"hello {ref:block_1}"}');

    const second = extractNextJsonObject(streamChunk.slice(first?.nextIndex ?? 0));

    expect(second?.jsonStr).toBe('{"done":true}');
  });

  it('handles escaped quotes in strings', () => {
    const result = extractNextJsonObject('{"delta":"say \\"{hello}\\" now"}');

    expect(result?.jsonStr).toBe('{"delta":"say \\"{hello}\\" now"}');
  });

  it('returns null for incomplete object', () => {
    expect(extractNextJsonObject('{"a":"b"')).toBeNull();
  });
});
