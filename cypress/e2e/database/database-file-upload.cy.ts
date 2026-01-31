import { FieldType, waitForReactUpdate } from '../../support/selectors';
import {
  generateRandomEmail,
  loginAndCreateGrid,
  addNewProperty,
  setupFieldTypeTest,
  getCellsForField,
  getLastFieldId,
} from '../../support/field-type-test-helpers';

/**
 * Database File Upload Tests
 *
 * Tests for file upload in database file/media field:
 * - Create a grid database
 * - Add a file & media field
 * - Upload a file and verify it appears
 * - Verify upload tracker is working
 */
describe('Database File Upload', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  /**
   * Test: Create grid, add file/media field, upload file, verify upload tracking
   */
  it('should upload file to database file/media field and track progress', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Database file upload - Email: ${testEmail}`);

    loginAndCreateGrid(testEmail);

    // Step 1: Add a File & Media field
    cy.task('log', '[STEP 1] Adding File & Media field');
    addNewProperty(FieldType.FileMedia);
    waitForReactUpdate(1000);

    // Verify the field was added (should see a new column header)
    cy.get('[data-testid^="grid-field-header-"]').should('have.length.at.least', 2);
    cy.task('log', '[STEP 1] File & Media field added');

    // Set up console log spy to verify upload tracker logs
    cy.window().then((win) => {
      cy.spy(win.console, 'info').as('consoleInfo');
    });

    // Step 2: Click on a cell in the file/media column to open upload dialog
    cy.task('log', '[STEP 2] Opening file upload dialog');

    // Get the last field (file/media field) and click on its first cell
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().click({ force: true });
    });
    waitForReactUpdate(2000);

    // The popover should open with the file dropzone
    cy.get('[data-testid="file-dropzone"]', { timeout: 15000 }).should('be.visible');
    cy.task('log', '[STEP 2] File upload dialog opened');

    // Step 3: Upload multiple files
    cy.task('log', '[STEP 3] Uploading multiple files');

    // The file dropzone contains a hidden input, attach multiple files to it
    cy.get('[data-testid="file-dropzone"]').within(() => {
      cy.get('input[type="file"]').attachFile(['appflowy.png', 'test-icon.png'], { force: true });
    });
    waitForReactUpdate(8000);

    // Step 4: Verify the files were uploaded
    cy.task('log', '[STEP 4] Verifying file uploads');

    // The cell should now show the uploaded files (image thumbnails)
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().within(() => {
        // Should have 2 image thumbnails
        cy.get('img', { timeout: 10000 }).should('have.length', 2);
      });
    });

    // Step 5: Verify upload tracker was called
    cy.task('log', '[STEP 5] Verifying upload tracking');
    cy.get('@consoleInfo').should('have.been.calledWithMatch', /\[UploadTracker\] Upload started/);
    cy.get('@consoleInfo').should('have.been.calledWithMatch', /\[UploadTracker\] Upload completed/);

    cy.task('log', '[TEST COMPLETE] File uploaded successfully with tracking verified');
  });
});
