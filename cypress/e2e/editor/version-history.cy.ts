import { toBase64 } from 'lib0/buffer';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  HeaderSelectors,
  VersionHistorySelectors,
  EditorSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

const APPFLOWY_BASE_URL = Cypress.env('APPFLOWY_BASE_URL') || 'http://localhost';

interface TestWindow extends Window {
  __TEST_DOC__?: { /* Y.Doc */ };
  Y?: {
    snapshot: (doc: unknown) => unknown;
    encodeSnapshot: (snapshot: unknown) => Uint8Array;
  };
}

/**
 * Get access token from localStorage (follows api-utils.ts pattern).
 */
function getAccessToken(): Cypress.Chainable<string> {
  return cy
    .window()
    .its('localStorage')
    .invoke('getItem', 'token')
    .then(JSON.parse)
    .its('access_token');
}

/**
 * Extract workspaceId and viewId from the current app URL.
 * Expected format: /app/{workspaceId}/{viewId}
 */
function parseAppUrl(): Cypress.Chainable<{ workspaceId: string; viewId: string }> {
  return cy.url().then((urlStr) => {
    const segments = new URL(urlStr).pathname.split('/').filter(Boolean);

    if (segments.length < 3 || segments[0] !== 'app') {
      throw new Error(`Unexpected app URL format: ${urlStr}`);
    }

    return { workspaceId: segments[1], viewId: segments[2] };
  });
}

/**
 * Wait for the editor to expose __TEST_DOC__ and Y on the window,
 * then take a snapshot of the current Y.Doc and return it as base64.
 */
function snapshotCurrentDoc(): Cypress.Chainable<string> {
  // Retry until the editor has mounted and exposed test globals
  cy.window({ timeout: 30000 }).should((win) => {
    const tw = win as TestWindow;

    expect(tw.__TEST_DOC__, '__TEST_DOC__ should be set').to.exist;
    expect(tw.Y, 'Y should be set').to.exist;
  });

  return cy.window().then((win) => {
    const testWin = win as TestWindow;
    const doc = testWin.__TEST_DOC__!;
    const YMod = testWin.Y!;

    const snapshot = YMod.snapshot(doc);
    const encoded: Uint8Array = YMod.encodeSnapshot(snapshot);

    return toBase64(encoded);
  });
}

/**
 * POST a single version history entry to the cloud API.
 *
 * Endpoint: POST /api/workspace/{workspaceId}/collab/{objectId}/history
 * Body:     { name, snapshot (base64), collab_type: 0 (Document) }
 */
function postVersion(
  workspaceId: string,
  viewId: string,
  accessToken: string,
  name: string,
  snapshotBase64: string,
): void {
  cy.request({
    method: 'POST',
    url: `${APPFLOWY_BASE_URL}/api/workspace/${workspaceId}/collab/${viewId}/history`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: {
      name,
      snapshot: snapshotBase64,
      collab_type: 0,
    },
  });
}

describe('Document Version History', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();

  before(() => {
    cy.viewport(1280, 900);
  });

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);

    cy.session(testEmail, () => {
      authUtils.signInWithTestUrl(testEmail);
    }, {
      validate: () => {
        cy.window().then((win) => {
          const token = win.localStorage.getItem('af_auth_token');
          expect(token).to.be.ok;
        });
      },
    });

    cy.visit('/app');
    cy.url({ timeout: 30000 }).should('include', '/app');
  });

  /**
   * Use the default document page (loaded automatically after visiting /app)
   * and create version history entries by typing content, snapshotting the
   * live Y.Doc, and POSTing each snapshot to the version-history API.
   */
  function createVersionsOnCurrentPage(versionCount = 4): void {
    testLog.step(1, 'Wait for editor to be ready');
    EditorSelectors.slateEditor().should('exist');

    const edits = [
      'First version content.',
      'Second edit - adding more content.',
      'Third edit - even more content.',
      'Fourth edit - final content.',
    ];

    // Collect context needed for API calls once
    getAccessToken().then((accessToken) => {
      parseAppUrl().then(({ workspaceId, viewId }) => {
        testLog.step(2, `Create ${versionCount} version history entries via API`);

        for (let i = 0; i < Math.min(edits.length, versionCount); i++) {
          // Type content into the editor
          EditorSelectors.firstEditor().click({ force: true });
          cy.focused().type(`{enter}${edits[i]}`);
          waitForReactUpdate(1000);

          // Snapshot the live Y.Doc and POST the version
          const versionName = `Version ${i + 1}`;

          snapshotCurrentDoc().then((snap) => {
            postVersion(workspaceId, viewId, accessToken, versionName, snap);
          });
        }
      });
    });

    waitForReactUpdate(1000);
  }

  /**
   * Open version history modal via the header "More actions" dropdown.
   */
  function openVersionHistory(): void {
    testLog.info('Opening More Actions menu');
    HeaderSelectors.moreActionsButton().should('be.visible').click();
    waitForReactUpdate(500);

    testLog.info('Clicking Version History menu item');
    VersionHistorySelectors.menuItem().should('be.visible').click();
    waitForReactUpdate(1000);

    testLog.info('Waiting for version history modal to appear');
    VersionHistorySelectors.modal({ timeout: 15000 }).should('be.visible');
  }

  describe('Version History Records', () => {
    it('should show version history records and allow selecting different versions', () => {
      createVersionsOnCurrentPage(4);

      testLog.step(3, 'Open version history');
      openVersionHistory();

      testLog.step(4, 'Verify version list is visible and contains at least 4 entries');
      VersionHistorySelectors.list().should('be.visible');
      VersionHistorySelectors.items().should('have.length.at.least', 4);

      testLog.step(5, 'Select different versions and verify selection changes');
      // The first item should be selected by default
      VersionHistorySelectors.items().eq(0).should('have.class', 'bg-fill-content-hover');

      // Select the second version
      testLog.info('Selecting second version');
      VersionHistorySelectors.items().eq(1).click();
      waitForReactUpdate(2000);
      VersionHistorySelectors.items().eq(1).should('have.class', 'bg-fill-content-hover');

      // Select the third version
      testLog.info('Selecting third version');
      VersionHistorySelectors.items().eq(2).click();
      waitForReactUpdate(2000);
      VersionHistorySelectors.items().eq(2).should('have.class', 'bg-fill-content-hover');

      testLog.step(6, 'Close version history modal');
      VersionHistorySelectors.closeButton().click();
      VersionHistorySelectors.modal().should('not.exist');
    });
  });

  describe('Version Restore', () => {
    it('should restore a selected version', () => {
      createVersionsOnCurrentPage(4);

      testLog.step(3, 'Open version history');
      openVersionHistory();

      testLog.step(4, 'Verify at least 2 versions exist');
      VersionHistorySelectors.items().should('have.length.at.least', 2);

      testLog.step(5, 'Select the second version');
      VersionHistorySelectors.items().eq(1).click();
      waitForReactUpdate(2000);

      testLog.step(6, 'Click the Restore button');
      VersionHistorySelectors.restoreButton().should('be.visible').and('not.be.disabled').click();

      testLog.step(7, 'Wait for restore to complete');
      // After a successful restore the modal closes.
      VersionHistorySelectors.modal({ timeout: 30000 }).should('not.exist');
      waitForReactUpdate(2000);

      testLog.step(8, 'Verify document is still accessible');

      // Verify the editor is still visible and functional
      EditorSelectors.slateEditor().should('be.visible');
    });
  });
});
