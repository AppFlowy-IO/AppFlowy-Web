/**
 * @jest-environment node
 */
import { MENTION_PICK_MEMORY_DEFAULT } from '@/components/editor/components/panels/mention-panel/mentionPickMemory';
import { MENTION_TYPEAHEAD_V2_DEFAULT } from '@/components/editor/components/panels/mention-panel/mentionTypeaheadFlag';

import {
  MENTION_EVAL_SWITCHES,
  MENTION_EVAL_WEB_DEFAULTS,
  mentionEvalBlockedDefaults,
  MentionEvalGuardedVerdict,
} from '../guard';
import {
  MENTION_EVAL_BUCKETS,
  MENTION_EVAL_CONFIGURATION_ARMS,
  MENTION_EVAL_CONFIGURATIONS,
  MENTION_EVAL_RR_UNIT,
  mentionEvalBucket,
  mentionEvalCellText,
  mentionEvalMetrics,
  mentionEvalRank,
  mentionEvalReciprocalRank,
  mentionEvalVerdict,
  MentionEvalVerdict,
} from '../metrics';
import { MENTION_EVAL_ARMS, MentionEvalArm, MentionEvalCase, MentionEvalRankerArm } from '../replay';

interface CaseSpec {
  codePoints?: number;
  section?: MentionEvalCase['section'];
  cjk?: boolean;
  exactTitle?: MentionEvalCase['exactTitle'];
  tierOrderViolations?: number | Partial<Record<MentionEvalRankerArm, number>>;
  top?: Partial<Record<MentionEvalArm, string[]>>;
}

let picks = 0;

/**
 * A case whose target is `t`; every arm lists nothing unless `top` says otherwise, and the ranker
 * without pick memory ranks as the one with it, as do the tier violations, unless told apart.
 */
