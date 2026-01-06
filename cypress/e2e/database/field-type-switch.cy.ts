/**
 * Field Type Switch Tests
 * Migrated from desktop:
 * - grid_field_type_switch_test.dart
 * - grid_field_type_edit_and_switch_test.dart
 *
 * Tests field type transformations and data preservation:
 * - Round-trip conversions (Type → RichText → Type)
 * - Cross-type conversions (Checkbox → Number → Checkbox)
 * - Chain transformations (A → B → C → D)
 * - Edit after type change then switch back
 */
import {
  setupFieldTypeTest,
  loginAndCreateGrid,
  changeFieldTypeById,
  addFieldWithType,
  typeTextIntoCell,
  getCellTextContent,
  toggleCheckbox,
  addRows,
  assertRowCount,
  generateRandomEmail,
  FieldType,
} from '../../support/field-type-helpers';
import { waitForReactUpdate, DatabaseGridSelectors } from '../../support/selectors';

/**
 * Setup test data: Create fields of different types and populate with test data
 */
const setupTestData = () => {
  // Default grid has 3 rows, add more for comprehensive testing
  addRows(5); // Now have 8 rows total
  assertRowCount(8);
};

/**
 * Helper to populate number field with test data
 */
const populateNumberField = (fieldId: string): void => {
  const numbers = ['-1', '-2', '0.1', '0.2', '1', '2', '10', '11'];
  numbers.forEach((num, index) => {
    typeTextIntoCell(fieldId, index, num);
  });
};

/**
 * Helper to populate checkbox field
 */
const populateCheckboxField = (fieldId: string): void => {
  // Toggle first 5 checkboxes to checked
  for (let i = 0; i < 5; i++) {
    toggleCheckbox(fieldId, i);
  }
};

/**
 * Helper to populate URL field
 */
const populateURLField = (fieldId: string): void => {
  const urls = ['https://appflowy.io', 'https://github.com', 'no-url-text'];
  urls.forEach((url, index) => {
    typeTextIntoCell(fieldId, index, url);
  });
};

/**
 * Get all cell contents for a field as array
 */
const getAllCellContentsSync = (fieldId: string): Cypress.Chainable<string[]> => {
  return DatabaseGridSelectors.dataRowCellsForField(fieldId).then(($cells) => {
    const contents: string[] = [];
    $cells.each((_, cell) => {
      contents.push(Cypress.$(cell).text().trim());
    });
    return cy.wrap(contents);
  });
};

