/**
 * Core field type conversion tests - Checkbox, Time, Checklist
 *
 * These tests exercise lazy field-type switching on web to mirror desktop behaviour.
 * They focus on core conversions that are reliable and deterministic.
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

describe('Field Type - Core Conversions', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  it('RichText ↔ Checkbox parses truthy/falsy and preserves original text', () => {
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    // Add RichText property and wait for it to be ready
    addNewProperty(FieldType.RichText);

    // Store field ID in alias for later use
    getLastFieldId().as('textFieldId');

    // Type 'yes' into first DATA cell (eq(0) = first data row, using getDataRowCellsForField)
    cy.get<string>('@textFieldId').then((fieldId) => {
      cy.log('Typing into first cell, fieldId: ' + fieldId);
      return getDataRowCellsForField(fieldId).eq(0).should('exist').scrollIntoView().realClick();
    });
    cy.wait(1500);
    cy.get('textarea:visible', { timeout: 5000 }).should('exist').first().clear().type('yes', { delay: 30 });
    cy.get('body').type('{esc}');
    cy.wait(500);

    // Type 'no' into second DATA cell (eq(1) = second data row)
    cy.get<string>('@textFieldId').then((fieldId) => {
      cy.log('Typing into second cell, fieldId: ' + fieldId);
      return getDataRowCellsForField(fieldId).eq(1).should('exist').scrollIntoView().realClick();
    });
    cy.wait(1500);
    cy.get('textarea:visible', { timeout: 5000 }).should('exist').first().clear().type('no', { delay: 30 });
    cy.get('body').type('{esc}');
    cy.wait(500);

    // Switch to Checkbox
    editLastProperty(FieldType.Checkbox);

    // Verify rendering shows checkbox icons - "yes" should be checked, "no" should be unchecked
    // Checkbox cells render as SVG icons, not text, so we check for the icon testids
    cy.get('[data-testid="checkbox-checked-icon"]').should('have.length.at.least', 1);
    cy.get('[data-testid="checkbox-unchecked-icon"]').should('have.length.at.least', 1);

    // Switch back to RichText and ensure original raw text survives
    editLastProperty(FieldType.RichText);
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).then(($cells) => {
        const values: string[] = [];
        $cells.each((_i, el) => values.push(el.textContent || ''));
        expect(values.some((v) => v.toLowerCase().includes('yes'))).to.be.true;
        expect(values.some((v) => v.toLowerCase().includes('no'))).to.be.true;
      });
    });
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

  it('Checkbox click creates checked state that survives type switch', () => {
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNewProperty(FieldType.Checkbox);
    getLastFieldId().as('checkboxFieldId');

    // Click the first checkbox to check it
    cy.get<string>('@checkboxFieldId').then((fieldId) => {
      getCellsForField(fieldId).first().click({ force: true });
    });
    waitForReactUpdate(500);

    // Verify it's checked
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().find('[data-testid="checkbox-checked-icon"]').should('exist');
    });

    // Switch to SingleSelect - should show "Yes"
    editLastProperty(FieldType.SingleSelect);
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().should('contain.text', 'Yes');
    });

    // Switch back to Checkbox - should still be checked
    editLastProperty(FieldType.Checkbox);
    getLastFieldId().then((fieldId) => {
      getCellsForField(fieldId).first().find('[data-testid="checkbox-checked-icon"]').should('exist');
    });
  });
});
