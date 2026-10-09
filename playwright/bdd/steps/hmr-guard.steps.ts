/**
 * Opt-in guard for runs against a Vite dev server whose source tree is being
 * edited at the same time (local concurrent work, never CI): with
 * `APPFLOWY_TEST_BLOCK_HMR=1`, the scenario's page never connects to the dev
 * server's HMR socket, so an edit elsewhere cannot reload the page or swap a
 * React context module under a running scenario ("useAIChatContext must be
 * used within a AIChatProvider"). A fresh page load still gets the current
 * modules; only live updates are dropped. Pages the scenario opens in other
 * browser contexts (a teammate's) are not covered.
 */
import { createBdd } from 'playwright-bdd';

const { Before } = createBdd();

/** Vite's HMR client connects to `ws(s)://host/?token=…` (vite/dist/client/client.mjs). */
const VITE_HMR_SOCKET = /^wss?:\/\/[^/]+\/\?token=/;

Before(async ({ page }) => {
  if (process.env.APPFLOWY_TEST_BLOCK_HMR !== '1') return;
  // No `connectToServer()`: the page's socket opens against nothing and stays silent.
  await page.context().routeWebSocket(VITE_HMR_SOCKET, () => undefined);
});
