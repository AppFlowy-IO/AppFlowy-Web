/**
 * Centralized selectors for Cypress E2E tests
 * This file encapsulates all data-testid selectors to avoid hardcoding them in tests
 */

/**
 * Helper function to create a data-testid selector
 */
export function byTestId(id: string): string {
  return `[data-testid="${id}"]`;
}

/**
 * Page-related selectors
 */
export const PageSelectors = {
  // Get all page items
  items: () => cy.get(byTestId('page-item')),

  // Get all page names
  names: () => cy.get(byTestId('page-name')),

  // Get page name containing specific text
  nameContaining: (text: string) => cy.get(byTestId('page-name')).contains(text),

  // Get page item containing specific page name
  itemByName: (pageName: string) => {
    return cy.get(byTestId('page-name'))
      .contains(pageName)
      .first()
      .closest(byTestId('page-item'));
  },

  // Get more actions button for a specific page
  moreActionsButton: (pageName?: string) => {
    if (pageName) {
      return PageSelectors.itemByName(pageName)
        .find(byTestId('page-more-actions'))
        .first();  // Ensure we only get one button even if multiple exist
    }
    return cy.get(byTestId('page-more-actions'));
  },

  // Get new page button
  newPageButton: () => cy.get(byTestId('new-page-button')),

  // Get page title input
  titleInput: () => cy.get(byTestId('page-title-input')),
};

/**
 * Space-related selectors
 */
export const SpaceSelectors = {
  // Get all space items
  items: () => cy.get(byTestId('space-item')),

  // Get all space names
  names: () => cy.get(byTestId('space-name')),

  // Get space expanded indicator
  expanded: () => cy.get(byTestId('space-expanded')),

  // Get space by name
  itemByName: (spaceName: string) => {
    return cy.get(byTestId('space-name'))
      .contains(spaceName)
      .closest(byTestId('space-item'));
  },

  // Get more actions button for spaces
  moreActionsButton: () => cy.get(byTestId('inline-more-actions')),
};

/**
 * View actions popover selectors
 */
export const ViewActionSelectors = {
  // Get the popover container
  popover: () => cy.get(byTestId('view-actions-popover')),

  // Get delete action button
  deleteButton: () => cy.get(byTestId('view-action-delete')),

  // Get rename action button
  renameButton: () => cy.get(byTestId('more-page-rename')),

  // Get change icon action button
  changeIconButton: () => cy.get(byTestId('more-page-change-icon')),

  // Get open in new tab action button
  openNewTabButton: () => cy.get(byTestId('more-page-open-new-tab')),

  // Get duplicate button
  duplicateButton: () => cy.get(byTestId('more-page-duplicate')),

  // Get move to button
  moveToButton: () => cy.get(byTestId('more-page-move-to')),
};

/**
 * Modal-related selectors
 */
export const ModalSelectors = {
  // Get confirm delete button (in delete confirmation modal)
  confirmDeleteButton: () => cy.get(byTestId('confirm-delete-button')),

  // Get delete page confirmation modal
  deletePageModal: () => cy.get(byTestId('delete-page-confirm-modal')),

  // Get new page modal
  newPageModal: () => cy.get(byTestId('new-page-modal')),

  // Get space item in modal
  spaceItemInModal: () => cy.get(byTestId('space-item')),
};

/**
 * Helper function to trigger hover on an element to show hidden actions
 */
export function hoverToShowActions(element: Cypress.Chainable) {
  return element
    .trigger('mouseenter', { force: true })
    .trigger('mouseover', { force: true });
}

/**
 * Share/Publish-related selectors
 */
export const ShareSelectors = {
  // Share button - use first() since there might be multiple share buttons in the UI
  shareButton: () => cy.get(byTestId('share-button')).first(),

  // Share popover
  sharePopover: () => cy.get(byTestId('share-popover')),

  // Publish tab button
  publishTabButton: () => cy.get(byTestId('publish-tab-button')),

  // Publish switch
  publishSwitch: () => cy.get(byTestId('publish-switch')),

  // Publish URL input
  publishUrlInput: () => cy.get(byTestId('publish-url-input')),

  // Page settings button
  pageSettingsButton: () => cy.get(byTestId('page-settings-button')),

  // Publish settings tab
  publishSettingsTab: () => cy.get(byTestId('publish-settings-tab')),

  // Unpublish button
  unpublishButton: () => cy.get(byTestId('unpublish-button')),

  // Confirm unpublish button
  confirmUnpublishButton: () => cy.get(byTestId('confirm-unpublish-button')),

  // Publish confirm button (the main publish button)
  publishConfirmButton: () => cy.get(byTestId('publish-confirm-button')),

  // Visit Site button
  visitSiteButton: () => cy.get(byTestId('visit-site-button')),

  // Share input field
  shareInput: () => cy.get(byTestId('share-input')),

  // Permission dropdown
  permissionDropdown: () => cy.get(byTestId('permission-dropdown')),

  // Permission options
  permissionCanEdit: () => cy.get(byTestId('permission-can-edit')),

  // Share invite button
  shareInviteButton: () => cy.get(byTestId('share-invite-button')),

  // Share member list
  shareMemberList: () => cy.get(byTestId('share-member-list')),

  // Share dialog close button
  shareDialogClose: () => cy.get(byTestId('share-dialog-close')),

  // Remove member button (dynamic)
  removeMemberButton: (email: string) => cy.get(byTestId(`remove-member-${email}`)),

  // Shared with me section
  sharedWithMeSection: () => cy.get(byTestId('shared-with-me-section')),

  // Logout button
  logoutButton: () => cy.get(byTestId('logout-button')),
};

