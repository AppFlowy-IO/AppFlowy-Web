import { inflateRawSync } from 'node:zlib';

import { expect } from '@playwright/test';

/** Read only a bounded native export produced by the local server, including its raster media. */
export function pptxEntries(bytes: Buffer): Map<string, Buffer> {
  expect(bytes.length).toBeLessThan(64 * 1024 * 1024);
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  expect(end).toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  let total = 0;
  const entries = new Map<string, Buffer>();

  expect(count).toBeLessThan(10_000);
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    expect(bytes.readUInt32LE(offset)).toBe(0x04034b50);
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    const compressed = bytes.subarray(start, start + compressedSize);

    expect([0, 8]).toContain(method);
    const data = method === 8 ? inflateRawSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }) : compressed;

    total += data.length;
    expect(total).toBeLessThan(128 * 1024 * 1024);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
