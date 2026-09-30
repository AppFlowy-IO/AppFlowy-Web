/** @jest-environment node */

import {
  DEFAULT_MAX_INLINE_BYTES,
  DEFAULT_SNAPSHOT_TIMEOUT_MS,
  describeSsrConfig,
  readSsrSettings,
} from './ssr-config';

describe('readSsrSettings', () => {
  it('uses the defaults when nothing is set', () => {
    expect(readSsrSettings({})).toEqual({
      snapshotTimeoutMs: DEFAULT_SNAPSHOT_TIMEOUT_MS,
      maxInlineBytes: DEFAULT_MAX_INLINE_BYTES,
    });
  });

  it('reads valid values, tolerating surrounding whitespace', () => {
    expect(
      readSsrSettings({ APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS: ' 800 ', APPFLOWY_SSR_MAX_INLINE_BYTES: '2048' })
    ).toEqual({ snapshotTimeoutMs: 800, maxInlineBytes: 2048 });
  });

  it.each([
    ['below the minimum', '5', 100],
    ['zero', '0', 100],
    ['above the maximum', '60000', 5000],
  ])('clamps a timeout %s', (_label, raw, expected) => {
    expect(readSsrSettings({ APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS: raw }).snapshotTimeoutMs).toBe(expected);
  });

  it.each(['', 'abc', '-5', '1.5', '100ms', '1e3'])('falls back to the defaults for invalid value %p', (raw) => {
    expect(
      readSsrSettings({ APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS: raw, APPFLOWY_SSR_MAX_INLINE_BYTES: raw })
    ).toEqual({
      snapshotTimeoutMs: DEFAULT_SNAPSHOT_TIMEOUT_MS,
      maxInlineBytes: DEFAULT_MAX_INLINE_BYTES,
    });
  });

  it('allows an inline limit of zero, which disables inlining', () => {
    expect(readSsrSettings({ APPFLOWY_SSR_MAX_INLINE_BYTES: '0' }).maxInlineBytes).toBe(0);
  });
});

describe('describeSsrConfig', () => {
  it('summarizes the defaults', () => {
    expect(describeSsrConfig({})).toBe(
      'SSR kill switch: off; indexable namespaces: (none); snapshot timeout: 1500ms; max inline snapshot: 1048576 bytes'
    );
  });

  it('reports what was actually understood, after parsing and clamping', () => {
    expect(
      describeSsrConfig({
        APPFLOWY_SSR_KILL_SWITCH: ' Yes ',
        APPFLOWY_INDEXABLE_NAMESPACES: 'docs, ,guide',
        APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS: '99999',
        APPFLOWY_SSR_MAX_INLINE_BYTES: '4096',
      })
    ).toBe(
      'SSR kill switch: ON (SSR disabled); indexable namespaces: docs, guide; snapshot timeout: 5000ms; max inline snapshot: 4096 bytes'
    );
  });

  it('ignores a misspelled variable, so the summary shows it had no effect', () => {
    expect(describeSsrConfig({ APPFLOWY_SSR_KILLSWITCH: 'true' })).toContain('SSR kill switch: off');
  });
});
