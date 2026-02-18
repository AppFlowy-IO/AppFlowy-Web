import { BlockSelectors, EditorSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Editor - Drag and Drop Blocks Tests
 *
 * Note: The editor uses @atlaskit/pragmatic-drag-and-drop which maintains internal state
 * that is updated via native HTML5 drag events. Cypress synthetic drag events work for
 * special blocks (callout) but not for regular text blocks.
 */
describe('Editor - Drag and Drop Blocks', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Cannot resolve a DOM point from Slate point') ||
        err.message.includes('Cannot resolve a DOM node from Slate node') ||
        err.message.includes('Cannot resolve a Slate point from DOM point') ||
        err.message.includes('Cannot resolve a Slate node from DOM node') ||
        err.message.includes("Cannot read properties of undefined (reading '_dEH')") ||
        err.message.includes('unobserveDeep')
      ) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  const dragBlock = (sourceText: string, targetText: string, edge: 'top' | 'bottom') => {
    cy.log(`Dragging "${sourceText}" to ${edge} of "${targetText}"`);

    // Get the source block element
    const getSourceBlock = () => {
      return sourceText.startsWith('[')
        ? EditorSelectors.slateEditor().find(sourceText).first()
        : EditorSelectors.slateEditor().contains(sourceText).closest('[data-block-type]');
    };

    // First, hover over the source block to reveal the drag handle
    getSourceBlock().scrollIntoView().should('be.visible').then(($sourceBlock) => {
      cy.wrap($sourceBlock).trigger('mouseover', { force: true });
      cy.wrap($sourceBlock).realHover({ position: 'center' });

      // Force visibility of hover controls
      BlockSelectors.hoverControls().invoke('css', 'opacity', '1');

      // Get the drag handle
      BlockSelectors.dragHandle().should('exist').then(($handle) => {
        // Get target block coordinates
        EditorSelectors.slateEditor().contains(targetText).closest('[data-block-type]').then(($targetBlock) => {
          const targetRect = $targetBlock[0].getBoundingClientRect();
          const handleRect = $handle[0].getBoundingClientRect();

          const startX = handleRect.left + handleRect.width / 2;
          const startY = handleRect.top + handleRect.height / 2;
          const endX = targetRect.left + (targetRect.width / 2);
          const endY = edge === 'top'
            ? targetRect.top + (targetRect.height * 0.15)
            : targetRect.top + (targetRect.height * 0.85);

          const dataTransfer = new DataTransfer();

          // Start drag on the handle
          cy.wrap($handle).trigger('mousedown', {
            button: 0,
            clientX: startX,
            clientY: startY,
            force: true
          });

          cy.wrap($handle).trigger('dragstart', {
            dataTransfer,
            clientX: startX,
            clientY: startY,
            force: true,
            eventConstructor: 'DragEvent'
          });

          cy.wait(150);

          // Move to target with multiple dragover events for edge detection
          cy.wrap($targetBlock).trigger('dragenter', {
            dataTransfer,
            clientX: endX,
            clientY: endY,
            force: true,
            eventConstructor: 'DragEvent'
          });

          // Fire multiple dragover events to ensure edge is detected
          for (let i = 0; i < 3; i++) {
            cy.wrap($targetBlock).trigger('dragover', {
              dataTransfer,
              clientX: endX,
              clientY: endY,
              force: true,
              eventConstructor: 'DragEvent'
            });
            cy.wait(100);
          }

          // Drop
          cy.wrap($targetBlock).trigger('drop', {
            dataTransfer,
            clientX: endX,
            clientY: endY,
            force: true,
            eventConstructor: 'DragEvent'
          });

          // End drag
          cy.wrap($handle).trigger('dragend', {
            dataTransfer,
            force: true,
            eventConstructor: 'DragEvent'
          });

          cy.wrap($handle).trigger('mouseup', {
            button: 0,
            force: true
          });
        });
      });
    });

    waitForReactUpdate(1000);
  };

  const closeViewModal = () => {
    cy.get('[role="dialog"]', { timeout: 30000 }).should('be.visible').then(($dialog) => {
      // Check if this is an error dialog by looking for error-related text
      const isErrorDialog = $dialog.text().includes('Something went wrong') ||
                           $dialog.text().includes('error') ||
                           $dialog.find('button:contains("Reload")').length > 0;

      if (isErrorDialog) {
        // Close error dialog by clicking the X button or pressing Escape
        cy.get('[role="dialog"]').find('button').filter(':visible').first().click({ force: true });
      } else {
        // Normal view modal - close with Escape
        cy.get('body').type('{esc}');
      }
    });
    waitForReactUpdate(800);
    // Check if dialog is closed, if not try pressing Escape again
    cy.get('body').then($body => {
      if ($body.find('[role="dialog"]:visible').length > 0) {
        cy.get('body').type('{esc}');
        waitForReactUpdate(500);
      }
    });
  };

  it('should reorder Callout block', () => {
    const testEmail = generateRandomEmail();
    cy.signIn(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started').click();

      cy.get('[data-slate-editor="true"]').click().type('{selectall}{backspace}');
      waitForReactUpdate(500);

      // Create text blocks first
      cy.focused().type('Top Text{enter}');
      cy.focused().type('Bottom Text');
      waitForReactUpdate(500);

      // Move cursor back to Top Text to insert callout after it
      cy.contains('Top Text').click().type('{end}{enter}');

      // Create Callout Block
      cy.focused().type('/callout');
      waitForReactUpdate(1000);
      cy.contains('Callout').should('be.visible').click();
      waitForReactUpdate(1000);

      cy.focused().type('Callout Content');
      waitForReactUpdate(500);

      // Verify callout block exists
      BlockSelectors.blockByType('callout').should('exist');

      // Initial State: Top Text, Callout, Bottom Text
      // Action: Drag Callout below Bottom Text
      dragBlock('[data-block-type="callout"]', 'Bottom Text', 'bottom');

      // Verify: Top Text, Bottom Text, Callout
      BlockSelectors.allBlocks().then($blocks => {
         const relevant = $blocks.filter((i, el) =>
            el.textContent?.includes('Top Text') ||
            el.textContent?.includes('Bottom Text') ||
            el.textContent?.includes('Callout Content')
         );
         expect(relevant[0]).to.contain.text('Top Text');
         expect(relevant[1]).to.contain.text('Bottom Text');
         expect(relevant[2]).to.contain.text('Callout Content');
      });
    });
  });

  it('should create and verify grid block with drag handle', () => {
    const testEmail = generateRandomEmail();
    cy.signIn(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started').click();

      cy.get('[data-slate-editor="true"]').click().type('{selectall}{backspace}');
      waitForReactUpdate(500);

      // Create text blocks
      cy.focused().type('Top Text{enter}');
      cy.focused().type('Bottom Text{enter}');

      // Create Grid Block
      cy.focused().type('/grid');
      waitForReactUpdate(1000);
      BlockSelectors.slashMenuGrid().should('be.visible').click();
      waitForReactUpdate(2000);

      // Grid creation opens a view modal; close it before interacting with the document editor.
      closeViewModal();

      // Wait for editor to stabilize after modal close
      waitForReactUpdate(1500);

      // Click on document to ensure focus
      cy.get('[data-slate-editor="true"]').click();
      waitForReactUpdate(500);

      // Verify grid block exists and has correct structure
      BlockSelectors.blockByType('grid').should('exist').and('be.visible');

      // Verify drag handle appears on hover
      BlockSelectors.blockByType('grid')
        .scrollIntoView()
        .trigger('mouseover', { force: true })
        .realHover({ position: 'center' });

      // Force visibility and verify drag handle exists
      BlockSelectors.hoverControls().invoke('css', 'opacity', '1');
      BlockSelectors.dragHandle().should('exist');

      // Verify all blocks are present in the document
      cy.contains('Top Text').should('exist');
      cy.contains('Bottom Text').should('exist');
      BlockSelectors.blockByType('grid').should('have.length.at.least', 1);
    });
  });

});
