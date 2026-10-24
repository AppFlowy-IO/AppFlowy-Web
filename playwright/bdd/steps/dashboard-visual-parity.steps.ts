/**
 * Dashboard visual parity (VISUAL-PARITY.md §6, L2/L4). The wording is shared
 * with the desktop integration test, which measures the same contract
 * (VISUAL-PARITY.md §6.2). Each scenario writes `web-<state>.json` for
 * `scripts/dashboard-parity/compare-visual-parity.mjs` into
 * `DASHBOARD_PARITY_REPORT` (default `test-results/dashboard-parity`).
 */
import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { runOptionsFromEnv } from '../../../src/application/database-yjs/visual-parity';
import { cleanupDashboardFixture } from '../../support/dashboard-test-helpers';
import {
  blockingFailures,
  parityStateFromWords,
  ParityStateResult,
  reportExists,
  runDashboardParityState,
  seedCanonicalParityDashboard,
} from '../../support/dashboard-visual-parity';

const { Given, When, Then, Before, After } = createBdd();

/** Seeding builds four databases and seven views; measuring walks every scene of the contract. */
const PARITY_TIMEOUT_MS = 1_200_000;

const results = new WeakMap<Page, Map<string, ParityStateResult>>();

function resultFor(page: Page, mode: string, theme: string): ParityStateResult {
  const state = parityStateFromWords(mode, theme);
  const result = results.get(page)?.get(state);

  if (!result) throw new Error(`The dashboard parity scenes have not been measured in ${mode} mode with the ${theme} theme`);
  return result;
}

Before({ tags: '@dashboard-visual-parity' }, async ({ page, $testInfo }) => {
  $testInfo.setTimeout(PARITY_TIMEOUT_MS);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

After({ tags: '@dashboard-visual-parity' }, async ({ page, request }) => {
  await cleanupDashboardFixture(page, request);
});

Given('the canonical dashboard visual parity fixture is open', async ({ page, request }) => {
  await seedCanonicalParityDashboard(page, request);
});

When(
  'I measure every dashboard parity scene in {word} mode with the {word} theme',
  async ({ page, request, $testInfo }, mode: string, theme: string) => {
    const result = await runDashboardParityState(page, request, parityStateFromWords(mode, theme));

    if (!results.has(page)) results.set(page, new Map());
    results.get(page)?.set(result.state, result);
    await $testInfo.attach(`web-${result.state}.json`, { path: result.reportPath, contentType: 'application/json' });
    await $testInfo.attach(`web-${result.state}.png`, { path: result.screenshotPath, contentType: 'image/png' });
  }
);

Then(
  'every enforced dashboard style metric matches the shared tokens in {word} mode with the {word} theme',
  async ({ page }, mode: string, theme: string) => {
    expect(blockingFailures(resultFor(page, mode, theme), 'metric')).toEqual([]);
  }
);

Then(
  'every enforced dashboard element order matches the shared contract in {word} mode with the {word} theme',
  async ({ page }, mode: string, theme: string) => {
    expect(blockingFailures(resultFor(page, mode, theme), 'order')).toEqual([]);
  }
);

Then(
  'every enforced dashboard text matches the shared contract in {word} mode with the {word} theme',
  async ({ page }, mode: string, theme: string) => {
    expect(blockingFailures(resultFor(page, mode, theme), 'text')).toEqual([]);
  }
);

Then(
  'every enforced dashboard icon renders its canonical glyph in {word} mode with the {word} theme',
  async ({ page }, mode: string, theme: string) => {
    expect(blockingFailures(resultFor(page, mode, theme), 'icon')).toEqual([]);
  }
);

Then(
  'the dashboard parity report for {word} mode with the {word} theme is written',
  async ({ page }, mode: string, theme: string) => {
    const result = resultFor(page, mode, theme);

    expect(reportExists(result.reportPath)).toBe(true);
    expect(reportExists(result.screenshotPath)).toBe(true);
    // Report mode measures every pending entry; enforce mode may have nothing in scope yet.
    if (runOptionsFromEnv(process.env).includePending) expect(result.rows.length).toBeGreaterThan(0);
  }
);