function testCase({
  codePoints = 2,
  section = 'pages',
  cjk = false,
  exactTitle,
  tierOrderViolations = 0,
  top = {},
}: CaseSpec): MentionEvalCase {
  const violations =
    typeof tierOrderViolations === 'number'
      ? { ranker: tierOrderViolations, ranker_no_picks: tierOrderViolations }
      : { ranker: 0, ranker_no_picks: 0, ...tierOrderViolations };

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
    top: { ranker: [], mru: [], substring: [], ...top, ranker_no_picks: top.ranker_no_picks ?? top.ranker ?? [] },
    tierOrderViolations: violations,
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
  const passed = (verdict: MentionEvalVerdict) =>
    MENTION_EVAL_CONFIGURATIONS.map((name) => [name, verdict.configurations[name].passed]);

  it('grade mentionTypeaheadV2 alone without pick memory, and pick memory with it against its control', () => {
    expect(MENTION_EVAL_CONFIGURATIONS).toEqual(['typeahead_v2', 'pick_memory']);
    expect(MENTION_EVAL_CONFIGURATION_ARMS).toEqual({
      typeahead_v2: { arm: 'ranker_no_picks' },
      pick_memory: { arm: 'ranker', control: 'ranker_no_picks' },
    });

    const { configurations } = mentionEvalVerdict(passing());

    expect([configurations.typeahead_v2.arm, configurations.pick_memory.arm]).toEqual(['ranker_no_picks', 'ranker']);
    expect(Object.keys(configurations.typeahead_v2.gates)).toEqual([
      'mrr_at_least_mru',
      'unique_exact_title_hit_at_1',
      'no_t0_t1_title_below_t3_t4',
    ]);
    expect(Object.keys(configurations.pick_memory.gates)).toEqual([
      'mrr_at_least_mru',
      'unique_exact_title_hit_at_1',
      'no_t0_t1_title_below_t3_t4',
      'hit_at_1_within_0_5_pp_of_control',
    ]);
  });

  it('pass when the ranker is at least MRU in every bucket, unique exact titles are first and tiers hold', () => {
    const verdict = mentionEvalVerdict(passing());

    expect(passed(verdict)).toEqual([
      ['typeahead_v2', true],
      ['pick_memory', true],
    ]);
    MENTION_EVAL_CONFIGURATIONS.forEach((name) => {
      const { gates, informational } = verdict.configurations[name];

      expect(gates.mrr_at_least_mru.buckets.map((bucket) => [bucket.bucket, bucket.passed])).toEqual(
        MENTION_EVAL_BUCKETS.map((bucket) => [bucket, true])
      );
      // Equal MRR passes: "at least".
      expect(gates.mrr_at_least_mru.buckets[2]).toEqual({
        bucket: '3',
        cases: 1,
        ranker_rr: 420,
        mru_rr: 420,
        passed: true,
      });
      expect(gates.unique_exact_title_hit_at_1).toEqual({ passed: true, cases: 1, hits: 1, failures: [] });
      expect(gates.no_t0_t1_title_below_t3_t4).toEqual({ passed: true, cases: 5, violations: 0, failures: [] });
      // A shared exact title second is reported, not gated.
      expect(informational.duplicate_exact_title_hit_at_1).toEqual({ cases: 1, hits: 0 });
    });
    expect(verdict.configurations.pick_memory.gates.hit_at_1_within_0_5_pp_of_control).toMatchObject({
      passed: true,
      control: 'ranker_no_picks',
    });
  });

  it('fail the MRR gate when the ranker is below MRU in one bucket only', () => {
    const verdict = mentionEvalVerdict([...passing(), testCase({ codePoints: 2, top: { ranker: at(3), mru: at(1) } })]);

    expect(passed(verdict)).toEqual([
      ['typeahead_v2', false],
      ['pick_memory', false],
    ]);

    const { gates } = verdict.configurations.typeahead_v2;

    expect(gates.mrr_at_least_mru.passed).toBe(false);
    expect(gates.mrr_at_least_mru.buckets.filter((bucket) => !bucket.passed).map((bucket) => bucket.bucket)).toEqual([
      '2',
    ]);
    expect(gates.unique_exact_title_hit_at_1.passed).toBe(true);
    expect(gates.no_t0_t1_title_below_t3_t4.passed).toBe(true);
  });

  it('fail only mentionTypeaheadV2 alone when the ranker passes with pick memory and not without it', () => {
    // With pick memory the target is first, as for MRU; without it, it is third: below MRU in 7+.
    const verdict = mentionEvalVerdict([
      ...passing(),
      testCase({ codePoints: 7, top: { ranker: at(1), ranker_no_picks: at(3), mru: at(1) } }),
    ]);

    expect(passed(verdict)).toEqual([
      ['typeahead_v2', false],
      ['pick_memory', true],
    ]);
    expect(verdict.configurations.typeahead_v2.gates.mrr_at_least_mru.buckets[4]).toEqual({
      bucket: '7+',
      cases: 3,
      ranker_rr: 840 + 420 + 280,
      mru_rr: 840 + 840 + 280,
      passed: false,
    });
  });

  it('fail the exact title gate when a unique exact title is second', () => {
    const second = testCase({ codePoints: 4, exactTitle: 'unique', top: { ranker: at(2), mru: at(2) } });
    const verdict = mentionEvalVerdict([...passing(), second]);

    expect(passed(verdict)).toEqual([
      ['typeahead_v2', false],
      ['pick_memory', false],
    ]);
    expect(verdict.configurations.pick_memory.gates.unique_exact_title_hit_at_1).toEqual({
      passed: false,
      cases: 2,
      hits: 1,
      failures: [{ pick: second.pick, prefix: 'xxxx', target: 't', top: ['other', 't'] }],
    });
  });

  it("read each configuration's own ranking for the exact title gate", () => {
    const second = testCase({
      codePoints: 4,
      exactTitle: 'unique',
      top: { ranker: at(1), ranker_no_picks: ['v9', 'other', 't'], mru: at(2) },
    });
    const verdict = mentionEvalVerdict([...passing(), second]);

    expect(passed(verdict)).toEqual([
      ['typeahead_v2', false],
      ['pick_memory', true],
    ]);
    expect(verdict.configurations.typeahead_v2.gates.unique_exact_title_hit_at_1.failures).toEqual([
      { pick: second.pick, prefix: 'xxxx', target: 't', top: ['v9', 'other', 't'] },
    ]);
  });

  it('fail the exact title gate when no case has a unique exact title', () => {
    const verdict = mentionEvalVerdict(passing().filter((testCase) => testCase.exactTitle !== 'unique'));

    MENTION_EVAL_CONFIGURATIONS.forEach((name) => {
      expect(verdict.configurations[name].gates.unique_exact_title_hit_at_1).toMatchObject({ passed: false, cases: 0 });
    });
  });

  it('fail the tier gate when a T0 or T1 title comes after a T3 title', () => {
    const below = testCase({ codePoints: 4, tierOrderViolations: 2, top: { ranker: at(1) } });
    const verdict = mentionEvalVerdict([...passing(), below]);

    MENTION_EVAL_CONFIGURATIONS.forEach((name) => {
      const tiers = verdict.configurations[name].gates.no_t0_t1_title_below_t3_t4;

      expect(verdict.configurations[name].passed).toBe(false);
      expect(tiers).toMatchObject({ passed: false, violations: 2 });
      expect(tiers.failures.map((failure) => failure.pick)).toEqual([below.pick]);
    });
  });

  it("count each configuration's own tier violations", () => {
    const below = testCase({ codePoints: 4, tierOrderViolations: { ranker_no_picks: 1 }, top: { ranker: at(1) } });
    const verdict = mentionEvalVerdict([...passing(), below]);

    expect(passed(verdict)).toEqual([
      ['typeahead_v2', false],
      ['pick_memory', true],
    ]);
    expect(verdict.configurations.typeahead_v2.gates.no_t0_t1_title_below_t3_t4.violations).toBe(1);
    expect(verdict.configurations.pick_memory.gates.no_t0_t1_title_below_t3_t4.violations).toBe(0);
  });

  it("fail pick memory alone when it lowers a bucket's hit@1 more than 0.5 pp below the ranking without it", () => {
    // 200 cases of 7+ that the ranking without pick memory always ranks first, and MRU never lists.
    const sevens = (lost: number) =>
      Array.from({ length: 200 }, (_, index) =>
        testCase({ codePoints: 8, top: { ranker: at(index < lost ? 2 : 1), ranker_no_picks: at(1) } })
      );
    const verdict = (lost: number) => mentionEvalVerdict([...passing(), ...sevens(lost)]);
    const sevenPlus = (lost: number) =>
      verdict(lost).configurations.pick_memory.gates.hit_at_1_within_0_5_pp_of_control?.buckets[4];

    // One hit fewer in 202 cases is below 0.5 pp; two are about 1 pp.
    expect(passed(verdict(1))).toEqual([
      ['typeahead_v2', true],
      ['pick_memory', true],
    ]);
    expect(sevenPlus(1)).toEqual({ bucket: '7+', cases: 202, hit1: 200, control_hit1: 201, passed: true });
    expect(passed(verdict(2))).toEqual([
      ['typeahead_v2', true],
      ['pick_memory', false],
    ]);
    expect(sevenPlus(2)).toEqual({ bucket: '7+', cases: 202, hit1: 199, control_hit1: 201, passed: false });
    // Pick memory passes MRU's gates all the same.
    expect(verdict(2).configurations.pick_memory.gates.mrr_at_least_mru.passed).toBe(true);
  });

  it('allow a drop of exactly 0.5 pp, and any gain, against the control', () => {
    // 200 cases in 4-6: the control ranks 100 first, pick memory 99 (exactly 0.5 pp), or 150.
    const fours = (hits: number) =>
      Array.from({ length: 200 }, (_, index) =>
        testCase({ codePoints: 4, top: { ranker: at(index < hits ? 1 : 2), ranker_no_picks: at(index < 100 ? 1 : 2) } })
      );
    const control = (hits: number) =>
      mentionEvalVerdict(fours(hits)).configurations.pick_memory.gates.hit_at_1_within_0_5_pp_of_control;

    expect(control(99)?.buckets[3]).toEqual({ bucket: '4-6', cases: 200, hit1: 99, control_hit1: 100, passed: true });
    expect(control(98)?.buckets[3]).toMatchObject({ hit1: 98, passed: false });
    expect(control(150)?.passed).toBe(true);
  });
});

