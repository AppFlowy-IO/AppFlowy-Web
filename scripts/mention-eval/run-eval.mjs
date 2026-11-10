#!/usr/bin/env node
// @-mention client ranker replay and TypeScript/Dart parity gate (MEN-X-07).
//
// Generates the seeded sessions (sessions.ts), replays every prefix of every pick through the
// production ranker with pick memory, the same ranker without pick memory, MRU and today's
// substring filter (replay.ts), and grades them (metrics.ts). The TypeScript modules, the
// production ranker and pick memory among them, are bundled in memory with the esbuild that Vite
// ships, so the replay runs in plain Node and nothing is copied.
//
// The files it writes, and checks, are in
// src/components/editor/components/panels/mention-panel/__fixtures__/mention-eval/ (README.md there
// explains them). Desktop keeps a byte-identical copy and checks that its Dart ranker gives the same
// expected-rankings.json.
//
// Run with --help for usage.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `@-mention client ranker replay (MEN-X-07)

Usage:
  node scripts/mention-eval/run-eval.mjs [--check | --write] [options]

Modes:
  --check            (default) Regenerate everything in memory and fail when a committed file of
                     the fixture folder differs: run --write and commit the result.
  --write            Rewrite sessions.json, expected-rankings.json, verdict.json and FIXTURES.sha256.

Options:
  --require-gate     Fail when a gate fails. Without it, a failing gate fails the run only while
                     mentionTypeaheadV2 or pick memory defaults on.
  --report <file>    Also write a JSON report: the verdict, every metric and example cases where the
                     ranker and MRU disagree on the first result.
  --copy-to <dir>    Also write the whole folder, README included, into <dir>, such as Desktop's
                     frontend/resources/mention-eval.
  --fixtures <dir>   The fixture folder. Default: this repository's.

