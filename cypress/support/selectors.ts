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
 * Helper for selectors that match data-testid prefixes or substrings
 */
export function byTestIdPrefix(prefix: string): string {
  return `[data-testid^="${prefix}"]`;
}

export function byTestIdContains(fragment: string): string {
  return `[data-testid*="${fragment}"]`;
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
 * Page Icon-related selectors
 * Used for testing page icon upload and display
 */
export const PageIconSelectors = {
  // Page icon wrapper in sidebar (clickable to open popover)
  pageIcon: () => cy.get(byTestId('page-icon')),

  // Page icon image (for URL type icons)
  pageIconImage: () => cy.get(byTestId('page-icon-image')),

  // View meta hover area (hover to show Add icon button)
  viewMetaHoverArea: () => cy.get(byTestId('view-meta-hover-area')),

  // Add icon button in document header
  addIconButton: () => cy.get(byTestId('add-icon-button')),

  // Icon popover tabs
  iconPopoverTabEmoji: () => cy.get(byTestId('icon-popover-tab-emoji')),
  iconPopoverTabIcon: () => cy.get(byTestId('icon-popover-tab-icon')),
  iconPopoverTabUpload: () => cy.get(byTestId('icon-popover-tab-upload')),

  // File dropzone for image upload
  fileDropzone: () => cy.get(byTestId('file-dropzone')),
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

  // New space creation controls
  createNewSpaceButton: () => cy.get(byTestId('create-new-space-button')),
  createSpaceModal: () => cy.get(byTestId('create-space-modal')),
  spaceNameInput: () => cy.get(byTestId('space-name-input')),
};

/**
 * Breadcrumb selectors
 */
export const BreadcrumbSelectors = {
  navigation: () => cy.get(byTestId('breadcrumb-navigation')),
  items: () => cy.get(byTestIdContains('breadcrumb-item-')),
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

  // Generic modal accept/ok button
  okButton: () => cy.get(byTestId('modal-ok-button')),

  // Rename modal inputs
  renameInput: () => cy.get(byTestId('rename-modal-input')),
  renameSaveButton: () => cy.get(byTestId('rename-modal-save')),
  
  // Generic dialog selectors
  dialogContainer: () => cy.get('.MuiDialog-container'),
  dialogRole: () => cy.get('[role="dialog"]'),
  addButton: () => cy.contains('button', 'Add'),
};

/**
 * Dropdown/Menu selectors
 */
export const DropdownSelectors = {
  content: (options?: any) => cy.get('[data-slot="dropdown-menu-content"]', options),
  menu: (options?: any) => cy.get('[role="menu"]', options),
  menuItem: (options?: any) => cy.get('[role="menuitem"]', options),
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
  
  // Share inputs
  emailTagInput: () => cy.get('[data-slot="email-tag-input"]'),
  inviteButton: () => cy.contains('button', /invite/i),

  // Publish tab button
  publishTabButton: () => cy.get(byTestId('publish-tab-button')),

  // Publish switch
  publishSwitch: () => cy.get(byTestId('publish-switch')),

  // Publish URL input
  publishUrlInput: () => cy.get(byTestId('publish-url-input')),

  // Publish namespace and name inputs
  publishNamespace: () => cy.get(byTestId('publish-namespace')),
  publishNameInput: () => cy.get(byTestId('publish-name-input')),
  openPublishSettingsButton: () => cy.get(byTestId('open-publish-settings')),

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
  publishManageModal: () => cy.get(byTestId('publish-manage-modal')),
  publishManagePanel: () => cy.get(byTestId('publish-manage-panel')),

  // Edit namespace button
  editNamespaceButton: () => cy.get(byTestId('edit-namespace-button')),

  // Homepage setting (only visible when namespace is not a UUID)
  homePageSetting: () => cy.get(byTestId('homepage-setting')),

  // Homepage upgrade button (visible for Free plan users on official hosts)
  homePageUpgradeButton: () => cy.get(byTestId('homepage-upgrade-button')),
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
 * Trash view selectors
 */
export const TrashSelectors = {
  sidebarTrashButton: () => cy.get(byTestId('sidebar-trash-button')),
  table: () => cy.get(byTestId('trash-table')),
  rows: () => cy.get(byTestId('trash-table-row')),
  cell: () => cy.get('td'),
  restoreButton: () => cy.get(byTestId('trash-restore-button')),
  deleteButton: () => cy.get(byTestId('trash-delete-button')),
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
 * Chat UI selectors
 */
export const ChatSelectors = {
  aiChatContainer: () => cy.get(byTestId('ai-chat-container')),
  formatToggle: () => cy.get(byTestId('chat-input-format-toggle')),
  formatGroup: () => cy.get(byTestId('chat-format-group')),
  browsePromptsButton: () => cy.get(byTestId('chat-input-browse-prompts')),
  relatedViewsButton: () => cy.get(byTestId('chat-input-related-views')),
  relatedViewsPopover: () => cy.get(byTestId('chat-related-views-popover')),
  sendButton: () => cy.get(byTestId('chat-input-send')),
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
 * Database View selectors
 */
export const DatabaseViewSelectors = {
  // View tabs
  viewTab: (viewId?: string) => viewId ? cy.get(byTestId(`view-tab-${viewId}`)) : cy.get('[data-testid^="view-tab-"]'),

  // Active view tab
  activeViewTab: () => cy.get('[data-testid^="view-tab-"][data-state="active"]'),

  // View name input
  viewNameInput: () => cy.get(byTestId('view-name-input')),

  // Add view button (plus button)
  addViewButton: () => cy.get(byTestId('add-view-button')), // Note: Check if this ID exists, otherwise might need to use the button containing "+" logic or add ID to code

  // View type selection in dropdown
  viewTypeOption: (type: string) => cy.contains(type), // Usually text based in dropdown

  // Grid view container
  gridView: () => cy.get(byTestId('grid-view')),

  // Board view container
  boardView: () => cy.get('[data-testid*="board"]'), // Using wildcard as specific ID might vary

  // Calendar view container
  calendarView: () => cy.get('[data-testid*="calendar"]'),
};

/**
 * Database Filter & Sort selectors
 */
export const DatabaseFilterSelectors = {
  // Filter button (opens filter menu)
  filterButton: () => cy.get(byTestId('database-actions-filter')),

  // Add filter button (plus button in DatabaseConditions area to add new filter condition)
  addFilterButton: () => cy.get(byTestId('database-add-filter-button')),

  // Sort button
  sortButton: () => cy.get(byTestId('database-actions-sort')),

  // Filter condition row
  filterCondition: () => cy.get(byTestId('database-filter-condition')),

  // Sort condition row
  sortCondition: () => cy.get(byTestId('database-sort-condition')),

  // Remove filter button (inside condition)
  removeFilterButton: () => cy.get('button[aria-label*="remove"], button[aria-label*="delete"], button:contains("×"), svg[class*="close"], svg[class*="x"]').first(),

  // Filter input
  filterInput: () => cy.get(byTestId('text-filter-input')),
};

/**
 * Slash Command selectors
 */
export const SlashCommandSelectors = {
  // Slash panel
  slashPanel: () => cy.get(byTestId('slash-panel')),

  // Slash menu item
  slashMenuItem: (name: string) => cy.get('[data-testid^="slash-menu-"]').filter(`:contains("${name}")`),

  heading1: () => cy.get(byTestId('slash-menu-heading1')),
  bulletedList: () => cy.get(byTestId('slash-menu-bulletedList')),

  // Database selection modal (legacy - kept for backward compatibility)
  promptModal: () => cy.get(byTestId('prompt-modal')),

  // Search input in popover/modal
  searchInput: () => cy.get('input[placeholder*="Search"]'),

  // Select database from linked database picker
  selectDatabase: (dbName?: string) => {
    // Wait for the popover to appear
    cy.contains('Link to an existing database', { timeout: 10000 }).should('be.visible');

    // Wait for loading to complete if present
    cy.get('body').then(($body) => {
      if ($body.text().includes('Loading...')) {
        cy.contains('Loading...', { timeout: 15000 }).should('not.exist');
      }
    });

    // Find the MUI Popover paper element and interact with it
    cy.get('.MuiPopover-paper').last().should('be.visible').within(() => {
      if (dbName) {
        // Try to search for specific database with retry logic
        cy.get('input[placeholder*="Search"]').should('be.visible').clear().type(dbName);

        // Retry mechanism: wait and check if database appears (up to 5 attempts)
        let attempts = 0;
        const maxAttempts = 5;
        const checkDatabase = () => {
          attempts++;
          cy.task('log', `[selectDatabase] Attempt ${attempts}/${maxAttempts} to find database "${dbName}"`);

          waitForReactUpdate(2000);

          cy.get('[class*="appflowy-scrollbar"]').then(($area) => {
            const areaText = $area.text();

            // Check if we have "No databases found" message
            if (areaText.includes('No databases found')) {
              if (attempts < maxAttempts) {
                cy.task('log', `[selectDatabase] No databases found, retrying... (attempt ${attempts})`);
                waitForReactUpdate(3000); // Wait longer before retry
                checkDatabase();
                return;
              } else {
                cy.task('log', '[selectDatabase] No databases found after all retries');
                throw new Error('No databases available to select');
              }
            }

            if (areaText.includes(dbName)) {
              // Database found by name, find the span and click its parent div
              cy.task('log', `[selectDatabase] Database "${dbName}" found, selecting it`);
              cy.contains('span', dbName).parent('div').click({ force: true });
            } else {
              // Database not found yet, retry if we haven't exceeded max attempts
              if (attempts < maxAttempts) {
                cy.task('log', `[selectDatabase] Database "${dbName}" not found yet, retrying... (attempt ${attempts})`);
                waitForReactUpdate(3000); // Wait longer before retry
                checkDatabase();
              } else {
                // After all retries, select first available database
                cy.task('log', `[selectDatabase] Database "${dbName}" not found after ${maxAttempts} attempts, selecting first available`);
                cy.get('[class*="appflowy-scrollbar"]').within(() => {
                  cy.get('span').then(($spans) => {
                    const $dbSpan = Array.from($spans).find((span) => {
                      const text = span.textContent?.trim() || '';
                      return /Grid|View|Database|Kanban|Calendar/i.test(text) &&
                        text.length > 0 &&
                        !text.includes('Link to an existing database');
                    });

                    if ($dbSpan) {
                      cy.wrap($dbSpan).parent('div').click({ force: true });
                    } else {
                      cy.get('div').first().click({ force: true });
                    }
                  });
                });
              }
            }
          });
        };

        checkDatabase();
      } else {
        // No name provided, select first available database
        waitForReactUpdate(2000);
        cy.get('[class*="appflowy-scrollbar"]').within(() => {
          cy.get('span').then(($spans) => {
            const $dbSpan = Array.from($spans).find((span) => {
              const text = span.textContent?.trim() || '';
              return /Grid|View|Database|Kanban|Calendar/i.test(text) &&
                text.length > 0 &&
                !text.includes('Link to an existing database');
            });

            if ($dbSpan) {
              cy.wrap($dbSpan).parent('div').click({ force: true });
            } else {
              cy.get('div').first().click({ force: true });
            }
          });
        });
      }
    });
  },
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
  linkButton: () => cy.get(byTestId('link-button')),
  textColorButton: () => cy.get(byTestId('text-color-button')),
  bgColorButton: () => cy.get(byTestId('bg-color-button')),
  headingButton: () => cy.get(byTestId('heading-button')),
  heading1Button: () => cy.get(byTestId('heading-1-button')),
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
  magicLinkButton: () => cy.get(byTestId('login-magic-link-button')),
  enterCodeManuallyButton: () => cy.get(byTestId('enter-code-manually-button')),
  otpCodeInput: () => cy.get(byTestId('otp-code-input')),
  otpSubmitButton: () => cy.get(byTestId('otp-submit-button')),

  // Password sign-in button
  passwordSignInButton: () => cy.get(byTestId('login-password-button')),

  // Password page elements
  passwordInput: () => cy.get(byTestId('password-input')),
  passwordSubmitButton: () => cy.get(byTestId('password-submit-button')),

  // Logout elements
  logoutMenuItem: () => cy.get(byTestId('logout-menu-item')),
  logoutConfirmButton: () => cy.get(byTestId('logout-confirm-button')),
};

/**
 * Account settings selectors
 */
export const AccountSelectors = {
  settingsButton: () => cy.get(byTestId('account-settings-button')),
  settingsDialog: () => cy.get(byTestId('account-settings-dialog')),
  dateFormatDropdown: () => cy.get(byTestId('date-format-dropdown')),
  dateFormatOptionYearMonthDay: () => cy.get(byTestId('date-format-1')),
  timeFormatDropdown: () => cy.get(byTestId('time-format-dropdown')),
  timeFormatOption24: () => cy.get(byTestId('time-format-1')),
  startWeekDropdown: () => cy.get(byTestId('start-week-on-dropdown')),
  startWeekMonday: () => cy.get(byTestId('start-week-1')),
};

/**
 * Avatar display selectors
 */
export const AvatarUiSelectors = {
  image: () => cy.get(byTestId('avatar-image')),
};

/**
 * Block-related selectors
 */
export const BlockSelectors = {
  dragHandle: () => cy.get(byTestId('drag-block')),
  hoverControls: () => cy.get(byTestId('hover-controls')),
  slashMenuGrid: () => cy.get(byTestId('slash-menu-grid')),
  blockByType: (type: string) => cy.get(`[data-block-type="${type}"]`),
  blockSelector: (type: string) => `[data-block-type="${type}"]`,
  allBlocks: () => cy.get('[data-block-type]'),
};

export function waitForReactUpdate(ms: number = 500) {
  return cy.wait(ms);
}
