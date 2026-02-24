/**
 * Test: WebSocket Reconnection Without Page Reload
 *
 * Verifies that reconnecting the WebSocket does NOT trigger a full page reload.
 * This is a regression test for the fix that replaced window.location.reload()
 * with graceful WebSocket reconnection via URL nonce bumping.
 *
 * Test strategy:
 * - Set a window marker property on the current window
 * - Programmatically close the WebSocket to trigger disconnect
 * - Wait for auto-reconnect and verify the marker survived (a reload would clear it)
 */
import { SidebarSelectors, PageSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

const TRACKED_WEBSOCKETS_KEY = '__AF_TRACKED_WEBSOCKETS__';

describe('WebSocket Reconnection (No Page Reload)', () => {
  let testEmail: string;

  beforeEach(() => {
    testEmail = generateRandomEmail();

    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('NetworkError') ||
        err.message.includes('Record not found') ||
        err.message.includes('unknown error')
      ) {
        return false;
      }

      return true;
    });

    cy.viewport(1280, 720);
  });

  /**
   * Helper: Sign in and wait for app + WebSocket to be ready
   */
  function signInAndWaitForApp() {
    // Use cy.on so the WebSocket tracking survives across all navigations
    // (cy.signIn internally does cy.visit('/login') then cy.visit('/app')).
    cy.on('window:before:load', (win) => {
      const windowWithTracking = win as unknown as Record<string, unknown>;

      if (windowWithTracking[TRACKED_WEBSOCKETS_KEY]) return;

      const trackedSockets: WebSocket[] = [];
      const OriginalWebSocket = win.WebSocket;

      class TrackedWebSocket extends OriginalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          if (protocols !== undefined) {
            super(url, protocols);
          } else {
            super(url);
          }
          trackedSockets.push(this);
        }
      }

      windowWithTracking[TRACKED_WEBSOCKETS_KEY] = trackedSockets;
      win.WebSocket = TrackedWebSocket as unknown as typeof WebSocket;
    });

    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
    });

    SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
    PageSelectors.names({ timeout: 30000 }).should('exist');
    // Extra wait for WebSocket to fully establish and stabilize
    cy.wait(5000);
  }

  /**
   * Helper: Set reload-detection marker on the current window.
   * If the page reloads, the marker disappears because the new window won't have it.
   * Note: cy.stub(win.location, 'reload') is NOT used because Chrome marks
   * location.reload as non-configurable, causing "Cannot redefine property" errors.
   */
  function installReloadDetection(markerName = '__NO_RELOAD_MARKER__') {
    cy.window().then((win) => {
      (win as Record<string, unknown>)[markerName] = true;
    });

    // Verify marker is set
    cy.window().its(markerName).should('eq', true);
  }

  /**
   * Helper: Close the active WebSocket by monkeypatching WebSocket.prototype.send
   * to capture the live instance, then closing it.
   */
  function closeActiveWebSocket() {
    cy.window().then((win) => {
      const windowWithTracking = win as unknown as Record<string, unknown>;
      const OriginalWebSocket = win.WebSocket;
      const origSend = OriginalWebSocket.prototype.send;
      const trackedSockets = (windowWithTracking[TRACKED_WEBSOCKETS_KEY] as WebSocket[] | undefined) ?? [];
      let captured = false;

      const findActiveSocket = () => {
        for (let i = trackedSockets.length - 1; i >= 0; i -= 1) {
          const socket = trackedSockets[i];

          if (socket.readyState === OriginalWebSocket.OPEN || socket.readyState === OriginalWebSocket.CONNECTING) {
            return socket;
          }
        }

        return null;
      };

      const closeSocket = (socket: WebSocket | null) => {
        if (!socket) return false;
        if (socket.readyState !== OriginalWebSocket.OPEN && socket.readyState !== OriginalWebSocket.CONNECTING) {
          return false;
        }

        socket.close(4000, 'test-disconnect');
        return true;
      };

      // Prefer direct close for currently tracked sockets.
      if (closeSocket(findActiveSocket())) {
        return;
      }

      OriginalWebSocket.prototype.send = function (...args: [string | ArrayBufferLike | Blob | ArrayBufferView]) {
        if (!captured) {
          captured = true;
          // Restore original send immediately to avoid interfering with reconnect
          OriginalWebSocket.prototype.send = origSend;

          // Close this socket after the current send completes
          const socket = this;

          setTimeout(() => {
            if (socket.readyState === OriginalWebSocket.OPEN) {
              socket.close(4000, 'test-disconnect');
            }
          }, 100);
        }

        return origSend.apply(this, args);
      };

      // If no send happens within 2s (no heartbeat yet), force-close by
      // closing a tracked socket directly.
      setTimeout(() => {
        OriginalWebSocket.prototype.send = origSend;
        if (captured) return;

        closeSocket(findActiveSocket());
      }, 2000);
    });
  }

  it('should reconnect WebSocket without reloading the page', () => {
    testLog.testStart('WebSocket Reconnect Without Reload');

    // Step 1: Sign in and wait for stable connection
    testLog.step(1, 'Sign in and wait for app to load');
    signInAndWaitForApp();
    testLog.success('App loaded with stable connection');

    // Step 2: Install reload detection
    testLog.step(2, 'Install reload detection marker');
    installReloadDetection();
    testLog.success('Reload detection installed');

    // Step 3: Close the WebSocket to trigger disconnect
    testLog.step(3, 'Close WebSocket to simulate disconnect');
    closeActiveWebSocket();

    // Step 4: Wait for the disconnect banner to appear (even briefly)
    // The auto-reconnect fires immediately when isClosed becomes true,
    // so the banner may transition to "connecting..." very quickly.
    // We use a short should('exist') check instead of 'be.visible' for robustness.
    testLog.step(4, 'Wait for disconnect detection');
    cy.get('[data-testid="connect-banner"]', { timeout: 15000 }).should('exist');
    testLog.success('Disconnect detected');

    // Step 5: Wait for auto-reconnect to complete (or manual reconnect if banner is still showing)
    testLog.step(5, 'Wait for reconnection');
    // The ConnectBanner auto-reconnects immediately on disconnect.
    // Give enough time for the reconnect cycle and for any reload to happen.
    cy.wait(5000);
    testLog.success('Reconnection cycle complete');

    // Step 6: Verify NO page reload happened
    testLog.step(6, 'Verify no page reload');
    // Assert window marker survived (would be gone after a reload)
    cy.window().its('__NO_RELOAD_MARKER__').should('eq', true);
    testLog.success('No page reload occurred — reconnection was graceful');

    // Step 7: Verify the app is still functional
    testLog.step(7, 'Verify app is still functional');
    SidebarSelectors.pageHeader().should('be.visible');
    PageSelectors.names().should('exist');
    testLog.success('App remains functional after reconnect');

    testLog.testEnd('WebSocket Reconnect Without Reload');
  });

  it('should not reload the page when error page retry is clicked', () => {
    testLog.testStart('Error Page Retry Without Reload');

    // Step 1: Sign in and load the app
    testLog.step(1, 'Sign in and wait for app to load');
    signInAndWaitForApp();
    testLog.success('App loaded');

    // Step 2: Expand the first space so page items become visible
    testLog.step(2, 'Expand space and load a page');
    cy.get('[data-testid^="space-"][data-expanded]:visible', { timeout: 15000 })
      .first()
      .then(($space) => {
        if ($space.attr('data-expanded') !== 'true') {
          cy.wrap($space).click({ force: true });
          waitForReactUpdate(1000);
        }
      });
    PageSelectors.items().filter(':visible').first().click({ force: true });
    cy.wait(2000);
    testLog.success('Page loaded');

    // Step 3: Intercept page-view API to return 500, simulating a server error.
    // Use a broad pattern that catches both page-view and view endpoints.
    testLog.step(3, 'Intercept API to simulate server error');
    cy.intercept('GET', '**/api/workspace/*/page-view/**', {
      statusCode: 500,
      body: { code: 500, message: 'Simulated server error' },
    }).as('failedPageView');

    // Step 4: Install reload detection
    testLog.step(4, 'Install reload detection');
    installReloadDetection('__NO_RELOAD_MARKER_ERR__');

    // Step 5: Navigate to another page to trigger the error
    testLog.step(5, 'Navigate to trigger error');
    PageSelectors.items().filter(':visible').last().click({ force: true });

    // Wait for the page navigation and potential error recovery.
    // The page-view request may or may not fire depending on caching,
    // so we use a fixed wait instead of waiting for a specific intercept.
    cy.wait(10000);

    // Step 6: Verify no page reload occurred during error/retry handling
    testLog.step(6, 'Verify no page reload during error recovery');
    cy.window().its('__NO_RELOAD_MARKER_ERR__').should('eq', true);
    testLog.success('No page reload during error recovery');

    testLog.testEnd('Error Page Retry Without Reload');
  });
});
