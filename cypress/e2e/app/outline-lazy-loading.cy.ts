import { AuthTestUtils } from '../../support/auth-utils';
import { PageSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

const INVALID_VIEW_ID = '00000000-0000-0000-0000-000000000000';

function waitForSidebarReady() {
  cy.get('[data-testid="space-item"]', { timeout: 60000 }).should('exist');
  PageSelectors.items({ timeout: 60000 }).should('exist');
}

function extractViewId(testId: string | null | undefined, prefix: string): string {
  if (!testId || !testId.startsWith(prefix)) {
    throw new Error(`Unexpected data-testid: ${String(testId)}`);
  }

  return testId.slice(prefix.length);
}

describe('Outline Lazy Loading', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return false;
      }

      return true;
    });
  });

  it('refetches subtree after collapsing and reopening a space', () => {
    const authUtils = new AuthTestUtils();
    const testEmail = generateRandomEmail();

    let targetSpaceId = '';
    let subtreeRequestCount = 0;

    cy.intercept('GET', '**/api/workspace/*/view/*', (req) => {
      if (!targetSpaceId) return;

      const url = new URL(req.url);
      const depth = url.searchParams.get('depth');
      const requestViewId = url.pathname.split('/').pop();

      if (depth === '1' && requestViewId === targetSpaceId) {
        subtreeRequestCount += 1;
      }
    }).as('getSubtreeView');

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail);
    waitForSidebarReady();

    cy.get('[data-testid^="space-"]', { timeout: 30000 })
      .first()
      .invoke('attr', 'data-testid')
      .then((spaceTestId) => {
        targetSpaceId = extractViewId(spaceTestId, 'space-');
        const selector = `[data-testid="space-${targetSpaceId}"]`;

        cy.get(selector)
          .invoke('attr', 'data-expanded')
          .then((expanded) => {
            if (expanded === 'true') {
              cy.get(selector).click({ force: true });
            }
          });

        cy.get(selector).click({ force: true });
        cy.wrap(null, { timeout: 20000 }).should(() => {
          expect(subtreeRequestCount).to.be.greaterThan(0);
        });

        cy.then(() => {
          const previousCount = subtreeRequestCount;

          cy.get(selector).click({ force: true });
          cy.wait(400);
          cy.get(selector).click({ force: true });

          cy.wrap(null, { timeout: 20000 }).should(() => {
            expect(subtreeRequestCount).to.be.greaterThan(previousCount);
          });
        });
      });
  });

  it('prunes invalid expanded ids from localStorage on reload', () => {
    const authUtils = new AuthTestUtils();
    const testEmail = generateRandomEmail();

    let fakeIdRequested = false;
    let validSpaceId = '';

    cy.intercept('GET', '**/api/workspace/*/view/*', (req) => {
      const url = new URL(req.url);
      const requestViewId = url.pathname.split('/').pop();
      const depth = url.searchParams.get('depth');

      if (depth === '1' && requestViewId === INVALID_VIEW_ID) {
        fakeIdRequested = true;
      }
    }).as('getSubtreeView');

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail);
    waitForSidebarReady();

    cy.get('[data-testid^="space-"]', { timeout: 30000 })
      .first()
      .invoke('attr', 'data-testid')
      .then((spaceTestId) => {
        validSpaceId = extractViewId(spaceTestId, 'space-');

        cy.window().then((win) => {
          win.localStorage.setItem(
            'outline_expanded',
            JSON.stringify({
              [validSpaceId]: true,
              [INVALID_VIEW_ID]: true,
            })
          );
        });
      });

    cy.reload();
    waitForSidebarReady();

    cy.window().then((win) => {
      const expandedRaw = win.localStorage.getItem('outline_expanded');
      const expanded = expandedRaw ? (JSON.parse(expandedRaw) as Record<string, boolean>) : {};

      expect(expanded[INVALID_VIEW_ID], 'invalid view id should be pruned').to.equal(undefined);
      expect(expanded[validSpaceId], 'valid expanded id should be preserved').to.equal(true);
    });

    cy.then(() => {
      expect(fakeIdRequested, 'invalid id should not trigger subtree request').to.equal(false);
    });
  });

  it('logs depth=1 subtree batch requests with one or more ids', () => {
    const authUtils = new AuthTestUtils();
    const testEmail = generateRandomEmail();
    const seenBatchRequests: Array<{ depth: string | null; viewIds: string[] }> = [];

    cy.intercept('GET', '**/api/workspace/*/views*', (req) => {
      const url = new URL(req.url);
      const depth = url.searchParams.get('depth');
      const viewIds =
        url.searchParams
          .get('view_ids')
          ?.split(',')
          .map((id) => id.trim())
          .filter(Boolean) ?? [];

      seenBatchRequests.push({ depth, viewIds });
    }).as('getSubtreeViewsBatch');

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail);
    waitForSidebarReady();

    cy.wait(2000).then(() => {
      const matched = seenBatchRequests.filter((req) => req.depth === '1' && req.viewIds.length > 0);

      testLog.info(`Observed ${matched.length} depth=1 batch subtree request(s)`);
      expect(matched.length, 'should issue at least one depth=1 batch request').to.be.greaterThan(0);
    });
  });
});