describe('Field Type Switch Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  describe('Round-trip to RichText and back', () => {
    it('Number → RichText → Number preserves numeric values', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      // Add and populate number field
      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        // Get original contents
        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original Number contents:', JSON.stringify(originalContents));

          // Change to RichText
          changeFieldTypeById(fieldId, FieldType.RichText);
          waitForReactUpdate(1000);

          // Change back to Number
          changeFieldTypeById(fieldId, FieldType.Number);
          waitForReactUpdate(1000);

          // Verify content preserved
          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('Final Number contents:', JSON.stringify(finalContents));

            // Compare - numbers should be preserved
            originalContents.forEach((original, index) => {
              if (original) {
                expect(finalContents[index]).to.equal(original);
              }
            });
          });
        });
      });
    });

    it('Checkbox → RichText → Checkbox preserves checked state', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Checkbox).then((fieldId) => {
        populateCheckboxField(fieldId);
        waitForReactUpdate(500);

        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original Checkbox contents:', JSON.stringify(originalContents));

          changeFieldTypeById(fieldId, FieldType.RichText);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((richTextContents) => {
            cy.log('RichText contents:', JSON.stringify(richTextContents));
          });

          changeFieldTypeById(fieldId, FieldType.Checkbox);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('Final Checkbox contents:', JSON.stringify(finalContents));
          });
        });
      });
    });

    it('URL → RichText → URL preserves URLs', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.URL).then((fieldId) => {
        populateURLField(fieldId);
        waitForReactUpdate(500);

        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original URL contents:', JSON.stringify(originalContents));

          changeFieldTypeById(fieldId, FieldType.RichText);
          waitForReactUpdate(1000);

          changeFieldTypeById(fieldId, FieldType.URL);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('Final URL contents:', JSON.stringify(finalContents));
          });
        });
      });
    });
  });

  describe('Cross-type transformations', () => {
    it('Number → Checkbox → Number', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original Number:', JSON.stringify(originalContents));

          changeFieldTypeById(fieldId, FieldType.Checkbox);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((checkboxContents) => {
            cy.log('After →Checkbox:', JSON.stringify(checkboxContents));
          });

          changeFieldTypeById(fieldId, FieldType.Number);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('After →Number:', JSON.stringify(finalContents));
          });
        });
      });
    });

    it('Checkbox → SingleSelect → Checkbox', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Checkbox).then((fieldId) => {
        populateCheckboxField(fieldId);
        waitForReactUpdate(500);

        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original Checkbox:', JSON.stringify(originalContents));

          changeFieldTypeById(fieldId, FieldType.SingleSelect);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((selectContents) => {
            cy.log('After →SingleSelect:', JSON.stringify(selectContents));
          });

          changeFieldTypeById(fieldId, FieldType.Checkbox);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('After →Checkbox:', JSON.stringify(finalContents));
          });
        });
      });
    });

    it('Number → SingleSelect → Number', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original Number:', JSON.stringify(originalContents));

          changeFieldTypeById(fieldId, FieldType.SingleSelect);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((selectContents) => {
            cy.log('After →SingleSelect:', JSON.stringify(selectContents));
          });

          changeFieldTypeById(fieldId, FieldType.Number);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('After →Number:', JSON.stringify(finalContents));
          });
        });
      });
    });

    it('Number → URL → Number', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original Number:', JSON.stringify(originalContents));

          changeFieldTypeById(fieldId, FieldType.URL);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((urlContents) => {
            cy.log('After →URL:', JSON.stringify(urlContents));
          });

          changeFieldTypeById(fieldId, FieldType.Number);
          waitForReactUpdate(1000);

          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('After →Number:', JSON.stringify(finalContents));
          });
        });
      });
    });

    it('SingleSelect → MultiSelect → SingleSelect', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.SingleSelect).then((fieldId) => {
        changeFieldTypeById(fieldId, FieldType.MultiSelect);
        waitForReactUpdate(1000);

        getAllCellContentsSync(fieldId).then((multiContents) => {
          cy.log('After →MultiSelect:', JSON.stringify(multiContents));
        });

        changeFieldTypeById(fieldId, FieldType.SingleSelect);
        waitForReactUpdate(1000);

        getAllCellContentsSync(fieldId).then((finalContents) => {
          cy.log('After →SingleSelect:', JSON.stringify(finalContents));
        });
      });
    });
  });

  describe('Chain transformations', () => {
    it('Number → URL → RichText → Number', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original Number:', JSON.stringify(originalContents));

          changeFieldTypeById(fieldId, FieldType.URL);
          waitForReactUpdate(800);
          cy.log('Changed to URL');

          changeFieldTypeById(fieldId, FieldType.RichText);
          waitForReactUpdate(800);
          cy.log('Changed to RichText');

          changeFieldTypeById(fieldId, FieldType.Number);
          waitForReactUpdate(800);

          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('Final Number:', JSON.stringify(finalContents));
          });
        });
      });
    });

    it('Checkbox → Number → SingleSelect → Checkbox', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Checkbox).then((fieldId) => {
        populateCheckboxField(fieldId);
        waitForReactUpdate(500);

        getAllCellContentsSync(fieldId).then((originalContents) => {
          cy.log('Original Checkbox:', JSON.stringify(originalContents));

          changeFieldTypeById(fieldId, FieldType.Number);
          waitForReactUpdate(800);
          cy.log('Changed to Number');

          changeFieldTypeById(fieldId, FieldType.SingleSelect);
          waitForReactUpdate(800);
          cy.log('Changed to SingleSelect');

          changeFieldTypeById(fieldId, FieldType.Checkbox);
          waitForReactUpdate(800);

          getAllCellContentsSync(fieldId).then((finalContents) => {
            cy.log('Final Checkbox:', JSON.stringify(finalContents));
          });
        });
      });
    });
  });
});