Exit code: 0 passed, 1 stale files or an enforced gate failed, 2 bad arguments or an internal error.`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(ROOT, 'scripts', 'mention-eval', 'index.ts');

function parseArgs(argv) {
  const options = { mode: 'check', requireGate: false, report: undefined, copyTo: undefined, fixtures: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];

      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--check') options.mode = 'check';
    else if (arg === '--write') options.mode = 'write';
    else if (arg === '--require-gate') options.requireGate = true;
    else if (arg === '--report') options.report = resolve(value());
    else if (arg === '--copy-to') options.copyTo = resolve(value());
    else if (arg === '--fixtures') options.fixtures = resolve(value());
    else throw new Error(`unknown argument ${arg}`);
  }

  return options;
}

/** esbuild: a direct dependency if there is one, else the one Vite depends on. */
function loadEsbuild() {
  const require = createRequire(import.meta.url);

  try {
    return require('esbuild');
  } catch {
    return createRequire(require.resolve('vite/package.json'))('esbuild');
  }
}

/** The harness and the production modules it imports, bundled in memory and imported. */
async function loadHarness() {
  const esbuild = loadEsbuild();
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    tsconfig: join(ROOT, 'tsconfig.json'),
    logLevel: 'error',
  });

  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function row(label, cells) {
  return `  ${label.padEnd(22)}${cells.map((cell) => cell.padStart(8)).join('')}`;
}

const ARM_LABELS = {
  ranker: 'ranker (with picks)',
  ranker_no_picks: 'ranker (no picks)',
  mru: 'MRU',
  substring: 'substring (today)',
};

function tables(h, metrics) {
  const header = row('', [...h.MENTION_EVAL_BUCKETS, 'all']);
  const lines = [];
  const metric = (name, pick) => {
    lines.push(`${name} by prefix bucket`, header);
    h.MENTION_EVAL_ARMS.forEach((arm) => {
      const cells = h.MENTION_EVAL_BUCKETS.map((bucket) => pick(h.mentionEvalCellText(metrics[arm].buckets[bucket])));

      lines.push(row(ARM_LABELS[arm], [...cells, pick(h.mentionEvalCellText(metrics[arm].all))]));
    });
    lines.push('');
  };

  metric('MRR@8', (text) => text.mrr);
  metric('hit@1', (text) => text.hit1);
  metric('hit@3', (text) => text.hit3);
  h.MENTION_EVAL_LANES.forEach((lane) => {
    lines.push(`MRR@8 of ${lane} by prefix bucket`, row('', h.MENTION_EVAL_BUCKETS));
    h.MENTION_EVAL_ARMS.forEach((arm) => {
      lines.push(
        row(
          ARM_LABELS[arm],
          h.MENTION_EVAL_BUCKETS.map((bucket) => h.mentionEvalCellText(metrics[arm].lanes[lane][bucket]).mrr)
        )
      );
    });
    lines.push('');
  });
  lines.push(
    `cases by bucket: ${h.MENTION_EVAL_BUCKETS.map(
      (bucket) => `${bucket}: ${metrics.ranker.buckets[bucket].cases}`
    ).join(', ')}`
  );
  return lines;
}

function gateLines(h, verdict) {
  const mrr = (rr, cases) => h.mentionEvalRatio(rr, cases * h.MENTION_EVAL_RR_UNIT);
  const mark = (passed) => (passed ? '[pass]' : '[FAIL]');
  const { mrr_at_least_mru: bucketGate, unique_exact_title_hit_at_1: exact } = verdict;
  const tiers = verdict.no_t0_t1_title_below_t3_t4;
  const duplicates = verdict.duplicate_exact_title_hit_at_1;

  return [
    'Gates (mentionTypeaheadV2 and pick memory may default on only when all pass):',
    `  ${mark(bucketGate.passed)} MRR@8 at least MRU's in every bucket: ${bucketGate.buckets
      .map(
        (bucket) =>
          `${bucket.bucket} ${mrr(bucket.ranker_rr, bucket.cases)} ${bucket.passed ? '>=' : '<'} ${mrr(
            bucket.mru_rr,
            bucket.cases
          )}`
      )
      .join('; ')}`,
    `  ${mark(exact.passed)} unique exact title hit@1 = 100%: ${exact.hits}/${exact.cases}`,
    `  ${mark(tiers.passed)} no T0 or T1 title below a T3 or T4 title: ${tiers.violations} in ${tiers.cases} cases`,
    '  [....] identical Dart and TypeScript rankings: Desktop mention_eval_parity_test.dart',
    `  (not a gate) duplicate exact title hit@1: ${duplicates.hits}/${duplicates.cases}`,
  ];
}

/** Up to `limit` cases per bucket where one arm ranks the target first and the other does not. */
function disagreements(h, sessions, cases, limit = 10) {
  const titles = new Map([
    ...sessions.views.map((view) => [view.id, view.title]),
    ...sessions.people.map((person) => [person.id, person.name || person.email]),
  ]);
  const describe = (testCase) => ({
    pick: testCase.pick,
    prefix: testCase.prefix,
    section: testCase.section,
    target: `${testCase.target} ${titles.get(testCase.target)}`,
    ranker: testCase.top.ranker.slice(0, 3).map((id) => `${id} ${titles.get(id)}`),
    mru: testCase.top.mru.slice(0, 3).map((id) => `${id} ${titles.get(id)}`),
  });
  const examples = {};

  h.MENTION_EVAL_BUCKETS.forEach((bucket) => {
    const inBucket = cases.filter((testCase) => h.mentionEvalBucket(testCase.codePoints) === bucket);
    const first = (testCase, arm) => testCase.top[arm][0] === testCase.target;

    examples[bucket] = {
      mru_first_only: inBucket
        .filter((testCase) => first(testCase, 'mru') && !first(testCase, 'ranker'))
        .slice(0, limit)
        .map(describe),
      ranker_first_only: inBucket
        .filter((testCase) => first(testCase, 'ranker') && !first(testCase, 'mru'))
        .slice(0, limit)
        .map(describe),
    };
  });
  return examples;
}

function stepSummary(h, metrics, verdict, stale) {
  const file = process.env.GITHUB_STEP_SUMMARY;

  if (!file) return;

  const head = `| arm | ${h.MENTION_EVAL_BUCKETS.join(' | ')} | all |`;
  const rule = `|---|${h.MENTION_EVAL_BUCKETS.map(() => '---:').join('|')}|---:|`;
  const lines = [
    '## @-mention replay (MEN-X-07)',
    '',
    `Verdict: ${verdict.passed ? 'every replay gate passes' : 'a replay gate fails'}.`,
    '',
  ];

  lines.push('MRR@8 by prefix bucket', '', head, rule);
  h.MENTION_EVAL_ARMS.forEach((arm) => {
    const cells = h.MENTION_EVAL_BUCKETS.map((bucket) => h.mentionEvalCellText(metrics[arm].buckets[bucket]).mrr);

    lines.push(`| ${ARM_LABELS[arm]} | ${cells.join(' | ')} | ${h.mentionEvalCellText(metrics[arm].all).mrr} |`);
  });
  lines.push('', '```', ...gateLines(h, verdict), '```', '');
  if (stale.length > 0)
    lines.push(`Stale files: ${stale.join(', ')}. Run \`node scripts/mention-eval/run-eval.mjs --write\`.`, '');
  appendFileSync(file, `${lines.join('\n')}\n`);
}

