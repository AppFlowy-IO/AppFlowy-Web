/**
 * Metrics and gates of the @-mention replay (MEN-X-07), in exact integer arithmetic.
 *
 * Each case's target rank in each arm's best eight gives hit@1, hit@3 and its reciprocal rank,
 * counted per prefix bucket (`1`, `2`, `3`, `4-6`, `7+` code points of the normalized prefix, as
 * MEN-X-04 buckets the server), per lane (people, objects) and per script (CJK or not). Reciprocal
 * ranks are summed in units of 1/840, the least common multiple of 1 to 8, so every sum is an
 * integer and MRR comparisons are exact. A target outside the best eight counts 0 (MRR@8).
 *
 * The gates decide whether `mentionTypeaheadV2` and pick memory may default on:
 * 1. the ranker's MRR is at least MRU's in every bucket;
 * 2. a page or database whose title the prefix matches exactly, and no other title does, is the
 *    ranker's first (unique exact title hit@1 = 100%, as MEN-X-04's ship gate);
 * 3. no T0 or T1 title ranks below a T3 or T4 title;
 * 4. Desktop's ranker gives the same rankings, which its own test checks against
 *    `expected-rankings.json`.
 */
import { MENTION_EVAL_ARMS, MENTION_EVAL_TOP, MentionEvalArm, MentionEvalCase } from './replay';

export const MENTION_EVAL_BUCKETS = ['1', '2', '3', '4-6', '7+'] as const;
export type MentionEvalBucket = (typeof MENTION_EVAL_BUCKETS)[number];
export const MENTION_EVAL_LANES = ['people', 'objects'] as const;
export type MentionEvalLane = (typeof MENTION_EVAL_LANES)[number];
export const MENTION_EVAL_SCRIPTS = ['latin', 'cjk'] as const;
export type MentionEvalScript = (typeof MENTION_EVAL_SCRIPTS)[number];

/** The least common multiple of 1 to 8: a reciprocal rank `1/r` is `840 / r` units. */
export const MENTION_EVAL_RR_UNIT = 840;
/** At most this many failing cases are listed per gate. */
export const MENTION_EVAL_MAX_LISTED = 20;

/** The bucket of a prefix of `codePoints` normalized code points. */
export function mentionEvalBucket(codePoints: number): MentionEvalBucket {
  if (codePoints <= 1) return '1';
  if (codePoints === 2) return '2';
  if (codePoints === 3) return '3';
  return codePoints <= 6 ? '4-6' : '7+';
}

/** The 1-based rank of `target` in `top`, or `undefined` when it is not there. */
export function mentionEvalRank(top: readonly string[], target: string): number | undefined {
  const index = top.indexOf(target);

  return index === -1 ? undefined : index + 1;
}

/** The reciprocal rank in units of 1/{@link MENTION_EVAL_RR_UNIT}: 0 beyond the best eight. */
export function mentionEvalReciprocalRank(rank: number | undefined): number {
  return rank === undefined || rank > MENTION_EVAL_TOP ? 0 : MENTION_EVAL_RR_UNIT / rank;
}

/** Counts of one group of cases. `rr` is the sum of reciprocal ranks in 1/840. */
export interface MentionEvalCell {
  cases: number;
  hit1: number;
  hit3: number;
  rr: number;
}

export interface MentionEvalArmMetrics {
  all: MentionEvalCell;
  buckets: Record<MentionEvalBucket, MentionEvalCell>;
  lanes: Record<MentionEvalLane, Record<MentionEvalBucket, MentionEvalCell>>;
  scripts: Record<MentionEvalScript, Record<MentionEvalBucket, MentionEvalCell>>;
}

export type MentionEvalMetrics = Record<MentionEvalArm, MentionEvalArmMetrics>;

function emptyCell(): MentionEvalCell {
  return { cases: 0, hit1: 0, hit3: 0, rr: 0 };
}

function bucketCells(): Record<MentionEvalBucket, MentionEvalCell> {
  return Object.fromEntries(MENTION_EVAL_BUCKETS.map((bucket) => [bucket, emptyCell()])) as Record<
    MentionEvalBucket,
    MentionEvalCell
  >;
}

function add(cell: MentionEvalCell, rank: number | undefined): void {
  cell.cases += 1;
  if (rank === 1) cell.hit1 += 1;
  if (rank !== undefined && rank <= 3) cell.hit3 += 1;
  cell.rr += mentionEvalReciprocalRank(rank);
}

export function mentionEvalLane(testCase: MentionEvalCase): MentionEvalLane {
  return testCase.section === 'people' ? 'people' : 'objects';
}

