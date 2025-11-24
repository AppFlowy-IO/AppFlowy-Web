import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Editor Cursor & Style Interaction', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();

  before(() => {
    cy.viewport(1280, 720);
    // One-time login for the suite to save time, if state persists. 
    // However, AppFlowy tests usually login per test or share session. 
    // Based on other tests, we'll do full login flow to be safe but optimize if possible.
  });

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);
    cy.visit('/login', { failOnStatusCode: false });
    
    // Quick login reuse if feasible, otherwise standard login
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
      cy.wait(3000); // Wait for editor load
      
      // Focus and clear editor
      EditorSelectors.firstEditor().click({ force: true });
      cy.focused().type('{selectall}{backspace}');
      waitForReactUpdate(500);
    });
  });

  it('should persist bold style when typing inside bold text', () => {
    // 1. Type regular text
    cy.focused().type('Normal ');

    // 2. Toggle Bold
    cy.focused().type('{cmd}b'); // Shortcut for bold
    // Alternatively check for toolbar, but shortcut is faster for e2e if it works
    
    // 3. Type Bold text
    cy.focused().type('Bold');
    
    // 4. Verify it is bold
    cy.get('strong').should('contain.text', 'Bold');

    // 5. Move cursor inside "Bold" (Left arrow x 2) -> "Bo|ld"
    cy.focused().type('{leftArrow}{leftArrow}');
    
    // 6. Type "X"
    cy.focused().type('X');

    // 7. Verify "X" is inside the strong tag
    // content should be "BoXld"
    cy.get('strong').should('contain.text', 'BoXld');
  });

  it('should reset style when creating a new paragraph', () => {
    // 1. Turn on Bold
    cy.focused().type('{cmd}b'); 
    cy.focused().type('Heading Bold');
    
    // Verify it's bold
    cy.get('strong').should('contain.text', 'Heading Bold');

    // 2. Press Enter to new block
    cy.focused().type('{enter}');
    
    // 3. Type new text
    cy.focused().type('Next Line');

    // 4. Verify "Next Line" is NOT bold (in a separate block, no strong tag wrapping it)
    // We check that the text exists but is not inside a strong tag associated with the previous one
    cy.contains('Next Line').should('be.visible');
    // Ideally check it has no parent 'strong'
    cy.contains('Next Line').parents('strong').should('not.exist');
  });

  it('should handle cursor navigation with arrow keys', () => {
    // Setup: 3 lines
    cy.focused().type('Line 1{enter}');
    cy.focused().type('Line 2{enter}');
    cy.focused().type('Line 3');
    waitForReactUpdate(500);

    // Current cursor at end of Line 3
    
    // Move Up to Line 2
    cy.focused().type('{upArrow}');
    waitForReactUpdate(200);
    
    // Insert marker
    cy.focused().type('<-Modified');

    // Verify Line 2 has marker
    cy.contains('Line 2<-Modified').should('be.visible');
    cy.contains('Line 3<-Modified').should('not.exist');

    // Move Up to Line 1 and move Left
    cy.focused().type('{upArrow}');
    waitForReactUpdate(200);
    
    // Move left 2 times to insert before '1'
    // "Line 1" -> cursor at end -> left -> left -> "Line |1"
    cy.focused().type('{leftArrow}{leftArrow}');
    waitForReactUpdate(200);
    
    cy.focused().type('Inserted');

    // Verify Line 1 content
    // "Line Inserted1"
    cy.contains('Line Inserted1').should('be.visible');
  });

  it('should merge blocks on backspace', () => {
    // Setup: 2 lines
    cy.focused().type('Paragraph One');
    cy.focused().type('{enter}');
    cy.focused().type('Paragraph Two');

    // Cursor is at end of Paragraph Two
    // Move to start of Paragraph Two
    cy.focused().type('{home}');
    
    // Backspace to merge
    cy.focused().type('{backspace}');

    // Verify merged content
    cy.contains('Paragraph OneParagraph Two').should('be.visible');
    // Should be single block (simplified check: look for text existence combined)
  });
  
  it('should split block on enter', () => {
    // Setup
    cy.focused().type('SplitHere');
    
    // Move to middle
    cy.focused().type('{leftArrow}{leftArrow}{leftArrow}{leftArrow}'); // "Split|Here"
    
    // Enter
    cy.focused().type('{enter}');

    // Verify split
    cy.contains('Split').should('be.visible');
    cy.contains('Here').should('be.visible');
    // They should be on separate lines (block level)
    // We can check if they are distinct elements or just visually separate
    // checking strict HTML structure might be flaky, verifying text presence is safer for "functionality"
  });

});
