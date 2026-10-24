import { expect, type Page, type Response } from '@playwright/test';

/** Let the client's bounded RetryLater loop finish; never resend a command from the test. */
export async function waitForAtomicCreationCompletion(page: Page, path: string): Promise<Response> {
  const attempts: string[] = [];
  const response = await page.waitForResponse(
    async (result) => {
      if (result.request().method() !== 'POST' || !new URL(result.url()).pathname.endsWith(path)) return false;
      attempts.push(result.request().postData()!);
      const body = await result.json();

      return body.code !== -5;
    },
    { timeout: 30_000 }
  );
  const body = await response.json();

  expect(body.code, JSON.stringify(body)).toBe(0);
  expect(new Set(attempts).size, 'RetryLater must preserve the exact saved request').toBe(1);
  return response;
}

/** A readable newly synced Row may not yet have a durable source for atomic creation. */
export async function waitForRowBodyCompletion(page: Page): Promise<void> {
  await waitForAtomicCreationCompletion(page, '/v2/page-view/row-document');
}