/**
 * Workspace-related selectors
 */
export const WorkspaceSelectors = {
  // Workspace dropdown trigger
  dropdownTrigger: () => cy.get(byTestId('workspace-dropdown-trigger')),

  // Workspace dropdown content
  dropdownContent: () => cy.get(byTestId('workspace-dropdown-content')),

  // Workspace item
  item: () => cy.get(byTestId('workspace-item')),

  // Workspace item name
  itemName: () => cy.get(byTestId('workspace-item-name')),

  // Workspace member count
  memberCount: () => cy.get(byTestId('workspace-member-count')),
};

/**
 * Sidebar-related selectors
 */
export const SidebarSelectors = {
  // Sidebar page header
  pageHeader: () => cy.get(byTestId('sidebar-page-header')),
};

/**
 * Chat Model Selector-related selectors
 * Used for testing AI model selection in chat interface
 */
export const ModelSelectorSelectors = {
  // Model selector button
  button: () => cy.get(byTestId('model-selector-button')),

  // Model search input
  searchInput: () => cy.get(byTestId('model-search-input')),

  // Get all model options
  options: () => cy.get('[data-testid^="model-option-"]'),

  // Get specific model option by name
  optionByName: (modelName: string) => cy.get(byTestId(`model-option-${modelName}`)),

  // Get selected model option (has the selected class)
  selectedOption: () => cy.get('[data-testid^="model-option-"]').filter('.bg-fill-content-select'),
};

/**
 * Database Grid-related selectors
 */
export const DatabaseGridSelectors = {
  // Main grid container
  grid: () => cy.get(byTestId('database-grid')),

  // Grid rows
  rows: () => cy.get('[data-testid^="grid-row-"]'),

  // Get specific row by row ID
  rowById: (rowId: string) => cy.get(byTestId(`grid-row-${rowId}`)),

  // Get first row
  firstRow: () => cy.get('[data-testid^="grid-row-"]').first(),

  // Grid cells
  cells: () => cy.get('[data-testid^="grid-cell-"]'),

  // Get specific cell by row ID and field ID
  cellByIds: (rowId: string, fieldId: string) => cy.get(byTestId(`grid-cell-${rowId}-${fieldId}`)),

  // Get all cells in a specific row
  cellsInRow: (rowId: string) => cy.get(`[data-testid^="grid-cell-${rowId}-"]`),

  // Get first cell
  firstCell: () => cy.get('[data-testid^="grid-cell-"]').first(),

  // Get new row button (if exists)
  newRowButton: () => cy.get(byTestId('grid-new-row')),
};

/**
 * Single Select Column selectors
 */
export const SingleSelectSelectors = {
  // Select option cell by row and field ID
  selectOptionCell: (rowId: string, fieldId: string) => cy.get(byTestId(`select-option-cell-${rowId}-${fieldId}`)),

  // All select option cells
  allSelectOptionCells: () => cy.get('[data-testid^="select-option-cell-"]'),

  // Select option in dropdown by option ID
  selectOption: (optionId: string) => cy.get(byTestId(`select-option-${optionId}`)),

  // Select option menu popover
  selectOptionMenu: () => cy.get(byTestId('select-option-menu')),
};

/**
 * Grid Field/Column Header selectors
 */
export const GridFieldSelectors = {
  // Field header by field ID
  fieldHeader: (fieldId: string) => cy.get(byTestId(`grid-field-header-${fieldId}`)),

  // All field headers
  allFieldHeaders: () => cy.get('[data-testid^="grid-field-header-"]'),

  // Add select option button
  addSelectOptionButton: () => cy.get(byTestId('add-select-option')),
};

/**
 * Add Page Actions selectors
 */
export const AddPageSelectors = {
  // Inline add page button
  inlineAddButton: () => cy.get(byTestId('inline-add-page')),

  // Add grid button in dropdown
  addGridButton: () => cy.get(byTestId('add-grid-button')),

  // Add AI chat button in dropdown
  addAIChatButton: () => cy.get(byTestId('add-ai-chat-button')),
};

/**
 * Checkbox Column selectors
 */
