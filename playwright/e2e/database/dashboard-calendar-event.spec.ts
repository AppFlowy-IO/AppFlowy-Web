import { expect, test } from '@playwright/test';

import { openCalendarPopoverRow } from '../../support/dashboard-template-2-helpers';

for (const writable of [true, false]) {
  const mode = writable ? 'writable' : 'read-only';

  test(`${mode} calendar popover opens its row without duplicating the event`, async ({ page }) => {
    const title = 'Customer story: Hooli';

    await page.setContent(`
      <div data-radix-popper-content-wrapper>
        <div class="sticky">
          ${writable ? '<button data-testid="calendar-event-delete">Delete</button>' : ''}
          <button data-testid="calendar-event-open-peek">Open side peek</button>
          ${writable ? '<button data-testid="calendar-event-duplicate">Duplicate</button>' : ''}
          <button id="close">Close</button>
        </div>
        <div class="event-properties">${title}</div>
      </div>
      <output id="duplicates">0</output>
      <script>
        document.querySelector('[data-testid="calendar-event-open-peek"]').addEventListener('click', () => {
          const row = document.createElement('section');
          row.dataset.testid = 'row-detail';
          row.dataset.peekMode = 'side';
          const title = document.createElement('div');
          title.dataset.testid = 'row-title-input';
          title.textContent = ${JSON.stringify(title)};
          row.append(title);
          document.body.append(row);
          document.querySelector('[data-radix-popper-content-wrapper]').remove();
        });
        document.querySelector('[data-testid="calendar-event-duplicate"]')?.addEventListener('click', () => {
          document.querySelector('#duplicates').textContent = '1';
        });
      </script>
    `);
    await openCalendarPopoverRow(page, title);

    await expect(page.getByTestId('row-detail')).toBeVisible();
    await expect(page.getByTestId('row-title-input')).toHaveText(title);
    await expect(page.locator('#duplicates')).toHaveText('0');
  });
}
