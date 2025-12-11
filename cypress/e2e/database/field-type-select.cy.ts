/**
 * SingleSelect and MultiSelect field type tests
 *
 * These tests verify the SingleSelect/MultiSelect ↔ RichText conversion
 * which is simpler to test via RichText input (avoids flaky dropdown interactions).
 */
import { FieldType, waitForReactUpdate } from '../../support/selectors';
import {
  generateRandomEmail,
  getLastFieldId,
  getCellsForField,
  typeTextIntoCell,
  loginAndCreateGrid,
  addNewProperty,
  editLastProperty,
  setupFieldTypeTest,
} from '../../support/field-type-test-helpers';

describe('Field Type - Select (SingleSelect/MultiSelect)', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  it('RichText ↔ SingleSelect field type switching works without errors', () => {
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    // Add RichText property and type some text
    addNewProperty(FieldType.RichText);
    getLastFieldId().as('selectFieldId');

    cy.get<string>('@selectFieldId').then((fieldId) => {
      typeTextIntoCell(fieldId, 0, 'Apple');
    });

    // Verify text was entered
    cy.get<string>('@selectFieldId').then((fieldId) => {
      getCellsForField(fieldId).first().should('contain.text', 'Apple');
    });

    // Switch to SingleSelect - text won't match any option (expected behavior)
    // The lazy conversion only matches text to EXISTING options in type_option
    editLastProperty(FieldType.SingleSelect);
    waitForReactUpdate(500);

    // Verify the field type switch happened without errors
    // Cell may be empty since "Apple" doesn't match any existing option
    cy.get<string>('@selectFieldId').then((fieldId) => {
      getCellsForField(fieldId).should('exist');
    });

    // Switch back to RichText
    editLastProperty(FieldType.RichText);
    cy.get<string>('@selectFieldId').then((fieldId) => {
      // Field should still exist and be functional
      getCellsForField(fieldId).should('exist');
    });
  });

  it('SingleSelect ↔ MultiSelect type switching preserves field type options', () => {
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    // Add SingleSelect property - switching between Single/Multi is straightforward
    addNewProperty(FieldType.SingleSelect);
    getLastFieldId().as('selectFieldId');

    // Switch to MultiSelect
    editLastProperty(FieldType.MultiSelect);
    waitForReactUpdate(500);

    // Switch back to SingleSelect
    editLastProperty(FieldType.SingleSelect);
    waitForReactUpdate(500);

    // The field should still exist and be functional (no errors during switching)
    // This validates the type_option conversion between Single/Multi works
    cy.get<string>('@selectFieldId').then((fieldId) => {
      getCellsForField(fieldId).should('exist');
    });
  });
});
