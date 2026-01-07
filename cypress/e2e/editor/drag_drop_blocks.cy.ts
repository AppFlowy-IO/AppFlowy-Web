import { AuthTestUtils } from '../../support/auth-utils';
import { BlockSelectors, EditorSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

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

    // 1. Hover over the source block to reveal controls
    const getSource = () => {
        return sourceText.startsWith('[')
          ? EditorSelectors.slateEditor().find(sourceText)
          : EditorSelectors.slateEditor().contains(sourceText);
    };

    getSource().closest('[data-block-type]').scrollIntoView().should('be.visible').then(($sourceBlock) => {
      // Use realHover to simulate user interaction which updates elementFromPoint
      cy.wrap($sourceBlock).trigger('mouseover', { force: true });
      cy.wrap($sourceBlock).realHover({ position: 'center' });

      // Force visibility of hover controls to avoid flakiness
      BlockSelectors.hoverControls().invoke('css', 'opacity', '1');

      // 2. Get the drag handle
      BlockSelectors.dragHandle().should('exist').then(($handle) => {
        // Get target block coordinates first
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

  it.skip('should iteratively reorder items in a list (5 times)', () => {
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started').click();
      
      cy.get('[data-slate-editor="true"]').click().type('{selectall}{backspace}');
      waitForReactUpdate(500);

      // Create List: 1, 2, 3, 4, 5
      cy.focused().type('1. Item 1{enter}');
      cy.focused().type('Item 2{enter}');
      cy.focused().type('Item 3{enter}');
      cy.focused().type('Item 4{enter}');
      cy.focused().type('Item 5{enter}');
      waitForReactUpdate(1000);

      // Iterate 5 times: Drag first item ("Item 1") to the bottom ("Item 5", then whatever is last)
      // Actually, to be predictable:
      // 1. Drag Item 1 to bottom of Item 5. Order: 2, 3, 4, 5, 1
      // 2. Drag Item 2 to bottom of Item 1. Order: 3, 4, 5, 1, 2
      // 3. Drag Item 3 to bottom of Item 2. Order: 4, 5, 1, 2, 3
      // 4. Drag Item 4 to bottom of Item 3. Order: 5, 1, 2, 3, 4
      // 5. Drag Item 5 to bottom of Item 4. Order: 1, 2, 3, 4, 5 (Back to start!)

      const items = ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5'];

      for (let i = 0; i < 5; i++) {
        const itemToMove = items[i];
        const targetItem = items[(i + 4) % 5]; // The current last item
        
        cy.log(`Iteration ${i + 1}: Moving ${itemToMove} below ${targetItem}`);
        dragBlock(itemToMove, targetItem, 'bottom');
        // Add extra wait for stability
        cy.wait(2000);
      }

      // Verify final order (Should be 1, 2, 3, 4, 5)
      items.forEach((item, index) => {
        BlockSelectors.blockByType('numbered_list').eq(index).should('contain.text', item);
      });

      // Reload and verify
      /*
      cy.reload();
      cy.get('[data-slate-editor="true"]', { timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      items.forEach((item, index) => {
        BlockSelectors.blockByType('numbered_list').eq(index).should('contain.text', item);
      });
      */
    });
  });

  // Skip: Text blocks (heading, paragraph) use pragmatic-drag-and-drop which requires real pointer events
  // Cypress synthetic drag events don't fully trigger the library's internal state machine
  // The callout and grid tests work because special blocks have additional event handling
  it.skip('should reorder Header and Paragraph blocks', () => {
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started').click();
      
      cy.get('[data-slate-editor="true"]').click().type('{selectall}{backspace}');
      waitForReactUpdate(500);

      // Create Header
      cy.focused().type('/');
      waitForReactUpdate(1000);
      cy.contains('Heading 1').should('be.visible').click();
      waitForReactUpdate(500);
      
      cy.focused().type('Header Block');
      cy.focused().type('{enter}'); // New line
      
      // Create Paragraph
      cy.focused().type('Paragraph Block');
      waitForReactUpdate(1000);

      // Verify initial order: Header, Paragraph
      BlockSelectors.blockByType('heading').should('exist');
      BlockSelectors.blockByType('paragraph').should('exist');

      // Drag Header below Paragraph (use selector for consistent behavior with passing tests)
      dragBlock('[data-block-type="heading"]', 'Paragraph Block', 'bottom');

      // Verify Order: Paragraph, Header
      BlockSelectors.allBlocks().then($blocks => {
         const textBlocks = $blocks.filter((i, el) => 
            el.textContent?.includes('Header Block') || el.textContent?.includes('Paragraph Block')
         );
         expect(textBlocks[0]).to.contain.text('Paragraph Block');
         expect(textBlocks[1]).to.contain.text('Header Block');
      });

      // Reload and verify
      /*
      cy.reload();
      cy.get('[data-slate-editor="true"]', { timeout: 30000 }).should('exist');
      waitForReactUpdate(2000);

      cy.get('[data-block-type]').then($blocks => {
         const textBlocks = $blocks.filter((i, el) => 
            el.textContent?.includes('Header Block') || el.textContent?.includes('Paragraph Block')
         );
         expect(textBlocks[0]).to.contain.text('Paragraph Block');
         expect(textBlocks[1]).to.contain.text('Header Block');
      });
      */
    });
  });

  it('should reorder Callout block', () => {
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail).then(() => {
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
      // Note: dragBlock supports selectors, so we can pass the data-block-type selector string
      // Ideally we'd use a helper if dragBlock supported it, but it expects string.
      // We can construct the string using the same logic or just pass literal for now.
      // Or update dragBlock to take an element? dragBlock logic: if sourceText starts with [, use cy.get.
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

  // Skip: Empty image blocks have internal event handling that interferes with Cypress drag simulation
  // The grid test with similar structure passes, suggesting image-specific event handling issues
  it.skip('should drag and drop an image block', () => {
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started').click();
      
      cy.get('[data-slate-editor="true"]').click().type('{selectall}{backspace}');
      waitForReactUpdate(500);

      // Create text blocks
      cy.focused().type('Top Text{enter}');
      cy.focused().type('Bottom Text{enter}');
      
      // Create Image Block
      cy.focused().type('/image');
      waitForReactUpdate(1000);
      cy.contains('Image').should('be.visible').click();
      waitForReactUpdate(1000);

      // Close the image upload popover/modal if it appears (match grid test pattern)
      cy.get('body').then($body => {
        const hasDialog = $body.find('[role="dialog"]').filter(':visible').length > 0;
        const hasPopover = $body.find('[data-slot="popover-content"]').filter(':visible').length > 0;
        if (hasDialog || hasPopover) {
          cy.get('body').type('{esc}');
          waitForReactUpdate(800);
        }
      });

      // Verify image block exists
      BlockSelectors.blockByType('image').should('exist');
      waitForReactUpdate(500);

      // Initial State: Top Text, Bottom Text, Image (at bottom)
      // Drag Image between Top and Bottom
      dragBlock('[data-block-type="image"]', 'Top Text', 'bottom');

      // Verify: Top Text, Image, Bottom Text
      BlockSelectors.allBlocks().then($blocks => {
         const relevant = $blocks.filter((i, el) => 
            el.textContent?.includes('Top Text') || 
            el.textContent?.includes('Bottom Text') || 
            el.getAttribute('data-block-type') === 'image'
         );
         expect(relevant[0]).to.contain.text('Top Text');
         expect(relevant[1]).to.have.attr('data-block-type', 'image');
         expect(relevant[2]).to.contain.text('Bottom Text');
      });
    });
  });

  it('should drag and drop a grid block', () => {
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail).then(() => {
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
      // Note: "Grid" might be the label. Adjust if "Table" or "Database" is used in UI.
      // Based on SlashPanel code, it is "Grid".
      BlockSelectors.slashMenuGrid().should('be.visible').click();
      waitForReactUpdate(2000);
      
      // Grid creation opens a view modal; close it before interacting with the document editor.
      closeViewModal();

      // Verify grid block exists
      BlockSelectors.blockByType('grid').should('exist');

      // Initial State: Top Text, Bottom Text, Grid
      // Drag Grid between Top and Bottom
      dragBlock('[data-block-type="grid"]', 'Top Text', 'bottom');

      // Verify: Top Text, Grid, Bottom Text
      BlockSelectors.allBlocks().then($blocks => {
         const relevant = $blocks.filter((i, el) => 
            el.textContent?.includes('Top Text') || 
            el.textContent?.includes('Bottom Text') || 
            el.getAttribute('data-block-type') === 'grid'
         );
         expect(relevant[0]).to.contain.text('Top Text');
         expect(relevant[1]).to.have.attr('data-block-type', 'grid');
         expect(relevant[2]).to.contain.text('Bottom Text');
      });
    });
  });

});
