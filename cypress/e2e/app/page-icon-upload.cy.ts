import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import { AddPageSelectors, PageIconSelectors, waitForReactUpdate } from '../../support/selectors';

describe('Page Icon Upload', () => {
  const authUtils = new AuthTestUtils();
  let testEmail: string;

  beforeEach(() => {
    testEmail = `${uuidv4()}@appflowy.io`;
    cy.on('uncaught:exception', (err: Error) => {
      // Ignore common errors that don't affect the test
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('Failed to fetch dynamically imported module')
      ) {
        return false;
      }

      return true;
    });
    cy.viewport(1280, 720);
  });

  it('should upload page icon image and display after refresh', () => {
    // Set up intercept BEFORE visiting the page
    cy.intercept('PUT', '**/api/file_storage/**').as('fileUpload');

    // 1. Sign in
    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      waitForReactUpdate(2000);
    });

    // 2. Create a new page
    AddPageSelectors.inlineAddButton().first().click();
    waitForReactUpdate(500);
    cy.get('[role="menuitem"]').first().click(); // Create Doc
    waitForReactUpdate(1000);

    // 3. Click "Add icon" button (force click since it's hidden until hover)
    PageIconSelectors.addIconButton().first().click({ force: true });
    waitForReactUpdate(500);

    // 4. Click Upload tab
    PageIconSelectors.iconPopoverTabUpload().click();
    waitForReactUpdate(500);

    // 5. Upload image via file input (use proper 100x100 test image)
    cy.get('input[type="file"]').attachFile('test-icon.png');

    // Wait for upload to complete
    cy.wait('@fileUpload', { timeout: 15000 });
    waitForReactUpdate(2000); // Wait for UI to update

    // 6. Verify icon changed to uploaded image in sidebar
    // The image should exist and have a src attribute (blob URL or file_storage URL)
    PageIconSelectors.pageIconImage().should('exist');
    PageIconSelectors.pageIconImage()
      .should('have.attr', 'src')
      .and('not.be.empty')
      .and('match', /^blob:|file_storage/);

    // Additional verification: ensure the image is actually loaded and visible
    PageIconSelectors.pageIconImage().should('be.visible');

    // 7. Refresh the page
    cy.reload();
    waitForReactUpdate(3000);

    // 8. Verify uploaded image icon persists after refresh
    // After refresh, the image should be fetched with authentication
    // and displayed as a blob URL
    PageIconSelectors.pageIconImage().should('exist');
    PageIconSelectors.pageIconImage()
      .should('have.attr', 'src')
      .and('match', /^blob:/); // Should be blob URL from authenticated fetch
  });

  it('should display emoji icon correctly', () => {
    // 1. Sign in
    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      waitForReactUpdate(2000);
    });

    // 2. Create a new page
    AddPageSelectors.inlineAddButton().first().click();
    waitForReactUpdate(500);
    cy.get('[role="menuitem"]').first().click();
    waitForReactUpdate(1000);

    // 3. Click "Add icon" button (force click since it's hidden until hover)
    PageIconSelectors.addIconButton().first().click({ force: true });
    waitForReactUpdate(500);

    // 4. Emoji tab should be default, click on an emoji
    PageIconSelectors.iconPopoverTabEmoji().click();
    waitForReactUpdate(300);

    // 5. Click on any emoji in the picker (emojis are in Button components)
    // The emoji picker renders native emojis in buttons with text-xl class
    cy.get('button.text-xl').first().click({ force: true });
    waitForReactUpdate(500);

    // 6. Verify emoji is displayed in sidebar (not an image)
    PageIconSelectors.pageIconImage().should('not.exist');
    PageIconSelectors.pageIcon().first().should('exist');

    // 7. Refresh the page
    cy.reload();
    waitForReactUpdate(2000);

    // 8. Verify emoji icon persists after refresh (not an image)
    PageIconSelectors.pageIconImage().should('not.exist');
    PageIconSelectors.pageIcon().first().should('exist');
  });
});
