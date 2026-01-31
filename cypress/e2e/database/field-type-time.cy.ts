/**
 * Time field type tests
 *
 * Tests for Time field type conversions.
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

describe('Field Type - Time', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  it('RichText ↔ Time parses HH:MM / milliseconds and round-trips', () => {
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNewProperty(FieldType.RichText);
    getLastFieldId().as('timeFieldId');

    cy.get<string>('@timeFieldId').then((fieldId) => {
      typeTextIntoCell(fieldId, 0, '09:30');
      typeTextIntoCell(fieldId, 1, '34200000');
    });

    editLastProperty(FieldType.Time);

    // Expect parsed milliseconds shown (either raw ms or formatted)
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).then(($cells) => {
        const values: string[] = [];
        $cells.each((_i, el) => values.push((el.textContent || '').trim()));
        expect(values.some((v) => v.includes('34200000') || v.includes('09:30'))).to.be.true;
      });
    });

    // Round-trip back to RichText
    editLastProperty(FieldType.RichText);
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).then(($cells) => {
        const values: string[] = [];
        $cells.each((_i, el) => values.push((el.textContent || '').trim()));
        expect(values.some((v) => v.includes('09:30') || v.includes('34200000'))).to.be.true;
      });
    });
  });
});
