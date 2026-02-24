import * as awarenessProtocol from 'y-protocols/awareness';

import { TestTool } from '../../../support/page-utils';
import { PageSelectors } from '../../../support/selectors';
import { testLog } from '../../../support/test-helpers';

import { avatarTestUtils } from './avatar-test-utils';

const { generateRandomEmail, setupBeforeEach, signInAndWaitForApp, imports } = avatarTestUtils;
const { AvatarSelectors, dbUtils } = imports;

type TestWindow = Window & {
  __APPFLOWY_AWARENESS_MAP__?: Record<string, awarenessProtocol.Awareness>;
};

const openFirstPageAndTriggerAwareness = (): void => {
  TestTool.expandSpace(0);
  cy.wait(1000);

  PageSelectors.names().should('be.visible', { timeout: 10000 });
  PageSelectors.names().first().then(($page) => {
    cy.wrap($page).click({ force: true });
  });

  cy.wait(2000);

  cy.get('[contenteditable="true"]').then(($editors) => {
    if ($editors.length === 0) {
      return;
    }

    let editorFound = false;

    $editors.each((index, el) => {
      const $el = Cypress.$(el);


      if (!$el.attr('data-testid')?.includes('title') && !$el.hasClass('editor-title')) {
        cy.wrap(el).click({ force: true });
        cy.wait(500);
        cy.wrap(el).type(' ', { force: true });
        editorFound = true;
        return false;
      }
    });

    if (!editorFound) {
      cy.wrap($editors.last()).click({ force: true });
      cy.wait(500);
      cy.wrap($editors.last()).type(' ', { force: true });
    }
  });

  cy.wait(1500);
};

describe('Avatar Awareness Dedupe', () => {
  beforeEach(() => {
    setupBeforeEach();
  });

  it('should show one header avatar for same user across multiple awareness clients', function () {
    const testEmail = generateRandomEmail();

    signInAndWaitForApp(testEmail).then(() => {
      testLog.info('Step 1: Open a document and trigger local awareness');
      openFirstPageAndTriggerAwareness();

      AvatarSelectors.headerAvatars().should('have.length', 1);

      dbUtils.getCurrentUserUuid().then((userUuid) => {
        expect(userUuid, 'Current user UUID should be available').to.be.a('string').and.not.be.empty;

        testLog.info('Step 2: Inject two remote awareness clients for the same user UUID');
        cy.window().then((win) => {
          const testWindow = win as TestWindow;

          expect(testWindow.__APPFLOWY_AWARENESS_MAP__, 'Awareness map test hook should be exposed').to.exist;
          const awarenessMap = testWindow.__APPFLOWY_AWARENESS_MAP__!;

          const pathMatch = win.location.pathname.match(/\/app\/[^/]+\/([^/?]+)/);
          const currentViewId = pathMatch?.[1];

          expect(currentViewId, 'Current viewId should be parsed from URL').to.be.a('string').and.not.be.empty;

          const awareness = currentViewId ? awarenessMap[currentViewId] : undefined;
          const fallbackAwareness = awareness || Object.values(awarenessMap)[0];

          expect(fallbackAwareness, 'Awareness instance for active view').to.exist;
          if (!fallbackAwareness) {
            throw new Error('Awareness instance for active view is missing');
          }

          const targetAwareness = fallbackAwareness;

          const nowSeconds = Math.floor(Date.now() / 1000);
          const remoteClientA = 990001;
          const remoteClientB = 990002;

          const stateA = {
            version: 1,
            timestamp: nowSeconds,
            user: {
              uid: 1000001,
              device_id: 'cypress-device-a',
            },
            metadata: JSON.stringify({
              user_name: 'Same User',
              cursor_color: '#ff6600',
              selection_color: '#ff660040',
              user_avatar: '',
              user_uuid: userUuid,
            }),
          };
          const stateB = {
            version: 1,
            timestamp: nowSeconds + 1,
            user: {
              uid: 2000002,
              device_id: 'cypress-device-b',
            },
            metadata: JSON.stringify({
              user_name: 'Same User',
              cursor_color: '#ff6600',
              selection_color: '#ff660040',
              user_avatar: '',
              user_uuid: userUuid,
            }),
          };

          const states = new Map<number, Record<string, unknown>>([
            [remoteClientA, stateA],
            [remoteClientB, stateB],
          ]);

          // encodeAwarenessUpdate requires clocks in meta for each client id.
          targetAwareness.meta.set(remoteClientA, { clock: 1, lastUpdated: Date.now() });
          targetAwareness.meta.set(remoteClientB, { clock: 1, lastUpdated: Date.now() });

          const update = awarenessProtocol.encodeAwarenessUpdate(targetAwareness, [remoteClientA, remoteClientB], states);

          awarenessProtocol.applyAwarenessUpdate(targetAwareness, update, 'cypress');
        });

        testLog.info('Step 3: Verify header keeps one avatar for the same user');
        cy.wait(1000);
        AvatarSelectors.headerAvatars().should('have.length', 1);
      });
    });
  });
});
