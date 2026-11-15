import { expect } from '@playwright/test';

import { dragCalendarEventToCell } from '../../support/dashboard-template-2-helpers';
import { fixtureHTML, test } from '../../support/integrations-server';

test('calendar drag scrolls a clipped next-week day into the widget before dropping', async ({ page, integrationsURL }) => {
  await page.route('**/calendar-drag-fixture', (route) => route.fulfill({
    contentType: 'text/html',
    body: fixtureHTML('calendar-event-drag'),
  }));
  await page.goto(new URL('/calendar-drag-fixture', integrationsURL).href);
  const source = page.locator('.fc-daygrid-day[data-date="2026-11-14"] .fc-event');
  const target = page.locator('.fc-daygrid-day[data-date="2026-11-15"]');

  await expect(source).toBeInViewport({ timeout: 60_000 });
  await expect(target).not.toBeInViewport();
  await dragCalendarEventToCell(page, source, target);

  await expect(page.getByTestId('dropped-date')).toHaveText('2026-11-15');
  await expect(target.locator('.fc-event')).toHaveText(/Customer story: Hooli/);
});
