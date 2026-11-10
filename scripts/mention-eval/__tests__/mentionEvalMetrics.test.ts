/**
 * @jest-environment node
 */
import {
  MENTION_EVAL_BUCKETS,
  MENTION_EVAL_RR_UNIT,
  mentionEvalBucket,
  mentionEvalCellText,
  mentionEvalMetrics,
  mentionEvalRank,
  mentionEvalReciprocalRank,
  mentionEvalVerdict,
} from '../metrics';
import { MENTION_EVAL_ARMS, MentionEvalArm, MentionEvalCase } from '../replay';

interface CaseSpec {
  codePoints?: number;
  section?: MentionEvalCase['section'];
  cjk?: boolean;
  exactTitle?: MentionEvalCase['exactTitle'];
  tierOrderViolations?: number;
  top?: Partial<Record<MentionEvalArm, string[]>>;
}

let picks = 0;

/** A case whose target is `t`; every arm lists nothing unless `top` says otherwise. */
function testCase({
  codePoints = 2,
  section = 'pages',
  cjk = false,
  exactTitle,
  tierOrderViolations = 0,
  top = {},
}: CaseSpec): MentionEvalCase {
  picks += 1;
  return {
    replay: 'events',
    pick: picks,
    prefix: 'x'.repeat(codePoints),
    codePoints,
    cjk,
    section,
    target: 't',
    exactTitle,
    top: { ranker: [], ranker_no_picks: [], mru: [], substring: [], ...top },
    tierOrderViolations,
  };
}

const at = (rank: number) => [...Array(rank - 1).fill('other'), 't'];

describe('mention eval metrics', () => {
  it('buckets prefixes by their normalized code points', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 40].map(mentionEvalBucket)).toEqual(['1', '2', '3', '4-6', '4-6', '4-6', '7+', '7+']);
    expect(MENTION_EVAL_BUCKETS).toEqual(['1', '2', '3', '4-6', '7+']);
  });

  it('ranks from 1 and gives exact reciprocal ranks in 1/840 within the best eight', () => {
    expect(mentionEvalRank(['a', 't', 'b'], 't')).toBe(2);
    expect(mentionEvalRank(['a', 'b'], 't')).toBeUndefined();
    expect(MENTION_EVAL_RR_UNIT).toBe(840);
    for (let rank = 1; rank <= 8; rank += 1) {
      expect(Number.isInteger(mentionEvalReciprocalRank(rank))).toBe(true);
      expect(mentionEvalReciprocalRank(rank) * rank).toBe(840);
    }

    expect(mentionEvalReciprocalRank(9)).toBe(0);
    expect(mentionEvalReciprocalRank(undefined)).toBe(0);
  });

  it('counts hit@1, hit@3 and reciprocal ranks per arm, bucket, lane and script', () => {
    const metrics = mentionEvalMetrics([
      testCase({ codePoints: 1, section: 'people', top: { ranker: at(1), mru: at(2) } }),
      testCase({ codePoints: 1, section: 'pages', top: { ranker: at(3), mru: at(9) } }),
      testCase({ codePoints: 5, section: 'databases', cjk: true, top: { ranker: at(4), substring: at(1) } }),
    ]);

    expect(metrics.ranker.all).toEqual({ cases: 3, hit1: 1, hit3: 2, rr: 840 + 280 + 210 });
    expect(metrics.ranker.buckets['1']).toEqual({ cases: 2, hit1: 1, hit3: 2, rr: 1120 });
    expect(metrics.ranker.buckets['4-6']).toEqual({ cases: 1, hit1: 0, hit3: 0, rr: 210 });
    expect(metrics.ranker.buckets['7+']).toEqual({ cases: 0, hit1: 0, hit3: 0, rr: 0 });
    expect(metrics.ranker.lanes.people['1']).toEqual({ cases: 1, hit1: 1, hit3: 1, rr: 840 });
    expect(metrics.ranker.lanes.objects['1']).toEqual({ cases: 1, hit1: 0, hit3: 1, rr: 280 });
    expect(metrics.ranker.lanes.objects['4-6'].cases).toBe(1);
    expect(metrics.ranker.scripts.cjk['4-6']).toEqual({ cases: 1, hit1: 0, hit3: 0, rr: 210 });
    expect(metrics.ranker.scripts.latin['1'].cases).toBe(2);
    // A target ninth is a miss, as one an arm does not list.
    expect(metrics.mru.all).toEqual({ cases: 3, hit1: 0, hit3: 1, rr: 420 });
    expect(metrics.substring.all).toEqual({ cases: 3, hit1: 1, hit3: 1, rr: 840 });
    expect(Object.keys(metrics)).toEqual([...MENTION_EVAL_ARMS]);
    expect(mentionEvalCellText(metrics.ranker.all)).toEqual({ hit1: '0.333', hit3: '0.667', mrr: '0.528' });
    expect(mentionEvalCellText(metrics.ranker.buckets['7+'])).toEqual({ hit1: '-', hit3: '-', mrr: '-' });
  });
});