/** Every arm's counts, overall and per bucket, lane and script. */
export function mentionEvalMetrics(cases: readonly MentionEvalCase[]): MentionEvalMetrics {
  const metrics = {} as MentionEvalMetrics;

  MENTION_EVAL_ARMS.forEach((arm) => {
    const armMetrics: MentionEvalArmMetrics = {
      all: emptyCell(),
      buckets: bucketCells(),
      lanes: { people: bucketCells(), objects: bucketCells() },
      scripts: { latin: bucketCells(), cjk: bucketCells() },
    };

    cases.forEach((testCase) => {
      const rank = mentionEvalRank(testCase.top[arm], testCase.target);
      const bucket = mentionEvalBucket(testCase.codePoints);

      add(armMetrics.all, rank);
      add(armMetrics.buckets[bucket], rank);
      add(armMetrics.lanes[mentionEvalLane(testCase)][bucket], rank);
      add(armMetrics.scripts[testCase.cjk ? 'cjk' : 'latin'][bucket], rank);
    });
    metrics[arm] = armMetrics;
  });
  return metrics;
}

/** A case as the gates list it. */
export interface MentionEvalListedCase {
  pick: number;
  prefix: string;
  target: string;
  /** The ranker's best ids, or the first ones. */
  ranker: readonly string[];
}

export interface MentionEvalBucketGate {
  bucket: MentionEvalBucket;
  cases: number;
  /** Sums of reciprocal ranks in 1/840 over the bucket's cases. */
  ranker_rr: number;
  mru_rr: number;
  passed: boolean;
}

export interface MentionEvalVerdict {
  /** Every gate the replay decides holds; Dart parity is Desktop's test. */
  passed: boolean;
  mrr_at_least_mru: { passed: boolean; buckets: MentionEvalBucketGate[] };
  unique_exact_title_hit_at_1: {
    passed: boolean;
    cases: number;
    hits: number;
    failures: MentionEvalListedCase[];
  };
  no_t0_t1_title_below_t3_t4: {
    passed: boolean;
    /** Page and database cases checked over the ranker's whole order. */
    cases: number;
    violations: number;
    failures: MentionEvalListedCase[];
  };
  /** Not a gate: an exact title that other titles share has several T0 candidates. */
  duplicate_exact_title_hit_at_1: { cases: number; hits: number };
}

function listed(testCase: MentionEvalCase): MentionEvalListedCase {
  return {
    pick: testCase.pick,
    prefix: testCase.prefix,
    target: testCase.target,
    ranker: testCase.top.ranker.slice(0, 3),
  };
}

/** The gates (see the module header) over `cases` and their `metrics`. */
export function mentionEvalVerdict(
  cases: readonly MentionEvalCase[],
  metrics: MentionEvalMetrics = mentionEvalMetrics(cases)
): MentionEvalVerdict {
  const buckets = MENTION_EVAL_BUCKETS.map((bucket): MentionEvalBucketGate => {
    const ranker = metrics.ranker.buckets[bucket];
    const mru = metrics.mru.buckets[bucket];

    return { bucket, cases: ranker.cases, ranker_rr: ranker.rr, mru_rr: mru.rr, passed: ranker.rr >= mru.rr };
  });
  const unique = cases.filter((testCase) => testCase.exactTitle === 'unique');
  const uniqueFailures = unique.filter((testCase) => testCase.top.ranker[0] !== testCase.target);
  const duplicates = cases.filter((testCase) => testCase.exactTitle === 'duplicate');
  const objects = cases.filter((testCase) => testCase.section !== 'people');
  const tierFailures = objects.filter((testCase) => testCase.tierOrderViolations > 0);
  const violations = tierFailures.reduce((sum, testCase) => sum + testCase.tierOrderViolations, 0);
  const mrr = { passed: buckets.every((bucket) => bucket.passed), buckets };
  const exact = {
    passed: unique.length > 0 && uniqueFailures.length === 0,
    cases: unique.length,
    hits: unique.length - uniqueFailures.length,
    failures: uniqueFailures.slice(0, MENTION_EVAL_MAX_LISTED).map(listed),
  };
  const tiers = {
    passed: objects.length > 0 && violations === 0,
    cases: objects.length,
    violations,
    failures: tierFailures.slice(0, MENTION_EVAL_MAX_LISTED).map(listed),
  };

  return {
    passed: mrr.passed && exact.passed && tiers.passed,
    mrr_at_least_mru: mrr,
    unique_exact_title_hit_at_1: exact,
    no_t0_t1_title_below_t3_t4: tiers,
    duplicate_exact_title_hit_at_1: {
      cases: duplicates.length,
      hits: duplicates.filter((testCase) => testCase.top.ranker[0] === testCase.target).length,
    },
  };
}

/** `numerator / denominator` with `digits` decimals, for display only. */
export function mentionEvalRatio(numerator: number, denominator: number, digits = 3): string {
  return denominator === 0 ? '-' : (numerator / denominator).toFixed(digits);
}

/** A cell's hit@1, hit@3 and MRR@8, for display only. */
export function mentionEvalCellText(cell: MentionEvalCell): { hit1: string; hit3: string; mrr: string } {
  return {
    hit1: mentionEvalRatio(cell.hit1, cell.cases),
    hit3: mentionEvalRatio(cell.hit3, cell.cases),
    mrr: mentionEvalRatio(cell.rr, cell.cases * MENTION_EVAL_RR_UNIT),
  };
}
