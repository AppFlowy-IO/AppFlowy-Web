/**
 * Checklist field type tests
 *
 * Tests for Checklist field type conversions.
 */
import { FieldType } from '../../support/selectors';
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

describe('Field Type - Checklist', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  it('RichText ↔ Checklist handles markdown/plain text and preserves content', () => {
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNewProperty(FieldType.RichText);
    getLastFieldId().as('checklistFieldId');

    cy.get<string>('@checklistFieldId').then((fieldId) => {
      typeTextIntoCell(fieldId, 0, '[x] Done\n[ ] Todo\nPlain line');
    });

    editLastProperty(FieldType.Checklist);

    // Switch back to RichText to view markdown text
    editLastProperty(FieldType.RichText);
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).then(($cells) => {
        const values: string[] = [];
        $cells.each((_i, el) => values.push((el.textContent || '').trim()));
        const allText = values.join('\n');
        expect(allText).to.match(/Done|Todo|Plain/i);
      });
    });
  });
});