describe('mention eval gates', () => {
  const passing = () => [
    testCase({ codePoints: 1, top: { ranker: at(1), mru: at(2) } }),
    testCase({ codePoints: 2, exactTitle: 'unique', top: { ranker: at(1), mru: at(1) } }),
    testCase({ codePoints: 3, section: 'people', top: { ranker: at(2), mru: at(2) } }),
    testCase({ codePoints: 5, top: { ranker: at(1) } }),
    testCase({ codePoints: 9, exactTitle: 'duplicate', top: { ranker: at(2), mru: at(1) } }),
    testCase({ codePoints: 9, top: { ranker: at(1), mru: at(3) } }),
  ];

  it('pass when the ranker is at least MRU in every bucket, unique exact titles are first and tiers hold', () => {
    const verdict = mentionEvalVerdict(passing());

    expect(verdict.passed).toBe(true);
    expect(verdict.mrr_at_least_mru.buckets.map((bucket) => [bucket.bucket, bucket.passed])).toEqual(
      MENTION_EVAL_BUCKETS.map((bucket) => [bucket, true])
    );
    // Equal MRR passes: "at least".
    expect(verdict.mrr_at_least_mru.buckets[2]).toEqual({
      bucket: '3',
      cases: 1,
      ranker_rr: 420,
      mru_rr: 420,
      passed: true,
    });
    expect(verdict.unique_exact_title_hit_at_1).toEqual({ passed: true, cases: 1, hits: 1, failures: [] });
    expect(verdict.no_t0_t1_title_below_t3_t4).toEqual({ passed: true, cases: 5, violations: 0, failures: [] });
    // A shared exact title second is reported, not gated.
    expect(verdict.duplicate_exact_title_hit_at_1).toEqual({ cases: 1, hits: 0 });
  });

  it('fail the MRR gate when the ranker is below MRU in one bucket only', () => {
    const verdict = mentionEvalVerdict([...passing(), testCase({ codePoints: 2, top: { ranker: at(3), mru: at(1) } })]);

    expect(verdict.passed).toBe(false);
    expect(verdict.mrr_at_least_mru.passed).toBe(false);
    expect(verdict.mrr_at_least_mru.buckets.filter((bucket) => !bucket.passed).map((bucket) => bucket.bucket)).toEqual([
      '2',
    ]);
    expect(verdict.unique_exact_title_hit_at_1.passed).toBe(true);
    expect(verdict.no_t0_t1_title_below_t3_t4.passed).toBe(true);
  });

  it('fail the exact title gate when a unique exact title is second', () => {
    const second = testCase({ codePoints: 4, exactTitle: 'unique', top: { ranker: at(2), mru: at(2) } });
    const verdict = mentionEvalVerdict([...passing(), second]);

    expect(verdict.passed).toBe(false);
    expect(verdict.unique_exact_title_hit_at_1).toEqual({
      passed: false,
      cases: 2,
      hits: 1,
      failures: [{ pick: second.pick, prefix: 'xxxx', target: 't', ranker: ['other', 't'] }],
    });
  });

  it('fail the exact title gate when no case has a unique exact title', () => {
    const verdict = mentionEvalVerdict(passing().filter((testCase) => testCase.exactTitle !== 'unique'));

    expect(verdict.unique_exact_title_hit_at_1.passed).toBe(false);
    expect(verdict.unique_exact_title_hit_at_1.cases).toBe(0);
  });

  it('fail the tier gate when a T0 or T1 title comes after a T3 title', () => {
    const below = testCase({ codePoints: 4, tierOrderViolations: 2, top: { ranker: at(1) } });
    const verdict = mentionEvalVerdict([...passing(), below]);

    expect(verdict.passed).toBe(false);
    expect(verdict.no_t0_t1_title_below_t3_t4).toMatchObject({ passed: false, violations: 2 });
    expect(verdict.no_t0_t1_title_below_t3_t4.failures.map((failure) => failure.pick)).toEqual([below.pick]);
  });
});
