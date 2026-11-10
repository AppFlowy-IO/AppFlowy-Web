import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { mentionEvalBlockedDefaults, MENTION_EVAL_WEB_DEFAULTS } from '../../../../../../../scripts/mention-eval/guard';

import { mentionParityByteRuleViolations } from './mention-parity-helpers';

/**
 * The client ranker replay's folder (MEN-X-07): written by `scripts/mention-eval/run-eval.mjs`, whose
 * CI job checks the rankings are current, and copied byte for byte to Desktop's
 * `frontend/resources/mention-eval/`, whose Dart test replays them. This checks the folder itself:
 * its manifest, its byte rules, that its files agree with each other, and that no ranking switch
 * defaults on while the configuration it ships fails the replay's gates.
 */
const DIR = join(__dirname, '..', '__fixtures__', 'mention-eval');
const MANIFEST = 'FIXTURES.sha256';
const MANIFEST_HEADER =
  '# mention-eval v1: sha256 of every file here except this one, LC_ALL=C path order. Regenerate: see README.md';

const read = (name: string) => readFileSync(join(DIR, name));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

interface Rankings {
  version: number;
  sessions_sha256: string;
  top: number;
  cases: [number, string, string[]][];
}

interface Verdict {
  version: number;
  sessions_sha256: string;
  rankings_sha256: string;
  configurations: Record<string, { arm: string; passed: boolean; gates: Record<string, { passed: boolean }> }>;
}

interface Sessions {
  views: { id: string }[];
  people: { id: string }[];
  events: unknown[][];
  probes: unknown[][];
}

describe('mention-eval fixtures', () => {
  const files = readdirSync(DIR).sort();
  const sessions = JSON.parse(read('sessions.json').toString('utf8')) as Sessions;
  const rankings = JSON.parse(read('expected-rankings.json').toString('utf8')) as Rankings;
  const verdict = JSON.parse(read('verdict.json').toString('utf8')) as Verdict;

  it('hold the sessions, the rankings, the verdict, the README and the manifest', () => {
    expect(files).toEqual([MANIFEST, 'README.md', 'expected-rankings.json', 'sessions.json', 'verdict.json']);
  });

  it('match their FIXTURES.sha256 manifest', () => {
    const expected =
      [
        MANIFEST_HEADER,
        ...files.filter((name) => name !== MANIFEST).map((name) => `${sha256(read(name))}  ${name}`),
      ].join('\n') + '\n';
    const committed = read(MANIFEST).toString('utf8');

    if (committed !== expected) {
      throw new Error(`${MANIFEST} does not match the files. They now give:\n${expected}`);
    }
  });

  it.each(files)('%s follows the byte rules and is ASCII', (name) => {
    const bytes = read(name);

    expect(mentionParityByteRuleViolations(name, bytes)).toEqual([]);
    expect(bytes.every((byte) => byte === 0x0a || (byte >= 0x20 && byte <= 0x7e))).toBe(true);
  });

  it('are each described by the README', () => {
    const readme = read('README.md').toString('utf8');

    files.forEach((name) => expect([name, readme.includes(`\`${name}\``)]).toEqual([name, true]));
  });

  it('rank the sessions they were written for, every pick of the events and the probes', () => {
    const ids = new Set([...sessions.views.map((view) => view.id), ...sessions.people.map((person) => person.id)]);
    const picks = [...sessions.events, ...sessions.probes].filter((event) => event[1] === 'pick').length;

    expect(rankings.version).toBe(1);
    expect(rankings.sessions_sha256).toBe(sha256(read('sessions.json')));
    expect(rankings.top).toBe(8);
    expect(new Set(rankings.cases.map(([pick]) => pick)).size).toBe(picks);
    rankings.cases.forEach(([pick, prefix, top], index) => {
      expect(index === 0 || pick >= rankings.cases[index - 1][0]).toBe(true);
      expect(prefix.length).toBeGreaterThan(0);
      expect(top.length).toBeLessThanOrEqual(8);
      expect(new Set(top).size).toBe(top.length);
      top.forEach((id) => expect([id, ids.has(id)]).toEqual([id, true]));
    });
  });

  it('give the verdict of those rankings for each configuration a switch ships', () => {
    const gates = ['mrr_at_least_mru', 'unique_exact_title_hit_at_1', 'no_t0_t1_title_below_t3_t4'];
    const configurations = Object.entries(verdict.configurations).map(([name, configuration]) => [
      name,
      configuration.arm,
      Object.keys(configuration.gates),
      configuration.passed === Object.values(configuration.gates).every((gate) => gate.passed === true),
    ]);

    expect(verdict.version).toBe(1);
    expect(verdict.sessions_sha256).toBe(rankings.sessions_sha256);
    expect(verdict.rankings_sha256).toBe(sha256(read('expected-rankings.json')));
    expect(configurations).toEqual([
      ['typeahead_v2', 'ranker_no_picks', gates, true],
      ['pick_memory', 'ranker', [...gates, 'hit_at_1_within_0_5_pp_of_control'], true],
    ]);
  });

  it('let mentionTypeaheadV2 and pick memory default on only while the configuration each ships passes', () => {
    expect(mentionEvalBlockedDefaults(verdict, MENTION_EVAL_WEB_DEFAULTS)).toEqual([]);
  });
});