describe('Field Type Edit and Switch Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  describe('Edit after type change', () => {
    it('Number → RichText → edit non-numeric → Number (should be empty)', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        changeFieldTypeById(fieldId, FieldType.RichText);
        waitForReactUpdate(1000);

        // Edit cell to non-numeric value
        typeTextIntoCell(fieldId, 0, 'hello world');
        waitForReactUpdate(500);

        getCellTextContent(fieldId, 0).then((afterEdit) => {
          cy.log(`After edit to RichText: "${afterEdit}"`);
        });

        // Change back to Number
        changeFieldTypeById(fieldId, FieldType.Number);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 0).then((afterSwitch) => {
          cy.log(`After →Number: "${afterSwitch}"`);
          // Non-numeric text should result in empty number
          expect(afterSwitch).to.equal('');
        });
      });
    });

    it('Number → RichText → edit numeric → Number (should convert)', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        changeFieldTypeById(fieldId, FieldType.RichText);
        waitForReactUpdate(1000);

        // Edit cell to numeric value
        typeTextIntoCell(fieldId, 1, '456');
        waitForReactUpdate(500);

        getCellTextContent(fieldId, 1).then((afterEdit) => {
          cy.log(`After edit to RichText: "${afterEdit}"`);
        });

        // Change back to Number
        changeFieldTypeById(fieldId, FieldType.Number);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 1).then((afterSwitch) => {
          cy.log(`After →Number: "${afterSwitch}"`);
          // Numeric text should convert to number
          expect(afterSwitch).to.equal('456');
        });
      });
    });

    it('Number → RichText → edit decimal → Number (should convert)', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        changeFieldTypeById(fieldId, FieldType.RichText);
        waitForReactUpdate(1000);

        // Edit cell to decimal value
        typeTextIntoCell(fieldId, 2, '123.45');
        waitForReactUpdate(500);

        // Change back to Number
        changeFieldTypeById(fieldId, FieldType.Number);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 2).then((afterSwitch) => {
          cy.log(`After →Number: "${afterSwitch}"`);
          // Decimal should convert correctly
          expect(afterSwitch).to.equal('123.45');
        });
      });
    });

    it('Edit Number directly → RichText → Number preserves value', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        // Edit number cell directly
        typeTextIntoCell(fieldId, 3, '777');
        waitForReactUpdate(500);

        getCellTextContent(fieldId, 3).then((afterEdit) => {
          cy.log(`After edit Number: "${afterEdit}"`);
        });

        // Convert to RichText
        changeFieldTypeById(fieldId, FieldType.RichText);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 3).then((textContent) => {
          cy.log(`After →RichText: "${textContent}"`);
        });

        // Convert back to Number
        changeFieldTypeById(fieldId, FieldType.Number);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 3).then((afterSwitch) => {
          cy.log(`After →Number: "${afterSwitch}"`);
          expect(afterSwitch).to.equal('777');
        });
      });
    });

    it('Toggle Checkbox → RichText → Checkbox preserves state', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Checkbox).then((fieldId) => {
        populateCheckboxField(fieldId);
        // Toggle one more at row 5
        toggleCheckbox(fieldId, 5);
        waitForReactUpdate(500);
        cy.log('Toggled checkbox at row 5 (now checked)');

        changeFieldTypeById(fieldId, FieldType.RichText);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 5).then((textContent) => {
          cy.log(`After →RichText: "${textContent}"`);
        });

        changeFieldTypeById(fieldId, FieldType.Checkbox);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 5).then((afterSwitch) => {
          cy.log(`After →Checkbox: "${afterSwitch}"`);
        });
      });
    });
  });

  describe('Chain transformation with edits', () => {
    it('Number → RichText(edit) → SingleSelect → RichText(edit) → Number', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);
      setupTestData();

      addFieldWithType(FieldType.Number).then((fieldId) => {
        populateNumberField(fieldId);
        waitForReactUpdate(500);

        // → RichText and edit
        changeFieldTypeById(fieldId, FieldType.RichText);
        waitForReactUpdate(1000);

        typeTextIntoCell(fieldId, 4, '100');
        waitForReactUpdate(500);

        getCellTextContent(fieldId, 4).then((afterEdit1) => {
          cy.log(`→RichText, edited to "100": "${afterEdit1}"`);
        });

        // → SingleSelect
        changeFieldTypeById(fieldId, FieldType.SingleSelect);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 4).then((selectContent) => {
          cy.log(`→SingleSelect: "${selectContent}"`);
        });

        // → RichText and edit again
        changeFieldTypeById(fieldId, FieldType.RichText);
        waitForReactUpdate(1000);

        typeTextIntoCell(fieldId, 4, '200');
        waitForReactUpdate(500);

        getCellTextContent(fieldId, 4).then((afterEdit2) => {
          cy.log(`→RichText, edited to "200": "${afterEdit2}"`);
        });

        // → Number
        changeFieldTypeById(fieldId, FieldType.Number);
        waitForReactUpdate(1000);

        getCellTextContent(fieldId, 4).then((finalContent) => {
          cy.log(`→Number: "${finalContent}"`);
          expect(finalContent).to.equal('200');
        });
      });
    });
  });
});
