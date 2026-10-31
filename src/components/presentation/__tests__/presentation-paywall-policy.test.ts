import { aiMapUpgradeMessage, presentationCapabilities, presentationUpgradeRequired, slideCountLimitMessage } from '../presentation-policy';

import type { PresentationStatus } from '../server-contract';

const free = {
  plan: 'free', remainingSlides: 4, maxSlides: 4,
  usage: { freeSlides: 8, reservedSlides: 0, freeExports: 0, reservedExports: 1 },
  aiResponses: { metered: true, accountingReady: true, limit: 20, remaining: 0 },
} as PresentationStatus;

test('legacy Free status keeps slide, export and capability allowances independent', () => {
  expect(presentationCapabilities(free)).toMatchObject({ isPro: false, customSlideCount: false, mindmapStyles: false, companyStyles: false, remainingExports: 0, exportAvailable: false, maxExportSlides: 12 });
  expect(presentationCapabilities({ ...free, plan: 'paid' })).toMatchObject({ isPro: true, customSlideCount: true, remainingExports: null, exportAvailable: true });
  expect(presentationCapabilities(undefined)).toBeUndefined();
});

test('explicit server capabilities override plan fallbacks, including false and zero', () => {
  expect(presentationCapabilities({ ...free, plan: 'paid', isPro: false, remainingExports: 0, exportAvailable: false, maxExportSlides: 8,
    capabilities: { customSlideCount: true, mindmapStyles: false, companyStyles: false } })).toMatchObject({ isPro: false, customSlideCount: true, mindmapStyles: false, companyStyles: false, maxExportSlides: 8, exportAvailable: false });
  expect(presentationCapabilities({ ...free, remainingExports: null, exportAvailable: true })).toMatchObject({ remainingExports: null, exportAvailable: true });
});

test.each([
  [402, undefined, true], [402, false, false], [413, true, true], [413, undefined, false],
  [403, true, false], [429, true, false], [503, true, false], [409, true, false],
])('HTTP %i with upgradeRequired=%s classifies as %s', (status, upgradeRequired, expected) => {
  expect(presentationUpgradeRequired({ status, details: { upgradeRequired } })).toBe(expected);
});

test('known slide limits offer a smaller count and do not confuse deck count with slide allowance', () => {
  expect(slideCountLimitMessage(8, free)).toMatch(/4 slides remaining.*Auto or a smaller/);
  expect(slideCountLimitMessage(4, free)).toBeUndefined();
  expect(slideCountLimitMessage(0, { remainingSlides: 0, maxSlides: 0 })).toMatch(/Saved presentations/);
});

test('only authoritative exhausted AI usage offers an upgrade', () => {
  expect(aiMapUpgradeMessage(free)).toMatch(/no AI responses left/);
  for (const aiResponses of [{ accountingReady: false, retryable: true }, { metered: false }, { unlimited: true, accountingReady: true, limit: 20, remaining: 0 }, { accountingReady: true, limit: null, remaining: null }, { accountingReady: true, limit: 20, remaining: 1 }])
    expect(aiMapUpgradeMessage({ ...free, aiResponses })).toBeUndefined();
});
