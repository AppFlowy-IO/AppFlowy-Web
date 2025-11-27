import { AuthTestUtils } from './auth-utils';
import { TestTool } from './page-utils';
import { AddPageSelectors, DropdownSelectors, EditorSelectors, ModalSelectors, PageSelectors, SpaceSelectors, waitForReactUpdate } from './selectors';
import { generateRandomEmail } from './test-config';
import { testLog } from './test-helpers';

/**
 * Shared utilities for paste E2E tests
 */

/**
 * Helper function to paste content and wait for processing
 * Directly calls Slate editor's insertData method to bypass event system
 */
export const pasteContent = (html: string, plainText: string) => {
  // Wait for editors to be available
  EditorSelectors.slateEditor().should('have.length.at.least', 1);

  // Find the index of the main editor (not the title)
  EditorSelectors.slateEditor().then($editors => {
    let targetIndex = -1;

    $editors.each((index: number, el: HTMLElement) => {
      const $el = Cypress.$(el);
      if (!$el.attr('data-testid')?.includes('title') && !$el.hasClass('editor-title')) {
        targetIndex = index;
        return false; // break
      }
    });

    // Fallback to last editor if no content editor found
    if (targetIndex === -1 && $editors.length > 0) {
      targetIndex = $editors.length - 1;
    }

    if (targetIndex === -1) {
      throw new Error('No editor found');
    }

    // Click the editor to ensure it's active. Splitting this from the next block
    // handles cases where click might trigger a re-render.
    EditorSelectors.slateEditor().eq(targetIndex).click({ force: true });

    // Re-query to get the fresh element for Slate instance extraction
    EditorSelectors.slateEditor().eq(targetIndex).then(($el) => {
      const targetEditor = $el[0];

      // Access the Slate editor instance and call insertData directly
      cy.window().then((win) => {
        // Slate React stores editor reference on the DOM node
        const editorKey = Object.keys(targetEditor!).find(key =>
          key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
        );

        if (editorKey) {
          // Get React fiber node
          const fiber = (targetEditor as any)[editorKey];

          // Traverse up to find Slate context with editor
          let currentFiber = fiber;
          let slateEditor = null;

          // We need to find the element that has the editor instance
          // This is usually provided via context or props in the tree
          // Try traversing up the fiber tree
          let depth = 0;
          while (currentFiber && !slateEditor && depth < 50) {
            // Check pendingProps or memoizedProps for editor
            if (currentFiber.memoizedProps && currentFiber.memoizedProps.editor) {
              slateEditor = currentFiber.memoizedProps.editor;
            } else if (currentFiber.stateNode && currentFiber.stateNode.editor) {
              slateEditor = currentFiber.stateNode.editor;
            }

            currentFiber = currentFiber.return;
            depth++;
          }

          if (slateEditor && typeof slateEditor.insertData === 'function') {
            // Create DataTransfer object and call editor.insertData
            const dataTransfer = new win.DataTransfer();

            if (html) {
              dataTransfer.setData('text/html', html);
            }

            if (plainText) {
              dataTransfer.setData('text/plain', plainText);
            } else if (!html) {
              // Ensure empty string if both are empty (though unusual)
              dataTransfer.setData('text/plain', '');
            }

            // Call insertData directly on the Slate editor
            // This bypasses the React event system and goes straight to Slate's internal handler
            slateEditor.insertData(dataTransfer);
          } else {
            // Fallback: use Cypress trigger if we can't find the Slate instance
            // This is less reliable but better than failing outright
            cy.wrap(targetEditor).trigger('paste', {
              clipboardData: {
                getData: (type: string) => {
                  if (type === 'text/html') return html;
                  if (type === 'text/plain') return plainText;
                  return '';
                },
                types: ['text/html', 'text/plain']
              },
              bubbles: true,
              cancelable: true
            });
          }
        } else {
          // Fallback: use Cypress trigger
          cy.wrap(targetEditor).trigger('paste', {
            clipboardData: {
              getData: (type: string) => {
                if (type === 'text/html') return html;
                if (type === 'text/plain') return plainText;
                return '';
              },
              types: ['text/html', 'text/plain']
            },
            bubbles: true,
            cancelable: true
          });
        }
      });
    });
  });

  // Wait for paste to process
  cy.wait(1500);
};

/**
 * Helper to create a new test page
 */
export const createTestPage = () => {
  const testEmail = generateRandomEmail();

  // Handle uncaught exceptions
  cy.on('uncaught:exception', (err: Error) => {
    if (err.message.includes('No workspace or service found')) {
      return false;
    }

    return true;
  });

  // Sign in
  cy.visit('/login', { failOnStatusCode: false });
  cy.wait(2000);

  const authUtils = new AuthTestUtils();

  authUtils.signInWithTestUrl(testEmail);

  cy.url().should('include', '/app');
  TestTool.waitForPageLoad(3000);
  TestTool.waitForSidebarReady();
  cy.wait(2000);

  // Create new page using the reliable inline method
  testLog.info('=== Creating New Page ===');

  // Expand General space to ensure we can see the content
  testLog.info('Expanding General space');
  SpaceSelectors.itemByName('General').first().click();
  waitForReactUpdate(500);

  // Use inline add button on General space
  testLog.info('Creating new page in General space');
  SpaceSelectors.itemByName('General').first().within(() => {
    AddPageSelectors.inlineAddButton().first().should('be.visible').click();
  });
  waitForReactUpdate(1000);

  // Select first item (Page) from the menu
  DropdownSelectors.menuItem().first().click();
  waitForReactUpdate(1000);

  // Handle the new page modal if it appears (defensive)
  cy.get('body').then(($body) => {
    if ($body.find('[data-testid="new-page-modal"]').length > 0) {
      testLog.info('Handling new page modal');
      ModalSelectors.newPageModal().should('be.visible').within(() => {
        ModalSelectors.spaceItemInModal().first().click();
        waitForReactUpdate(500);
        ModalSelectors.addButton().click();
      });
      cy.wait(3000);
    }
  });

  // Close any leftover modals
  cy.get('body').then(($body: JQuery<HTMLBodyElement>) => {
    if ($body.find('[role="dialog"]').length > 0) {
      cy.get('body').type('{esc}');
      cy.wait(1000);
    }
  });

  // Select the new Untitled page explicitly
  testLog.info('Selecting the new Untitled page');
  PageSelectors.itemByName('Untitled').should('be.visible').click();
  waitForReactUpdate(1000);
};

/**
 * Verify content exists in the editor using DevTools
 */
export const verifyEditorContent = (expectedContent: string) => {
  EditorSelectors.slateEditor().then($editors => {
    // Find the main content editor (not the title)
    let editorHTML = '';
    $editors.each((_index: number, el: HTMLElement) => {
      const $el = Cypress.$(el);
      // Skip title editors
      if (!$el.attr('data-testid')?.includes('title') && !$el.hasClass('editor-title')) {
        editorHTML += el.innerHTML;
      }
    });

    testLog.info(`Editor HTML: ${editorHTML.substring(0, 200)}...`);
    expect(editorHTML).to.include(expectedContent);
  });
};
