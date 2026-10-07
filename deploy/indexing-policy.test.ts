/** @jest-environment node */

import { APP_PATHS } from './app-paths';
import {
  isKillSwitchOn,
  modeRendersBody,
  NOINDEX_DIRECTIVE,
  parseNamespaceAllowlist,
  readPublisherIndexingFlag,
  resolvePublishRenderMode,
} from './indexing-policy';

const resolve = (env: NodeJS.ProcessEnv, publishConfig?: unknown, namespace = 'docs') =>
  resolvePublishRenderMode({ namespace, publishName: 'page', publishConfig, env });

describe('resolvePublishRenderMode precedence', () => {
  it('1. kill switch → shell with no robots directive', () => {
    expect(resolve({ APPFLOWY_SSR_KILL_SWITCH: 'true' })).toEqual({
      mode: 'shell',
      reason: 'kill_switch',
      robots: null,
    });
  });

  it('2. publisher opted out → shell with noindex', () => {
    expect(resolve({}, { indexing_enabled: false })).toEqual({
      mode: 'shell',
      reason: 'publisher_opted_out',
      robots: NOINDEX_DIRECTIVE,
    });
  });

  it('3. publisher opted in → ssr-indexable', () => {
    expect(resolve({}, { indexing_enabled: true })).toEqual({
      mode: 'ssr-indexable',
      reason: 'publisher_opted_in',
      robots: null,
    });
  });

  it('4. namespace allowlisted → ssr-indexable', () => {
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: 'docs' })).toEqual({
      mode: 'ssr-indexable',
      reason: 'namespace_allowlist',
      robots: null,
    });
  });

  it('5. anything else → shell with no robots directive', () => {
    expect(resolve({})).toEqual({ mode: 'shell', reason: 'default_off', robots: null });
  });

  it('kill switch overrides an explicit publisher opt-in', () => {
    expect(resolve({ APPFLOWY_SSR_KILL_SWITCH: 'true' }, { indexing_enabled: true }).reason).toBe('kill_switch');
  });

  it('kill switch overrides the namespace allowlist', () => {
    expect(
      resolve({ APPFLOWY_SSR_KILL_SWITCH: 'true', APPFLOWY_INDEXABLE_NAMESPACES: 'docs' }).reason
    ).toBe('kill_switch');
  });

  it('publisher opt-out overrides the namespace allowlist', () => {
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: 'docs' }, { indexing_enabled: false }).reason).toBe(
      'publisher_opted_out'
    );
  });

  it('publisher opt-in works for a namespace that is not allowlisted', () => {
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: 'guide' }, { indexing_enabled: true }).mode).toBe(
      'ssr-indexable'
    );
  });

  it('never produces ssr-noindex from any input', () => {
    const envs: NodeJS.ProcessEnv[] = [
      {},
      { APPFLOWY_SSR_KILL_SWITCH: 'true' },
      { APPFLOWY_INDEXABLE_NAMESPACES: 'docs' },
    ];
    const configs = [undefined, null, {}, { indexing_enabled: true }, { indexing_enabled: false }];

    for (const env of envs) {
      for (const config of configs) {
        expect(resolve(env, config).mode).not.toBe('ssr-noindex');
      }
    }
  });
});

describe('malformed or missing publisher flag falls through', () => {
  it.each([
    ['undefined config', undefined],
    ['null config', null],
    ['empty config', {}],
    ['null flag', { indexing_enabled: null }],
    ['string "true"', { indexing_enabled: 'true' }],
    ['string "false"', { indexing_enabled: 'false' }],
    ['number 1', { indexing_enabled: 1 }],
    ['number 0', { indexing_enabled: 0 }],
    ['object flag', { indexing_enabled: {} }],
    ['config as string', '{"indexing_enabled":true}'],
    ['config as array', [true]],
    ['config as boolean', true],
    ['misspelled key', { indexingEnabled: true }],
  ])('%s → default_off, or allowlist when allowlisted', (_label, config) => {
    expect(resolve({}, config).reason).toBe('default_off');
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: 'docs' }, config).reason).toBe('namespace_allowlist');
  });
});

describe('namespace allowlist parsing', () => {
  it.each([
    [undefined, []],
    ['', []],
    ['   ', []],
    [' , ,', []],
    ['docs', ['docs']],
    ['docs,guide', ['docs', 'guide']],
    [' docs , guide ', ['docs', 'guide']],
    ['docs,,guide,', ['docs', 'guide']],
  ])('%p → %p', (raw, expected) => {
    expect(Array.from(parseNamespaceAllowlist(raw))).toEqual(expected);
  });

  it.each(['', '   ', ' , ,'])('empty allowlist %p enables nothing', (raw) => {
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: raw }).reason).toBe('default_off');
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: raw }, undefined, '').reason).toBe('default_off');
  });

  it('matches namespaces case-sensitively', () => {
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: 'docs' }, undefined, 'Docs').reason).toBe('default_off');
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: 'Docs' }, undefined, 'docs').reason).toBe('default_off');
  });

  it('does not match on prefixes or substrings', () => {
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: 'doc' }, undefined, 'docs').reason).toBe('default_off');
    expect(resolve({ APPFLOWY_INDEXABLE_NAMESPACES: 'docs,guide' }, undefined, 'docs,guide').reason).toBe(
      'default_off'
    );
  });
});

describe('kill switch parsing', () => {
  it.each(['true', 'TRUE', ' True ', '1', 'yes', 'on', 'ON'])('%p turns it on', (value) => {
    expect(isKillSwitchOn({ APPFLOWY_SSR_KILL_SWITCH: value })).toBe(true);
  });

  it.each([undefined, '', 'false', '0', 'no', 'off', 'enabled', 'truthy'])('%p leaves it off', (value) => {
    expect(isKillSwitchOn({ APPFLOWY_SSR_KILL_SWITCH: value })).toBe(false);
  });
});

describe('reserved namespaces', () => {
  it.each(APP_PATHS.map((appPath) => appPath.slice(1)))(
    'refuses to render app namespace %p even when allowlisted or opted in',
    (namespace) => {
      const env = { APPFLOWY_INDEXABLE_NAMESPACES: namespace };

      expect(resolve(env, undefined, namespace)).toEqual({ mode: 'shell', reason: 'reserved_namespace', robots: null });
      expect(resolve(env, { indexing_enabled: true }, namespace).mode).toBe('shell');
    }
  );
});

describe('helpers', () => {
  it('readPublisherIndexingFlag reads only real booleans', () => {
    expect(readPublisherIndexingFlag({ indexing_enabled: true })).toBe(true);
    expect(readPublisherIndexingFlag({ indexing_enabled: false })).toBe(false);
    expect(readPublisherIndexingFlag({ indexing_enabled: 'true' })).toBeUndefined();
  });

  it('modeRendersBody is true only for SSR modes', () => {
    expect(modeRendersBody('shell')).toBe(false);
    expect(modeRendersBody('ssr-indexable')).toBe(true);
    expect(modeRendersBody('ssr-noindex')).toBe(true);
  });
});