export const CheckboxSelectors = {
  // Checkbox cell by row and field ID
  checkboxCell: (rowId: string, fieldId: string) => cy.get(byTestId(`checkbox-cell-${rowId}-${fieldId}`)),

  // All checkbox cells
  allCheckboxCells: () => cy.get('[data-testid^="checkbox-cell-"]'),

  // Checked icon
  checkedIcon: () => cy.get(byTestId('checkbox-checked-icon')),

  // Unchecked icon
  uncheckedIcon: () => cy.get(byTestId('checkbox-unchecked-icon')),

  // Get checkbox cell by checked state
  checkedCells: () => cy.get('[data-checked="true"]'),
  uncheckedCells: () => cy.get('[data-checked="false"]'),
};

/**
 * Editor-related selectors
 */
export const EditorSelectors = {
  // Main Slate editor
  slateEditor: () => cy.get('[data-slate-editor="true"]'),

  // Get first editor
  firstEditor: () => cy.get('[data-slate-editor="true"]').first(),

  // Get editor with specific content
  editorWithText: (text: string) => cy.get('[data-slate-editor="true"]').contains(text),

  // Selection toolbar
  selectionToolbar: () => cy.get('[data-testid="selection-toolbar"]'),

  // Formatting buttons in toolbar
  boldButton: () => cy.get(byTestId('toolbar-bold-button')),
  italicButton: () => cy.get(byTestId('toolbar-italic-button')),
  underlineButton: () => cy.get(byTestId('toolbar-underline-button')),
  strikethroughButton: () => cy.get(byTestId('toolbar-strikethrough-button')),
  codeButton: () => cy.get(byTestId('toolbar-code-button')),
};

/**
 * Helper function to wait for React to re-render after state changes
 */
/**
 * DateTime Column selectors
 */
export const DateTimeSelectors = {
  // DateTime cell by row and field ID
  dateTimeCell: (rowId: string, fieldId: string) => cy.get(byTestId(`datetime-cell-${rowId}-${fieldId}`)),

  // All datetime cells
  allDateTimeCells: () => cy.get('[data-testid^="datetime-cell-"]'),

  // DateTime picker popover
  dateTimePickerPopover: () => cy.get(byTestId('datetime-picker-popover')),

  // DateTime date input field
  dateTimeDateInput: () => cy.get(byTestId('datetime-date-input')),

  // DateTime time input field
  dateTimeTimeInput: () => cy.get(byTestId('datetime-time-input')),
};

/**
 * Property Menu selectors
 */
export const PropertyMenuSelectors = {
  // Property type trigger button
  propertyTypeTrigger: () => cy.get(byTestId('property-type-trigger')),

  // Property type option by field type number
  propertyTypeOption: (fieldType: number) => cy.get(byTestId(`property-type-option-${fieldType}`)),

  // Grid new property button
  newPropertyButton: () => cy.get(byTestId('grid-new-property-button')),

  // Edit property menu item
  editPropertyMenuItem: () => cy.get(byTestId('grid-field-edit-property')),
};

/**
 * Field Types enum for database columns
 */
export const FieldType = {
  RichText: 0,
  Number: 1,
  DateTime: 2,
  SingleSelect: 3,
  MultiSelect: 4,
  Checkbox: 5,
  URL: 6,
  Checklist: 7,
  LastEditedTime: 8,
  CreatedTime: 9,
  Relation: 10,
  AISummaries: 11,
  AITranslations: 12,
  FileMedia: 14
};

/**
 * Database Row Controls selectors
 */
export const RowControlsSelectors = {
  // Row accessory button (appears on hover)
  rowAccessoryButton: () => cy.get(byTestId('row-accessory-button')),

  // Row menu items
  rowMenuDuplicate: () => cy.get(byTestId('row-menu-duplicate')),
  rowMenuInsertAbove: () => cy.get(byTestId('row-menu-insert-above')),
  rowMenuInsertBelow: () => cy.get(byTestId('row-menu-insert-below')),
  rowMenuDelete: () => cy.get(byTestId('row-menu-delete')),

  // Delete confirmation
  deleteRowConfirmButton: () => cy.get(byTestId('delete-row-confirm-button')),
};

/**
 * Authentication-related selectors
 * Used for login/logout flow testing
 */
export const AuthSelectors = {
  // Login page elements
  emailInput: () => cy.get(byTestId('login-email-input')),

  // Password sign-in button
  passwordSignInButton: () => cy.get(byTestId('login-password-button')),

  // Password page elements
  passwordInput: () => cy.get(byTestId('password-input')),
  passwordSubmitButton: () => cy.get(byTestId('password-submit-button')),

  // Logout elements
  logoutMenuItem: () => cy.get(byTestId('logout-menu-item')),
  logoutConfirmButton: () => cy.get(byTestId('logout-confirm-button')),
};

export function waitForReactUpdate(ms: number = 500) {
  return cy.wait(ms);
}