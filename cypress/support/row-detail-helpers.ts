/**
 * Row Detail helpers for database E2E tests
 * Provides utilities for testing row detail modal/page functionality
 */
import 'cypress-real-events';
import { DatabaseGridSelectors, waitForReactUpdate } from './selectors';

/**
 * Row Detail selectors
 */
export const RowDetailSelectors = {
  // Row detail modal (MUI Dialog)
  modal: () => cy.get('.MuiDialog-paper'),

  // Modal content
  modalContent: () => cy.get('.MuiDialogContent-root'),

  // Modal title/header area
  modalTitle: () => cy.get('.MuiDialogTitle-root'),

  // Close button (X or back arrow)
  closeButton: () => cy.get('.MuiDialogTitle-root button').first(),

  // Expand/open as full page button
  expandButton: () => cy.get('.MuiDialogTitle-root button').filter((_, el) => {
    return el.querySelector('[class*="expand"], [class*="full"]') !== null ||
           el.getAttribute('aria-label')?.toLowerCase().includes('expand');
  }),

  // More actions button (...)
  moreActionsButton: () => cy.get('[data-testid="row-detail-more-actions"]'),

  // Dropdown menu
  dropdownMenu: () => cy.get('[role="menu"]'),

  // Duplicate menu item
  duplicateMenuItem: () => cy.get('[data-testid="row-detail-duplicate"]'),

  // Delete menu item
  deleteMenuItem: () => cy.get('[data-testid="row-detail-delete"]'),

  // Row document area (the editor part)
  documentArea: () => cy.get('.appflowy-scroll-container, [data-testid="row-document"]'),

  // Row properties area
  propertiesArea: () => cy.get('[data-testid="row-properties"], .row-properties'),

  // Property/field row in row detail
  propertyRow: () => cy.get('[data-testid="property-row"], .property-row'),

  // Property name
  propertyName: (name: string) => cy.contains('[data-testid="property-name"], .property-name', name),

  // Add property button
  addPropertyButton: () => cy.get('[data-testid="add-property-button"]').first(),

  // Row title/name field
  rowTitle: () => cy.get('[data-testid="row-title"], .row-title'),

  // Emoji picker trigger
  emojiPickerTrigger: () => cy.get('[data-testid="emoji-picker-trigger"], .emoji-trigger'),

  // Emoji picker
  emojiPicker: () => cy.get('[data-testid="emoji-picker"], .EmojiPickerReact'),

  // Icon/emoji display
  rowIcon: () => cy.get('[data-testid="row-icon"], .row-icon'),
};

/**
 * Common beforeEach setup for row detail tests
 */
export const setupRowDetailTest = () => {
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

  cy.viewport(1280, 900);
};

/**
 * Open row detail modal by clicking on a row
 * @param rowIndex - Index of the row to open (0-based, data rows only)
 */
export const openRowDetail = (rowIndex: number = 0): void => {
  // Hover over the primary cell to trigger expand button visibility
  DatabaseGridSelectors.dataRows()
    .eq(rowIndex)
    .scrollIntoView()
    .realHover();
  waitForReactUpdate(500);

  // Click the expand button that appears on hover
  cy.get('[data-testid="row-expand-button"]')
    .first()
    .click({ force: true });
  waitForReactUpdate(1000);

  // Verify modal is open
  RowDetailSelectors.modal().should('exist');
};

/**
 * Open row detail by hovering over a cell to reveal the expand button
 * Alternative method when direct row hover doesn't work
 */
