import { expect, type Page } from '@playwright/test';

/** A readable newly synced Row may not yet have a durable source for atomic creation. */
export async function waitForRowBodyCompletion(page: Page): Promise<void> {
  const attempts: string[] = [];
  const response = await page.waitForResponse(
    async (result) => {
      if (result.request().method() !== 'POST' || !result.url().endsWith('/v2/page-view/row-document')) return false;
      attempts.push(result.request().postData()!);
      const body = await result.json();

      return body.code !== -5;
    },
    { timeout: 30_000 }
  );
  const body = await response.json();

  expect(body.code, JSON.stringify(body)).toBe(0);
  expect(new Set(attempts).size, 'RetryLater must preserve the exact saved request').toBe(1);
}
