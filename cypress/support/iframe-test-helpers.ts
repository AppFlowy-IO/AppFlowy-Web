/**
 * Shared iframe helpers for cross-tab synchronization tests.
 */

const DEFAULT_IFRAME_ID = 'test-sync-iframe';
const DEFAULT_CONTAINER_ID = 'test-iframe-container';

const DEFAULT_CONTAINER_STYLE =
  'position: fixed; top: 50px; right: 10px; width: 700px; height: 600px; z-index: 9999; border: 3px solid blue; background: white;';
const DEFAULT_IFRAME_STYLE = 'width: 100%; height: 100%; border: none;';

interface CreateTestIframeOptions {
  containerId?: string;
  iframeId?: string;
  containerStyle?: string;
  iframeStyle?: string;
}

interface IframeTargetOptions {
  iframeId?: string;
}

export function getIframeBody(
  { iframeId = DEFAULT_IFRAME_ID }: IframeTargetOptions = {}
): Cypress.Chainable<Cypress.JQuery<HTMLElement>> {
  return cy
    .get(`#${iframeId}`)
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then((body) => cy.wrap(body as HTMLElement));
}

export function waitForIframeReady({ iframeId = DEFAULT_IFRAME_ID }: IframeTargetOptions = {}) {
  cy.log('[HELPER] Waiting for iframe to be ready');
  return cy
    .get(`#${iframeId}`, { timeout: 30000 })
    .should('exist')
    .then(($iframe) => {
      return new Cypress.Promise((resolve) => {
        const checkReady = () => {
          try {
            const iframeDoc = ($iframe[0] as HTMLIFrameElement).contentDocument;

            if (iframeDoc) {
              const pageItems = iframeDoc.querySelectorAll('[data-testid="page-item"]');

              if (pageItems.length > 0) {
                cy.log(`[HELPER] Iframe ready with ${pageItems.length} page items`);
                resolve(null);
                return;
              }
            }
          } catch {
            // Not ready yet.
          }

          setTimeout(checkReady, 500);
        };

        setTimeout(checkReady, 3000);
      });
    });
}

export function injectCypressMarkerIntoIframe({ iframeId = DEFAULT_IFRAME_ID }: IframeTargetOptions = {}) {
  return cy.get(`#${iframeId}`).then(($iframe) => {
    const iframeWindow = ($iframe[0] as HTMLIFrameElement).contentWindow;

    if (iframeWindow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (iframeWindow as any).Cypress = true;
    }
  });
}

export function createTestSyncIframe(
  appUrl: string,
  {
    containerId = DEFAULT_CONTAINER_ID,
    iframeId = DEFAULT_IFRAME_ID,
    containerStyle = DEFAULT_CONTAINER_STYLE,
    iframeStyle = DEFAULT_IFRAME_STYLE,
  }: CreateTestIframeOptions = {}
) {
  cy.document().then((doc) => {
    const container = doc.createElement('div');

    container.id = containerId;
    container.style.cssText = containerStyle;

    const iframe = doc.createElement('iframe');

    iframe.id = iframeId;
    iframe.src = appUrl;
    iframe.style.cssText = iframeStyle;

    container.appendChild(iframe);
    doc.body.appendChild(container);
  });
}

export function removeTestSyncIframe(containerId = DEFAULT_CONTAINER_ID) {
  cy.document().then((doc) => {
    const container = doc.getElementById(containerId);

    if (container) {
      container.remove();
    }
  });
}