export const openRowDetailViaCell = (rowIndex: number, fieldId: string): void => {
  // Hover over the cell to trigger expand button visibility
  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(rowIndex)
    .scrollIntoView()
    .realHover();
  waitForReactUpdate(500);

  // Click the expand button
  cy.get('[data-testid="row-expand-button"]')
    .first()
    .click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Close row detail modal
 */
export const closeRowDetail = (): void => {
  // Try clicking close button or pressing Escape
  cy.get('body').then(($body) => {
    if ($body.find('.MuiDialog-paper').length > 0) {
      RowDetailSelectors.closeButton().click({ force: true });
    }
  });
  waitForReactUpdate(500);
};

/**
 * Close row detail by pressing Escape
 */
export const closeRowDetailWithEscape = (): void => {
  cy.get('body').type('{esc}');
  waitForReactUpdate(500);
};

/**
 * Assert row detail modal is open
 */
export const assertRowDetailOpen = (): void => {
  RowDetailSelectors.modal().should('exist').and('be.visible');
};

/**
 * Assert row detail modal is closed
 */
export const assertRowDetailClosed = (): void => {
  RowDetailSelectors.modal().should('not.exist');
};

/**
 * Get the row document editor area
 */
export const getRowDocument = (): Cypress.Chainable => {
  return RowDetailSelectors.documentArea();
};

/**
 * Type text into the row document
 */
export const typeInRowDocument = (text: string): void => {
  RowDetailSelectors.documentArea()
    .find('[contenteditable="true"], .editor-content, .ProseMirror')
    .first()
    .click({ force: true })
    .type(text, { delay: 30 });
  waitForReactUpdate(500);
};

/**
 * Clear and type text into the row document
 */
export const clearAndTypeInRowDocument = (text: string): void => {
  RowDetailSelectors.documentArea()
    .find('[contenteditable="true"], .editor-content, .ProseMirror')
    .first()
    .click({ force: true })
    .clear()
    .type(text, { delay: 30 });
  waitForReactUpdate(500);
};

/**
 * Assert document content contains text
 */
export const assertDocumentContains = (text: string): void => {
  RowDetailSelectors.documentArea().should('contain.text', text);
};

/**
 * Open more actions menu
 */
export const openMoreActionsMenu = (): void => {
  RowDetailSelectors.moreActionsButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Duplicate row from row detail
 */
export const duplicateRowFromDetail = (): void => {
  openMoreActionsMenu();
  RowDetailSelectors.duplicateMenuItem().click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Delete row from row detail
 */
export const deleteRowFromDetail = (): void => {
  openMoreActionsMenu();
  RowDetailSelectors.deleteMenuItem().click({ force: true });
  waitForReactUpdate(500);

  // Handle confirmation if present
  cy.get('body').then(($body) => {
    if ($body.find('button:contains("Delete"):visible').length > 1) {
      cy.contains('button', 'Delete').last().click({ force: true });
      waitForReactUpdate(500);
    }
  });
};

/**
 * Expand row to full page
 */
export const expandToFullPage = (): void => {
  RowDetailSelectors.expandButton().click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Add emoji/icon to row
 */
export const addEmojiToRow = (emojiSearch: string = 'smile'): void => {
  // Click emoji picker trigger
  RowDetailSelectors.emojiPickerTrigger().click({ force: true });
  waitForReactUpdate(500);

  // Search for emoji
  cy.get('.EmojiPickerReact input, [data-testid="emoji-search"]')
    .clear()
    .type(emojiSearch, { delay: 30 });
  waitForReactUpdate(300);

  // Click first emoji result
  cy.get('.EmojiPickerReact [data-emoji], .epr-emoji')
    .first()
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Remove emoji/icon from row
 */
export const removeEmojiFromRow = (): void => {
  // Click on the existing emoji
  RowDetailSelectors.rowIcon().click({ force: true });
  waitForReactUpdate(300);

  // Click remove button
  cy.get('button').contains(/remove|delete/i).click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Assert row has emoji
 */
export const assertRowHasEmoji = (): void => {
  RowDetailSelectors.rowIcon().should('exist');
};

/**
 * Assert row has no emoji
 */
export const assertRowHasNoEmoji = (): void => {
  RowDetailSelectors.rowIcon().should('not.exist');
};

/**
 * Add a new property/field in row detail
 */
export const addPropertyInRowDetail = (fieldType: string): void => {
  RowDetailSelectors.addPropertyButton().click({ force: true });
  waitForReactUpdate(500);

  // Select field type
  cy.contains('[role="menuitem"], [data-testid^="field-type"]', new RegExp(fieldType, 'i'))
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Toggle visibility of a property
 */
export const togglePropertyVisibility = (propertyName: string): void => {
  RowDetailSelectors.propertyName(propertyName)
    .parent()
    .find('[data-testid="toggle-visibility"], button')
    .filter((_, el) => {
      return el.querySelector('[class*="eye"], [class*="visibility"]') !== null;
    })
    .first()
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Assert property exists in row detail
 */
export const assertPropertyExists = (propertyName: string): void => {
  RowDetailSelectors.propertyName(propertyName).should('exist');
};

/**
 * Assert property does not exist (hidden)
 */
export const assertPropertyNotVisible = (propertyName: string): void => {
  RowDetailSelectors.propertyName(propertyName).should('not.exist');
};

/**
 * Get row title text
 */
export const getRowTitle = (): Cypress.Chainable<string> => {
  return RowDetailSelectors.rowTitle().invoke('text');
};

/**
 * Edit row title
 */
export const editRowTitle = (newTitle: string): void => {
  RowDetailSelectors.rowTitle()
    .click({ force: true })
    .clear()
    .type(newTitle, { delay: 30 });
  cy.get('body').type('{esc}');
  waitForReactUpdate(500);
};
