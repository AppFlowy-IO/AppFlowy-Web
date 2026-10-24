import { createBdd } from 'playwright-bdd';

import { waitForDashboardConditionsSync } from '../../support/dashboard-sync-helpers';

const { When } = createBdd();

When('I wait for the dashboard and widget conditions to reach the server', async ({ page, request }) => {
  await waitForDashboardConditionsSync(page, request);
});
