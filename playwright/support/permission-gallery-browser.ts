import { Browser, BrowserContext } from '@playwright/test';

import { GalleryConfig, GalleryFixture, GalleryPerson, refreshGallerySession } from './permission-gallery-seed';

/**
 * Browser sessions of the permission gallery: the network guard and session setup that the
 * screenshot spec (permission-gallery.capture.spec.ts) and the video spec
 * (permission-videos.capture.spec.ts) share, so both run with the same isolation.
 */

/** Abort every request outside the gallery stack's three origins. */
export async function guardGalleryNetwork(context: BrowserContext, cfg: GalleryConfig) {
  const allowed = new Set([cfg.web, cfg.cloud, cfg.gotrue]);

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    // The dev server proxies these paths to developer ports; the app must only use the gallery stack.
    const devProxy = url.origin === cfg.web && /^\/(api|ws|gotrue|s3|billing)(\/|$)/.test(url.pathname);

    if (!allowed.has(url.origin) || devProxy) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

/**
 * The live connection of a browser session. While `muted`, what the server pushes (including
 * permission change hints) is held back, so the app only learns of a change when it asks itself.
 */
export type GalleryRealtime = { muted: boolean };

export interface GalleryContextOptions {
  viewport: { width: number; height: number };
  realtime?: GalleryRealtime;
  /** Open without a stored session, so the person signs in on the login screen. */
  signedOut?: boolean;
  /** Record a video of every page of the context (Playwright's recordVideo). */
  recordVideo?: { dir: string; size: { width: number; height: number } };
}

/**
 * A browser context for one person, before any page is open: requests outside the stack are
 * aborted, the app's runtime config points at the stack, and (unless `signedOut`) a fresh GoTrue
 * password grant is stored as the app's session, as in the permission lifecycle harness.
 */
export async function newGalleryContext(
  browser: Browser,
  cfg: GalleryConfig,
  fixture: GalleryFixture,
  person: GalleryPerson,
  options: GalleryContextOptions
) {
  const auth = options.signedOut ? null : (await refreshGallerySession(cfg, fixture.people[person])).auth;
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: 1,
    ...(options.recordVideo ? { recordVideo: options.recordVideo } : {}),
  });

  await guardGalleryNetwork(context, cfg);
  const realtime = options.realtime;

  if (realtime) {
    // Relay the socket both ways, except that server pushes are dropped while muted.
    await context.routeWebSocket(() => true, (socket) => {
      const server = socket.connectToServer();

      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        if (!realtime.muted) socket.send(message);
      });
    });
  }

  await context.addInitScript(
    ({ auth, cloud, gotrue }) => {
      (window as Window & { __APP_CONFIG__?: Record<string, string> }).__APP_CONFIG__ = {
        APPFLOWY_BASE_URL: cloud,
        APPFLOWY_GOTRUE_BASE_URL: gotrue,
        APPFLOWY_WS_BASE_URL: `${cloud.replace(/^http/, 'ws')}/ws/v2`,
      };
      if (auth) localStorage.setItem('token', JSON.stringify(auth));
    },
    { auth, cloud: cfg.cloud, gotrue: cfg.gotrue }
  );
  return context;
}
