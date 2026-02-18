/**
 * Database Row Operations Tests
 *
 * Tests for row operations via the grid context menu:
 * - Row insertion (above/below)
 * - Row duplication
 * - Row deletion
 *
 * Note: Row operations via row detail modal are tested in row-detail.cy.ts
 */
import {
  DatabaseGridSelectors,
  RowControlsSelectors,
  waitForReactUpdate
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';

describe('Database Row Operations', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  /**
   * Helper: Create a grid and wait for it to load
   */
  const createGridAndWait = (testEmail: string) => {
    return signInAndCreateDatabaseView(testEmail, 'Grid', {
      createWaitMs: 8000,
      verify: () => {
        cy.log('[STEP] Verifying grid exists');
        DatabaseGridSelectors.grid().should('exist');
        DatabaseGridSelectors.cells().should('exist');
      },
    });
  };

  /**
   * Helper: Add content to a cell
   */
  const addContentToCell = (cellIndex: number, content: string) => {
    DatabaseGridSelectors.cells().eq(cellIndex).click();
    waitForReactUpdate(500);
    cy.focused().type(content);
    cy.focused().type('{enter}');
    waitForReactUpdate(1000);
  };

  /**
   * Helper: Open row context menu for a specific row
   */
  const openRowContextMenu = (rowIndex: number = 0) => {
    if (rowIndex === 0) {
      DatabaseGridSelectors.firstRow()
        .parent()
        .parent()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
    } else {
      DatabaseGridSelectors.rows().eq(rowIndex)
        .parent()
        .parent()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
    }

    cy.wait(1000);

    RowControlsSelectors.rowAccessoryButton().then($button => {
      if ($button.length > 0) {
        cy.wrap($button.first()).click({ force: true });
      } else {
        cy.get('div[class*="cursor-pointer"]').first().click({ force: true });
      }
    });

    cy.wait(1000);
    cy.get('[role="menu"], [data-slot="dropdown-menu-content"]').should('be.visible');
  };

  describe('Row Insertion', () => {
    it('should insert rows above and below existing row', () => {
      const testEmail = generateRandomEmail();
      const originalContent = `Original Row ${Date.now()}`;
      const aboveContent = `Above Row ${Date.now()}`;
      const belowContent = `Below Row ${Date.now()}`;

      cy.log(`[TEST START] Testing row insertion - Test email: ${testEmail}`);

      createGridAndWait(testEmail).then(() => {
        // Add content to first cell
        addContentToCell(0, originalContent);
        DatabaseGridSelectors.cells().first().should('contain.text', originalContent);

        // Get initial row count
        DatabaseGridSelectors.rows().then($rows => {
          const initialRowCount = $rows.length;
          cy.log(`Initial row count: ${initialRowCount}`);

          // Insert row above
          cy.log('[STEP] Inserting row above');
          openRowContextMenu(0);

          RowControlsSelectors.rowMenuInsertAbove().then($insertAbove => {
            if ($insertAbove.length > 0) {
              cy.wrap($insertAbove).click();
            } else {
              cy.get('[role="menuitem"]').first().click();
            }
          });

          cy.wait(2000);
          DatabaseGridSelectors.rows().should('have.length', initialRowCount + 1);

          // Add content to newly inserted row above
          DatabaseGridSelectors.cells().first().click();
          waitForReactUpdate(500);
          cy.focused().type(aboveContent);
          cy.focused().type('{enter}');
          waitForReactUpdate(1000);

          // Insert row below the original row (now second row)
          cy.log('[STEP] Inserting row below original row');
          DatabaseGridSelectors.rows().eq(1)
            .parent()
            .parent()
            .trigger('mouseenter', { force: true })
            .trigger('mouseover', { force: true });

          cy.wait(1000);

          RowControlsSelectors.rowAccessoryButton().then($buttons => {
            if ($buttons.length > 0) {
              cy.wrap($buttons.last()).click({ force: true });
            } else {
              cy.get('div[class*="cursor-pointer"]').last().click({ force: true });
            }
          });

          cy.wait(1000);
          cy.get('[role="menu"], [data-slot="dropdown-menu-content"]').should('be.visible');

          RowControlsSelectors.rowMenuInsertBelow().then($insertBelow => {
            if ($insertBelow.length > 0) {
              cy.wrap($insertBelow).click();
            } else {
              cy.get('[role="menuitem"]').eq(1).click();
            }
          });

          cy.wait(2000);
          DatabaseGridSelectors.rows().should('have.length', initialRowCount + 2);

          // Add content to newly inserted row below
          DatabaseGridSelectors.rows().eq(2).within(() => {
            DatabaseGridSelectors.cells().first().click();
          });
          waitForReactUpdate(500);
          cy.focused().type(belowContent);
          cy.focused().type('{enter}');
          waitForReactUpdate(1000);

          // Final verification
          cy.log('[STEP] Final verification');
          DatabaseGridSelectors.cells().then($allCells => {
            let foundAbove = false;
            let foundOriginal = false;
            let foundBelow = false;

            $allCells.each((index, cell) => {
              const text = Cypress.$(cell).text();
              if (text.includes(aboveContent)) foundAbove = true;
              if (text.includes(originalContent)) foundOriginal = true;
              if (text.includes(belowContent)) foundBelow = true;
            });

            expect(foundAbove).to.be.true;
            expect(foundOriginal).to.be.true;
            expect(foundBelow).to.be.true;
          });

          cy.log('[TEST COMPLETE] Row insertion test passed');
        });
      });
    });
  });

  describe('Row Duplication', () => {
    it('should duplicate a row with its content', () => {
      const testEmail = generateRandomEmail();
      const testContent = `Test Content ${Date.now()}`;

      cy.log(`[TEST START] Testing row duplication - Test email: ${testEmail}`);

      createGridAndWait(testEmail).then(() => {
        // Add content to first cell
        addContentToCell(0, testContent);
        DatabaseGridSelectors.cells().first().should('contain.text', testContent);

        // Open row context menu and duplicate
        cy.log('[STEP] Duplicating row');
        openRowContextMenu(0);

        cy.get('[role="menuitem"]').then($items => {
          let found = false;
          $items.each((index, item) => {
            const text = Cypress.$(item).text();
            if (text.includes('Duplicate') || text.includes('duplicate')) {
              cy.wrap(item).click();
              found = true;
              return false;
            }
          });

          if (!found) {
            RowControlsSelectors.rowMenuDuplicate().then($duplicate => {
              if ($duplicate.length > 0) {
                cy.wrap($duplicate).click();
              } else {
                cy.get('[role="menuitem"]').eq(2).click();
              }
            });
          }
        });

        cy.wait(2000);

        // Verify row was duplicated
        cy.log('[STEP] Verifying row was duplicated');
        DatabaseGridSelectors.rows().should('have.length.at.least', 2);

        // Verify duplicated content
        DatabaseGridSelectors.cells().then($allCells => {
          let contentCount = 0;
          $allCells.each((index, cell) => {
            if (Cypress.$(cell).text().includes(testContent)) {
              contentCount++;
            }
          });

          cy.log(`Found ${contentCount} cells with test content`);
          expect(contentCount).to.be.at.least(2);
        });

        cy.log('[TEST COMPLETE] Row duplication test passed');
      });
    });
  });

  describe('Row Deletion', () => {
    it('should delete a row from the grid', () => {
      const testEmail = generateRandomEmail();
      const testContent = `Test Row ${Date.now()}`;

      cy.log(`[TEST START] Testing row deletion - Test email: ${testEmail}`);

      createGridAndWait(testEmail).then(() => {
        // Add content to first cell
        addContentToCell(0, testContent);
        DatabaseGridSelectors.cells().first().should('contain.text', testContent);

        // Get initial row count
        DatabaseGridSelectors.rows().then($rows => {
          const initialRowCount = $rows.length;
          cy.log(`Initial row count: ${initialRowCount}`);

          // Open row context menu and delete
          cy.log('[STEP] Deleting row');
          openRowContextMenu(0);

          RowControlsSelectors.rowMenuDelete().then($delete => {
            if ($delete.length > 0) {
              cy.wrap($delete).click();
            } else {
              cy.get('[role="menuitem"]').contains(/delete/i).click();
            }
          });

          cy.wait(1000);

          // Handle confirmation dialog
          RowControlsSelectors.deleteRowConfirmButton().then($confirm => {
            if ($confirm.length > 0) {
              cy.wrap($confirm).click();
            } else {
              cy.get('button').contains(/delete/i).click();
            }
          });

          cy.wait(2000);

          // Verify row was deleted
          cy.log('[STEP] Verifying row was deleted');
          DatabaseGridSelectors.rows().should('have.length', initialRowCount - 1);

          // Verify content is gone
          DatabaseGridSelectors.cells().then($allCells => {
            let foundContent = false;

            $allCells.each((index, cell) => {
              const text = Cypress.$(cell).text();
              if (text.includes(testContent)) {
                foundContent = true;
              }
            });

            expect(foundContent).to.be.false;
          });

          cy.log('[TEST COMPLETE] Row deletion test passed');
        });
      });
    });
  });
});