async function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${HELP}`);
    return 2;
  }

  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const h = await loadHarness();
  const fixtures = options.fixtures ?? join(ROOT, h.MENTION_EVAL_FIXTURE_DIR);
  const readmePath = join(fixtures, h.MENTION_EVAL_README);

  if (!existsSync(readmePath)) {
    console.error(`${relative(ROOT, readmePath)} is missing: the folder needs its README.`);
    return 2;
  }

  const started = performance.now();
  const sessionsText = h.serializeMentionEvalSessions(h.generateMentionEvalSessions());
  const sessions = h.parseMentionEvalSessions(sessionsText);
  const cases = h.replayMentionEvalSessions(sessions);
  // The gates grade the user's behavior; the probes are there for the parity check.
  const graded = cases.filter((testCase) => testCase.replay === 'events');
  const probes = cases.filter((testCase) => testCase.replay === 'probes');
  const metrics = h.mentionEvalMetrics(graded);
  const probeMetrics = h.mentionEvalMetrics(probes);
  const verdict = h.mentionEvalVerdict(graded, metrics);
  const sessionsSha = sha256(sessionsText);
  const rankingsText = h.serializeMentionEvalRankings(cases, sessionsSha);
  const verdictText = h.serializeMentionEvalVerdict(verdict, metrics, probeMetrics, sessionsSha, sha256(rankingsText));
  const readme = readFileSync(readmePath, 'utf8');
  const generated = {
    [h.MENTION_EVAL_SESSIONS]: sessionsText,
    [h.MENTION_EVAL_RANKINGS]: rankingsText,
    [h.MENTION_EVAL_VERDICT]: verdictText,
  };
  const manifest = h.mentionEvalManifest(
    [[h.MENTION_EVAL_README, readme], ...Object.entries(generated)].map(([path, text]) => [path, sha256(text)])
  );

  generated[h.MENTION_EVAL_MANIFEST] = manifest;

  const stale = [];

  if (options.mode === 'write') {
    Object.entries(generated).forEach(([path, text]) => writeFileSync(join(fixtures, path), text));
  } else {
    Object.entries(generated).forEach(([path, text]) => {
      const file = join(fixtures, path);

      if (!existsSync(file) || readFileSync(file, 'utf8') !== text) stale.push(path);
    });
  }

  if (options.copyTo) {
    mkdirSync(options.copyTo, { recursive: true });
    Object.entries({ [h.MENTION_EVAL_README]: readme, ...generated }).forEach(([path, text]) =>
      writeFileSync(join(options.copyTo, path), text)
    );
  }

  const picks = sessions.events.filter((event) => event[1] === 'pick').length;
  const probePicks = sessions.probes.filter((event) => event[1] === 'pick').length;
  const people = graded.filter((testCase) => testCase.section === 'people').length;
  const probeText = (arm) => h.mentionEvalCellText(probeMetrics[arm].all).mrr;

  console.log(
    `@-mention replay (MEN-X-07): ${picks} picks, ${graded.length} graded cases (people ${people}, ` +
      `objects ${graded.length - people}); ${probePicks} probe picks, ${probes.length} cases for parity only; ` +
      `${Math.round(performance.now() - started)} ms\n`
  );
  console.log(
    [
      ...tables(h, metrics),
      `probes (not graded), MRR@8: ranker ${probeText('ranker')}, MRU ${probeText('mru')}, ` +
        `substring ${probeText('substring')}`,
      '',
      ...gateLines(h, verdict),
    ].join('\n')
  );

  if (options.report) {
    mkdirSync(dirname(options.report), { recursive: true });
    writeFileSync(
      options.report,
      `${JSON.stringify(
        { verdict, metrics, probeMetrics, disagreements: disagreements(h, sessions, graded) },
        null,
        2
      )}\n`
    );
    console.log(`\nreport: ${options.report}`);
  }

  stepSummary(h, metrics, verdict, stale);

  const defaultsOn = [
    h.MENTION_TYPEAHEAD_V2_DEFAULT ? 'MENTION_TYPEAHEAD_V2_DEFAULT' : undefined,
    h.MENTION_PICK_MEMORY_DEFAULT ? 'MENTION_PICK_MEMORY_DEFAULT' : undefined,
  ].filter(Boolean);
  let failed = false;

  if (stale.length > 0) {
    console.error(
      `\nStale: ${stale.join(', ')} in ${relative(ROOT, fixtures)}. Run ` +
        '`node scripts/mention-eval/run-eval.mjs --write`, commit the folder and copy it byte for byte ' +
        'to Desktop (frontend/resources/mention-eval, see the README).'
    );
    failed = true;
  }

  if (verdict.passed) {
    console.log('\nVerdict: every replay gate passes; Desktop parity is checked by its own test.');
  } else if (options.requireGate || defaultsOn.length > 0) {
    console.error(
      `\nVerdict: a replay gate fails${defaultsOn.length > 0 ? ` while ${defaultsOn.join(' and ')} is on` : ''}.`
    );
    failed = true;
  } else {
    console.log('\nVerdict: a replay gate fails, so mentionTypeaheadV2 and pick memory must stay off by default.');
  }

  return failed ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 2;
  }
);
