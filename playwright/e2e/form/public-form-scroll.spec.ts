import { expect, test } from '@playwright/test';

const FORM_TOKEN = 'c6c31f9b-c334-4e3a-be20-79f661d4ad87';

test('respondents can reach the end of a long form', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });

  const questions = Array.from({ length: 40 }, (_, index) => ({
    id: `q-${index}`,
    label: `Question ${index + 1}`,
    kind: 'checkbox',
    required: false,
    long_answer: false,
    input_style: 'auto',
  }));

  await page.route(`**/api/workspace/public-form/${FORM_TOKEN}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'active',
        form_id: FORM_TOKEN,
        tier: 'public',
        anonymous: true,
        title: 'Long form',
        questions,
        submit_label: 'Submit',
        submit_color: 'primary',
        confirmation_title: 'Thanks',
        allow_another_response: false,
        hide_branding: false,
      }),
    });
  });

  await page.goto(`/form/${FORM_TOKEN}`, { waitUntil: 'domcontentloaded' });

  const scroller = page.getByTestId('public-form-scroll-container');
  const submit = page.getByTestId('public-form-submit');

  await expect(page.getByTestId('public-form-question-q-39')).toBeVisible();
  await expect(submit).toBeAttached();
  await expect(submit).not.toBeInViewport();

  const metrics = await scroller.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));

  expect(['auto', 'scroll']).toContain(metrics.overflowY);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  await scroller.hover();
  await page.mouse.wheel(0, metrics.scrollHeight);

  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByTestId('public-form-question-q-39')).toBeInViewport();
  await expect(submit).toBeInViewport();
});
