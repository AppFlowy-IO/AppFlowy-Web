/**
 * The files of `__fixtures__/mention-eval/` other than the sessions: the ranker's expected rankings,
 * the verdict and the manifest, written byte for byte the same on every run. AppFlowy-Web holds the
 * canonical copy; Desktop keeps a byte-identical one in `frontend/resources/mention-eval/` and checks
 * the same `FIXTURES.sha256`.
 */
import { compareCodePoints } from '@/utils/normalize-text';

import {
  MENTION_EVAL_CONFIGURATIONS,
  MentionEvalConfiguration,
  MentionEvalMetrics,
  MENTION_EVAL_RR_UNIT,
  MentionEvalVerdict,
} from './metrics';
import { MENTION_EVAL_TOP, MentionEvalCase } from './replay';
import { MENTION_EVAL_VERSION, mentionEvalJson, mentionEvalJsonLines } from './sessions';

export const MENTION_EVAL_FIXTURE_DIR =
  'src/components/editor/components/panels/mention-panel/__fixtures__/mention-eval';
export const MENTION_EVAL_README = 'README.md';
export const MENTION_EVAL_SESSIONS = 'sessions.json';
export const MENTION_EVAL_RANKINGS = 'expected-rankings.json';
export const MENTION_EVAL_VERDICT = 'verdict.json';
export const MENTION_EVAL_MANIFEST = 'FIXTURES.sha256';
export const MENTION_EVAL_MANIFEST_HEADER =
  '# mention-eval v1: sha256 of every file here except this one, LC_ALL=C path order. Regenerate: see README.md';

/** One expected ranking: the pick's position, the prefix as typed, and the ranker's best ids. */
export type MentionEvalRanking = readonly [pick: number, prefix: string, top: readonly string[]];

export interface MentionEvalRankings {
  readonly version: number;
  readonly about: string;
  readonly sessions_sha256: string;
  readonly top: number;
  readonly cases: readonly MentionEvalRanking[];
}

const RANKINGS_ABOUT =
  'The client ranker with pick memory (MEN-X-07): its best ids for every replayed prefix of ' +
  'sessions.json. Written by AppFlowy-Web scripts/mention-eval (run-eval.mjs --write); Desktop must ' +
  'rank the same. Do not edit. See README.md.';
const VERDICT_ABOUT =
  'The replay gates of each configuration a ranking switch ships, and the metrics of every arm ' +
  '(MEN-X-07). Written by AppFlowy-Web scripts/mention-eval (run-eval.mjs --write); do not edit. ' +
  'Counts are integers; rr sums reciprocal ranks in units of 1/rr_unit. See README.md.';
const CONFIGURATION_ABOUT: Readonly<Record<MentionEvalConfiguration, string>> = {
  typeahead_v2:
    'mentionTypeaheadV2 on, pick memory off: the ranker without pick memory. Web ' +
    "MENTION_TYPEAHEAD_V2_DEFAULT, and Desktop's v2 switch once it exists (MEN-DESK-07, -08), may " +
    'default on only while it passes.',
  pick_memory:
    'Pick memory on: the ranker with pick memory, whose rankings expected-rankings.json records, ' +
    'also against the ranker without it. Web MENTION_PICK_MEMORY_DEFAULT and Desktop ' +
    'FeatureFlag.mentionPickMemory may default on only while it passes.',
};

/** `expected-rankings.json`: one case a line. */
export function serializeMentionEvalRankings(cases: readonly MentionEvalCase[], sessionsSha256: string): string {
  const rankings = cases.map((testCase): MentionEvalRanking => [testCase.pick, testCase.prefix, testCase.top.ranker]);

  return [
    '{',
    `  "version": ${MENTION_EVAL_VERSION},`,
    `  "about": ${mentionEvalJson(RANKINGS_ABOUT)},`,
    `  "sessions_sha256": ${mentionEvalJson(sessionsSha256)},`,
    `  "top": ${MENTION_EVAL_TOP},`,
    '  "cases": [',
    ...mentionEvalJsonLines(rankings, 4),
    '  ]',
    '}',
    '',
  ].join('\n');
}

export function parseMentionEvalRankings(text: string): MentionEvalRankings {
  const rankings = JSON.parse(text) as MentionEvalRankings;

  if (rankings.version !== MENTION_EVAL_VERSION) throw new Error(`rankings version ${String(rankings.version)}`);
  return rankings;
}

/**
 * `verdict.json`: each configuration's gates over the events' cases, then every arm's integer
 * counts, the probes' apart.
 */
export function serializeMentionEvalVerdict(
  verdict: MentionEvalVerdict,
  metrics: MentionEvalMetrics,
  probeMetrics: MentionEvalMetrics,
  sessionsSha256: string,
  rankingsSha256: string
): string {
  const document = {
    version: MENTION_EVAL_VERSION,
    about: VERDICT_ABOUT,
    sessions_sha256: sessionsSha256,
    rankings_sha256: rankingsSha256,
    configurations: Object.fromEntries(
      MENTION_EVAL_CONFIGURATIONS.map((name) => [
        name,
        { about: CONFIGURATION_ABOUT[name], ...verdict.configurations[name] },
      ])
    ),
    dart_typescript_parity:
      'AppFlowy-Premium frontend/appflowy_flutter/test/unit_test/mention_person/mention_eval_parity_test.dart',
    rr_unit: MENTION_EVAL_RR_UNIT,
    metrics,
    probe_metrics: probeMetrics,
  };

  return (
    JSON.stringify(document, null, 2).replace(
      /[\u007f-\uffff]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
    ) + '\n'
  );
}

/**
 * What the README's command writes: the header, then `<sha256>  <path>` for every file but the
 * manifest, in byte (`LC_ALL=C`) path order, each line ending in one newline.
 */
export function mentionEvalManifest(digests: readonly (readonly [path: string, sha256: string])[]): string {
  const lines = [...digests]
    .filter(([path]) => path !== MENTION_EVAL_MANIFEST)
    // UTF-8 byte order is code point order.
    .sort(([a], [b]) => compareCodePoints(a, b))
    .map(([path, sha256]) => `${sha256}  ${path}`);

  return [MENTION_EVAL_MANIFEST_HEADER, ...lines].join('\n') + '\n';
}