describe('mention eval switch guard', () => {
  const cases = () => [
    testCase({ codePoints: 1, top: { ranker: at(1), mru: at(2) } }),
    testCase({ codePoints: 2, exactTitle: 'unique', top: { ranker: at(1), mru: at(1) } }),
  ];
  const on = (typeahead_v2: boolean, pick_memory: boolean) => ({ typeahead_v2, pick_memory });

  it('refuses mentionTypeaheadV2 on by default when only the ranking with pick memory passes', () => {
    // Without pick memory the target falls to third, below MRU in bucket 1.
    const verdict = mentionEvalVerdict([
      ...cases(),
      testCase({ codePoints: 1, top: { ranker: at(1), ranker_no_picks: at(3), mru: at(1) } }),
    ]);

    expect(verdict.configurations.pick_memory.passed).toBe(true);
    expect(verdict.configurations.typeahead_v2.passed).toBe(false);
    expect(mentionEvalBlockedDefaults(verdict, on(true, false))).toEqual(['typeahead_v2']);
    expect(mentionEvalBlockedDefaults(verdict, on(true, true))).toEqual(['typeahead_v2']);
    expect(mentionEvalBlockedDefaults(verdict, on(false, true))).toEqual([]);
    expect(mentionEvalBlockedDefaults(verdict, on(false, false))).toEqual([]);
  });

  it('refuses pick memory on by default when it falls more than 0.5 pp behind the ranking without it', () => {
    // Both rankings beat MRU, but pick memory loses the first place of the one 7+ case.
    const verdict = mentionEvalVerdict([
      ...cases(),
      testCase({ codePoints: 7, top: { ranker: at(2), ranker_no_picks: at(1) } }),
    ]);

    expect(verdict.configurations.typeahead_v2.passed).toBe(true);
    expect(verdict.configurations.pick_memory.gates.mrr_at_least_mru.passed).toBe(true);
    expect(verdict.configurations.pick_memory.passed).toBe(false);
    expect(mentionEvalBlockedDefaults(verdict, on(false, true))).toEqual(['pick_memory']);
    expect(mentionEvalBlockedDefaults(verdict, on(true, true))).toEqual(['pick_memory']);
    expect(mentionEvalBlockedDefaults(verdict, on(true, false))).toEqual([]);
  });

  it('allows every switch while each configuration passes', () => {
    expect(mentionEvalBlockedDefaults(mentionEvalVerdict(cases()), on(true, true))).toEqual([]);
  });

  it('reads verdict.json as written, and treats a configuration it lacks as failing', () => {
    const written = JSON.parse(JSON.stringify(mentionEvalVerdict(cases()))) as MentionEvalGuardedVerdict;

    expect(mentionEvalBlockedDefaults(written, on(true, true))).toEqual([]);
    expect(mentionEvalBlockedDefaults({ configurations: { pick_memory: { passed: true } } }, on(true, true))).toEqual([
      'typeahead_v2',
    ]);
    // The first verdict.json held one `passed` for both switches.
    const single = JSON.parse('{"passed": true}') as MentionEvalGuardedVerdict;

    expect(mentionEvalBlockedDefaults(single, on(true, true))).toEqual(['typeahead_v2', 'pick_memory']);
    expect(
      mentionEvalBlockedDefaults({ configurations: { typeahead_v2: { passed: 'true' } } }, on(true, false))
    ).toEqual(['typeahead_v2']);
  });

  it("guards Web's two ranking switches", () => {
    expect(MENTION_EVAL_SWITCHES).toEqual({
      typeahead_v2: 'MENTION_TYPEAHEAD_V2_DEFAULT',
      pick_memory: 'MENTION_PICK_MEMORY_DEFAULT',
    });
    expect(MENTION_EVAL_WEB_DEFAULTS).toEqual({
      typeahead_v2: MENTION_TYPEAHEAD_V2_DEFAULT,
      pick_memory: MENTION_PICK_MEMORY_DEFAULT,
    });
  });
});
