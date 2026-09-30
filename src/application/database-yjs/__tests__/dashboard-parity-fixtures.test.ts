import { TextDecoder } from 'util';

import {
  computeManifest,
  listParityFiles,
  loadParityFixture,
  MANIFEST_FILE,
  readParityFile,
} from './dashboard-parity-helpers';

interface LayoutCase {
  name: string;
  stored: unknown;
  write: unknown;
  writtenKeys: unknown;
  expected: unknown;
}

describe('dashboard-parity fixtures', () => {
  const files = listParityFiles();

  it('match their FIXTURES.sha256 manifest', () => {
    const expected = computeManifest();
    const committed = readParityFile(MANIFEST_FILE).toString('utf8');

    if (committed !== expected) {
      // The whole manifest, ready to paste (or regenerate it as README.md says).
      throw new Error(`${MANIFEST_FILE} is out of date. Expected:\n${expected}`);
    }
  });

  it.each(files)('%s is UTF-8 without a BOM, with LF line endings and one trailing newline', (name) => {
    const bytes = readParityFile(name);

    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');

    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it.each(files.filter((name) => name.endsWith('.json')))('%s parses and is indented with 2 spaces', (name) => {
    expect(() => loadParityFixture(name)).not.toThrow();
    readParityFile(name)
      .toString('utf8')
      .split('\n')
      .forEach((line) => {
        const indent = /^[ \t]*/.exec(line)?.[0] ?? '';

        expect(indent.includes('\t')).toBe(false);
        expect(indent.length % 2).toBe(0);
      });
  });

  it('describes every unknown-keys case completely', () => {
    const fixture = loadParityFixture<{ dashboardCases: LayoutCase[]; chartCases: LayoutCase[] }>(
      'layouts/unknown-keys.json'
    );

    expect(fixture.dashboardCases.length).toBeGreaterThan(0);
    expect(fixture.chartCases.length).toBeGreaterThan(0);
    [...fixture.dashboardCases, ...fixture.chartCases].forEach((entry) => {
      expect(typeof entry.name).toBe('string');
      expect(entry).toHaveProperty('stored');
      expect(entry).toHaveProperty('write');
      expect(Array.isArray(entry.writtenKeys)).toBe(true);
      expect(entry).toHaveProperty('expected');
    });
  });
});
