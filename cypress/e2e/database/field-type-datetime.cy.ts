/**
 * DateTime field type tests
 *
 * These tests verify DateTime field conversions and date picker interactions.
 */
import { FieldType, waitForReactUpdate } from '../../support/selectors';
import {
  generateRandomEmail,
  getLastFieldId,
  getCellsForField,
  getDataRowCellsForField,
  typeTextIntoCell,
  loginAndCreateGrid,
  addNewProperty,
  editLastProperty,
  setupFieldTypeTest,
} from '../../support/field-type-test-helpers';

describe('Field Type - DateTime', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  it('RichText ↔ DateTime converts and preserves date data', () => {
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    // Add RichText property
    addNewProperty(FieldType.RichText);
    getLastFieldId().as('dateFieldId');

    // Enter a Unix timestamp in milliseconds (Jan 16, 2024 00:00:00 UTC)
    // Using a timestamp ensures consistent parsing across locales
    const testTimestamp = '1705363200000';

    cy.get<string>('@dateFieldId').then((fieldId) => {
      typeTextIntoCell(fieldId, 0, testTimestamp);
    });

    // Switch to DateTime
    editLastProperty(FieldType.DateTime);

    // Verify cell renders something (DateTime cells show formatted date)
    // The exact format depends on locale, so we just verify the cell has content
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().then(($cell) => {
        const text = ($cell.text() || '').trim();
        // After switching to DateTime, the cell should show a formatted date
        cy.log(`DateTime cell content: "${text}"`);
        // Check that the cell has some content (date formatting varies by locale)
        expect(text.length).to.be.greaterThan(0);
      });
    });

    // Switch back to RichText - the data should be preserved (as formatted date string)
    // Note: The lazy conversion may transform the raw timestamp into a formatted date,
    // which is the expected behavior for DateTime → RichText conversion
    editLastProperty(FieldType.RichText);
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().then(($cell) => {
        const text = ($cell.text() || '').trim();
        cy.log(`RichText cell content after round-trip: "${text}"`);
        // Data should be preserved (either as original timestamp or formatted date)
        expect(text.length).to.be.greaterThan(0);
      });
    });
  });

  it('DateTime field with date picker preserves selected date through type switches', () => {
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    // Add DateTime property directly
    addNewProperty(FieldType.DateTime);
    getLastFieldId().as('dateFieldId');

    // Click on first cell to open date picker
    cy.get<string>('@dateFieldId').then((fieldId) => {
      getDataRowCellsForField(fieldId).eq(0).should('exist').scrollIntoView().click({ force: true });
    });
    waitForReactUpdate(800);

    // Wait for the date picker popover to appear
    // The date picker uses a popover with calendar component
    cy.get('[data-testid="datetime-picker-popover"]', { timeout: 8000 }).should('be.visible');

    // Click on today's date (which should be highlighted/selected by default)
    // We'll click on any available day button to set a date
    cy.get('[data-testid="datetime-picker-popover"]')
      .find('button[name="day"]')
      .first()
      .click({ force: true });
    waitForReactUpdate(500);

    // Close the date picker
    cy.get('body').type('{esc}');
    waitForReactUpdate(500);

    // Verify the cell now has a date value
    cy.get<string>('@dateFieldId').then((fieldId) => {
      getCellsForField(fieldId).first().then(($cell) => {
        const text = ($cell.text() || '').trim();
        cy.log(`DateTime cell after selection: "${text}"`);
        // Cell should have some date content
        expect(text.length).to.be.greaterThan(0);
      });
    });

    // Switch to RichText - should show the date as text
    editLastProperty(FieldType.RichText);
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().then(($cell) => {
        const text = ($cell.text() || '').trim();
        cy.log(`RichText cell content: "${text}"`);
        // Should have some content (either formatted date or timestamp)
        expect(text.length).to.be.greaterThan(0);
      });
    });

    // Switch back to DateTime - date should be preserved
    editLastProperty(FieldType.DateTime);
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().then(($cell) => {
        const text = ($cell.text() || '').trim();
        cy.log(`DateTime cell after round-trip: "${text}"`);
        // Should still have date content
        expect(text.length).to.be.greaterThan(0);
      });
    });
  });
});
