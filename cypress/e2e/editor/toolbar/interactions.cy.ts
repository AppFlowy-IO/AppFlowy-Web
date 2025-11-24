import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Toolbar Actions', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();

  before(() => {
    cy.viewport(1280, 720);
  });

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);
    cy.visit('/login', { failOnStatusCode: false });

    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
      cy.wait(3000);
      
      // Focus and clear editor
      EditorSelectors.firstEditor().click({ force: true });
      cy.focused().type('{selectall}{backspace}');
      waitForReactUpdate(500);
    });
  });

  // Test Helpers for Toolbar
  const showToolbar = (text = 'Link text') => {
    // Select all text to trigger toolbar robustly in headless
    cy.focused().type('{selectall}');
    waitForReactUpdate(500);
    EditorSelectors.selectionToolbar().should('exist').should('be.visible');
  };

  it('should open Link popover via toolbar', () => {
    cy.focused().type('Link text');
    showToolbar('Link text');
    
    cy.get('[data-testid="selection-toolbar"]').within(() => {
      cy.get('[data-testid="link-button"]').click({ force: true });
    });
    
    // HrefPopover uses MUI Popover
    cy.get('.MuiPopover-root').should('exist').should('be.visible');
    // Check for input inside the popover
    cy.get('.MuiPopover-root input').should('exist');
  });

  it('should open Text Color picker via toolbar', () => {
    cy.focused().type('Colored text');
    showToolbar('Colored text');
    
    cy.get('[data-testid="selection-toolbar"]').within(() => {
      cy.get('[data-testid="text-color-button"]').click({ force: true });
    });
    
    waitForReactUpdate(200);
    // Verify color picker popover opens and has content
    cy.get('[data-slot="popover-content"]').should('exist').should('be.visible');
    // Check for presence of color options (divs with role button or similar, or just children)
    cy.get('[data-slot="popover-content"]').find('div').should('have.length.gt', 0);
  });

  it('should open Background Color picker via toolbar', () => {
    cy.focused().type('Highlighted text');
    showToolbar('Highlighted text');
    
    cy.get('[data-testid="selection-toolbar"]').within(() => {
      cy.get('[data-testid="bg-color-button"]').click({ force: true });
    });
    
    waitForReactUpdate(200);
    // Verify bg color picker popover opens
    cy.get('[data-slot="popover-content"]').should('exist').should('be.visible');
    cy.get('[data-slot="popover-content"]').find('div').should('have.length.gt', 0);
  });

  it('should allow converting block type via toolbar', () => {
    cy.focused().type('Convert me');
    showToolbar('Convert me');
    
    cy.get('[data-testid="selection-toolbar"]').within(() => {
      cy.get('[data-testid="heading-button"]').click({ force: true });
    });
    
    // Heading uses MUI Popover (via _shared/popover)
    cy.get('.MuiPopover-root').should('exist').should('be.visible');
    cy.get('[data-testid="heading-1-button"]').should('exist');
  });
});
