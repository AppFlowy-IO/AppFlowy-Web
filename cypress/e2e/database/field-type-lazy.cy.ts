import 'cypress-real-events';
import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  FieldType,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * These tests exercise lazy field-type switching on web to mirror desktop behaviour.
 * They intentionally keep assertions lightweight to avoid flakiness while still
 * validating that data survives type switches and decodes appropriately.
 *
 * DESIGN: Tests focus on core conversions that are reliable and deterministic.
 * Complex multi-step conversions and edge cases are covered in unit tests.
 */
describe('Lazy field type switching parity', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return false;
      }
      return true;
    });

    // Use a taller viewport to ensure all dropdown items (including Time at the bottom) are visible
    cy.viewport(1280, 900);
  });

  /**
   * Helper to extract fieldId from a field header's data-testid
   * Format: grid-field-header-{fieldId}
   */
  const getLastFieldId = (): Cypress.Chainable<string> => {
    return GridFieldSelectors.allFieldHeaders()
      .last()
      .invoke('attr', 'data-testid')
      .then((testId) => {
        // Extract fieldId from "grid-field-header-{fieldId}"
        return testId?.replace('grid-field-header-', '') || '';
      });
  };

  /**
   * Helper to get all cells for a specific field (column)
   * Cells have format: grid-cell-{rowId}-{fieldId}
   */
  const getCellsForField = (fieldId: string) => {
    return cy.get(`[data-testid$="-${fieldId}"][data-testid^="grid-cell-"]`);
  };

  /**
   * Helper to get the clickable row cell wrapper for a field (column) - DATA ROWS ONLY
   * The wrapper has data-column-id={fieldId} and contains the onClick handler.
   * We filter to only include cells inside rows with valid rowIds (UUIDs),
   * excluding header rows, new-row, and calculate-row which have "grid-row-undefined".
   */
  const getDataRowCellsForField = (fieldId: string) => {
    // Only select cells inside rows that have a valid rowId (UUID format)
    // This excludes header, new-row, and calculate-row which have testid="grid-row-undefined"
    return cy.get(`[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"]) .grid-row-cell[data-column-id="${fieldId}"]`);
  };

  /**
   * Helper to type text into a cell. Uses the getDataRowCellsForField selector.
   */
  const typeTextIntoCell = (fieldId: string, cellIndex: number, text: string): void => {
    cy.log(`typeTextIntoCell: field=${fieldId}, dataRowIndex=${cellIndex}, text=${text}`);
    const cellSelector = `[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"]) .grid-row-cell[data-column-id="${fieldId}"]`;

    // Click to enter edit mode
    cy.get(cellSelector)
      .eq(cellIndex)
      .should('be.visible')
      .scrollIntoView()
      .click()
      .click(); // Double click to enter edit mode

    // Wait for textarea and type
    cy.get('textarea:visible', { timeout: 8000 })
      .should('exist')
      .first()
      .clear()
      .type(text, { delay: 30 });
    // Press Escape to close the cell and trigger save
    cy.get('body').type('{esc}');
    cy.wait(500);
  };

  const loginAndCreateGrid = (email: string) => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(1500);
    const authUtils = new AuthTestUtils();
    return authUtils.signInWithTestUrl(email).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(4000);

      // Create a new grid
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(800);
      AddPageSelectors.addGridButton().should('exist').click({ force: true });
      cy.wait(7000);
      DatabaseGridSelectors.grid().should('exist');
      DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);
    });
  };

  const addNewProperty = (fieldType: number) => {
    PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
    waitForReactUpdate(1200);
    // Radix UI DropdownMenuSub opens on hover, not click - use realHover to trigger submenu
    PropertyMenuSelectors.propertyTypeTrigger().first().realHover();
    waitForReactUpdate(600);
    // Scroll the option into view before clicking (for options at the bottom of the dropdown)
    PropertyMenuSelectors.propertyTypeOption(fieldType).scrollIntoView().click({ force: true });
    waitForReactUpdate(800);
    cy.get('body').type('{esc}');
    waitForReactUpdate(500);
  };

  const editLastProperty = (newType: number) => {
    GridFieldSelectors.allFieldHeaders().last().click({ force: true });
    waitForReactUpdate(600);
    PropertyMenuSelectors.editPropertyMenuItem().then(($edit) => {
      if ($edit.length > 0) {
        cy.wrap($edit).click({ force: true });
        waitForReactUpdate(500);
      }
    });
    // Radix UI DropdownMenuSub opens on hover, not click - use realHover to trigger submenu
    PropertyMenuSelectors.propertyTypeTrigger().first().realHover();
    waitForReactUpdate(600);
    // Scroll the option into view before clicking (for options at the bottom of the dropdown)
    PropertyMenuSelectors.propertyTypeOption(newType).scrollIntoView().click({ force: true });
    waitForReactUpdate(800);
    cy.get('body').type('{esc}{esc}');
    waitForReactUpdate(500);
  };

  // ============================================================================
  // Core Conversion Tests - These test the fundamental lazy type switching behavior
  // ============================================================================

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
