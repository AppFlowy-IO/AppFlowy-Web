import { AuthTestUtils } from '../../../support/auth-utils';
import { waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Unsupported Block Display', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();

  before(() => {
    cy.viewport(1280, 720);
  });

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        // Slate editor errors when DOM doesn't match Slate state during testing
        err.message.includes('Cannot resolve a DOM point from Slate point') ||
        err.message.includes('Cannot resolve a DOM node from Slate node') ||
        // React errors during dynamic block injection
        err.message.includes('Invalid hook call')
      ) {
        return false;
      }

      return true;
    });

    cy.session(
      testEmail,
      () => {
        authUtils.signInWithTestUrl(testEmail);
      },
      {
        validate: () => {
          cy.window().then((win) => {
            const token = win.localStorage.getItem('af_auth_token');

            expect(token).to.be.ok;
          });
        },
      }
    );

    cy.visit('/app');
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
    cy.wait(2000);

    // Ensure any open menus are closed
    cy.get('body').type('{esc}');

    cy.get('[data-slate-editor="true"]').should('exist').click({ force: true });
    cy.focused().type('{selectall}{backspace}');
    waitForReactUpdate(500);
  });

  describe('Unsupported Block Rendering', () => {
    it('should display unsupported block message for unknown block types', () => {
      // Wait for editor to be ready
      waitForReactUpdate(500);

      // Insert an unsupported block type via the exposed Yjs document
      cy.window().then((win) => {
        const testWindow = win as Window & {
          __TEST_DOC__?: {
            getMap: (key: string) => unknown;
            transact: (fn: () => void) => void;
          };
          Y?: {
            Map: new () => Map<string, unknown>;
            Text: new () => unknown;
            Array: new <T>() => { push: (items: T[]) => void };
          };
        };

        const doc = testWindow.__TEST_DOC__;
        const Y = testWindow.Y;

        if (!doc || !Y) {
          throw new Error('Test utilities not found. Ensure app is running in dev mode.');
        }

        // Get the document structure
        // Structure: doc.getMap('data').get('document') -> { blocks, meta, page_id }
        const sharedRoot = doc.getMap('data') as Map<string, unknown>;
        const document = sharedRoot.get('document') as Map<string, unknown>;
        const blocks = document.get('blocks') as Map<string, unknown>;
        const meta = document.get('meta') as Map<string, unknown>;
        const pageId = document.get('page_id') as string;
        const childrenMap = meta.get('children_map') as Map<string, unknown>;
        const textMap = meta.get('text_map') as Map<string, unknown>;

        // Generate a unique block ID
        const blockId = `test_unsupported_${Date.now()}`;

        // Insert an unsupported block type
        doc.transact(() => {
          const block = new Y.Map();

          block.set('id', blockId);
          block.set('ty', 'future_block_type_not_yet_implemented'); // Unknown block type
          block.set('children', blockId);
          block.set('external_id', blockId);
          block.set('external_type', 'text');
          block.set('parent', pageId);
          block.set('data', '{}');

          (blocks as Map<string, unknown>).set(blockId, block);

          // Add to page children
          const pageChildren = childrenMap.get(pageId) as { push: (items: string[]) => void };

          if (pageChildren) {
            pageChildren.push([blockId]);
          }

          // Create empty text for the block
          const blockText = new Y.Text();

          (textMap as Map<string, unknown>).set(blockId, blockText);

          // Create empty children array
          const blockChildren = new Y.Array<string>();

          (childrenMap as Map<string, unknown>).set(blockId, blockChildren);
        });
      });

      waitForReactUpdate(1000);

      // Verify the unsupported block component is rendered
      cy.get('[data-testid="unsupported-block"]').should('exist');
      cy.get('[data-testid="unsupported-block"]').should('be.visible');

      // Verify it shows the correct message
      cy.get('[data-testid="unsupported-block"]')
        .should('contain.text', 'not supported yet')
        .and('contain.text', 'future_block_type_not_yet_implemented');
    });

    it('should display warning icon and block type name', () => {
      // Insert an unsupported block with a specific type name
      const testBlockType = 'my_custom_unknown_block';

      cy.window().then((win) => {
        const testWindow = win as Window & {
          __TEST_DOC__?: {
            getMap: (key: string) => unknown;
            transact: (fn: () => void) => void;
          };
          Y?: {
            Map: new () => Map<string, unknown>;
            Text: new () => unknown;
            Array: new <T>() => { push: (items: T[]) => void };
          };
        };

        const doc = testWindow.__TEST_DOC__;
        const Y = testWindow.Y;

        if (!doc || !Y) {
          throw new Error('Test utilities not found. Ensure app is running in dev mode.');
        }

        // Structure: doc.getMap('data').get('document') -> { blocks, meta, page_id }
        const sharedRoot = doc.getMap('data') as Map<string, unknown>;
        const document = sharedRoot.get('document') as Map<string, unknown>;
        const blocks = document.get('blocks') as Map<string, unknown>;
        const meta = document.get('meta') as Map<string, unknown>;
        const pageId = document.get('page_id') as string;
        const childrenMap = meta.get('children_map') as Map<string, unknown>;
        const textMap = meta.get('text_map') as Map<string, unknown>;

        const blockId = `test_${Date.now()}`;

        doc.transact(() => {
          const block = new Y.Map();

          block.set('id', blockId);
          block.set('ty', testBlockType);
          block.set('children', blockId);
          block.set('external_id', blockId);
          block.set('external_type', 'text');
          block.set('parent', pageId);
          block.set('data', '{}');

          (blocks as Map<string, unknown>).set(blockId, block);

          const pageChildren = childrenMap.get(pageId) as { push: (items: string[]) => void };

          if (pageChildren) {
            pageChildren.push([blockId]);
          }

          const blockText = new Y.Text();

          (textMap as Map<string, unknown>).set(blockId, blockText);

          const blockChildren = new Y.Array<string>();

          (childrenMap as Map<string, unknown>).set(blockId, blockChildren);
        });
      });

      waitForReactUpdate(1000);

      // Verify the unsupported block shows the type name
      cy.get('[data-testid="unsupported-block"]')
        .should('be.visible')
        .and('contain.text', testBlockType);

      // Verify it has the warning styling (contains an SVG icon)
      cy.get('[data-testid="unsupported-block"] svg').should('exist');
    });

    it('should be non-editable', () => {
      // Insert an unsupported block
      cy.window().then((win) => {
        const testWindow = win as Window & {
          __TEST_DOC__?: {
            getMap: (key: string) => unknown;
            transact: (fn: () => void) => void;
          };
          Y?: {
            Map: new () => Map<string, unknown>;
            Text: new () => unknown;
            Array: new <T>() => { push: (items: T[]) => void };
          };
        };

        const doc = testWindow.__TEST_DOC__;
        const Y = testWindow.Y;

        if (!doc || !Y) {
          throw new Error('Test utilities not found.');
        }

        // Structure: doc.getMap('data').get('document') -> { blocks, meta, page_id }
        const sharedRoot = doc.getMap('data') as Map<string, unknown>;
        const document = sharedRoot.get('document') as Map<string, unknown>;
        const blocks = document.get('blocks') as Map<string, unknown>;
        const meta = document.get('meta') as Map<string, unknown>;
        const pageId = document.get('page_id') as string;
        const childrenMap = meta.get('children_map') as Map<string, unknown>;
        const textMap = meta.get('text_map') as Map<string, unknown>;

        const blockId = `test_readonly_${Date.now()}`;

        doc.transact(() => {
          const block = new Y.Map();

          block.set('id', blockId);
          block.set('ty', 'readonly_test_block');
          block.set('children', blockId);
          block.set('external_id', blockId);
          block.set('external_type', 'text');
          block.set('parent', pageId);
          block.set('data', '{}');

          (blocks as Map<string, unknown>).set(blockId, block);

          const pageChildren = childrenMap.get(pageId) as { push: (items: string[]) => void };

          if (pageChildren) {
            pageChildren.push([blockId]);
          }

          const blockText = new Y.Text();

          (textMap as Map<string, unknown>).set(blockId, blockText);

          const blockChildren = new Y.Array<string>();

          (childrenMap as Map<string, unknown>).set(blockId, blockChildren);
        });
      });

      waitForReactUpdate(1000);

      // Verify the unsupported block has contentEditable=false
      cy.get('[data-testid="unsupported-block"]')
        .should('have.attr', 'contenteditable', 'false');
    });
  });
});
